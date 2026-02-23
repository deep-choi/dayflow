import { GoogleGenAI, Type } from "@google/genai";
import { CalendarEvent, JournalEntry, Todo, AiPost, AIAgent, ChatMode, ApiConnection } from "../types";
import { DEFAULT_GEMINI_MODEL, normalizeGeminiModelName } from "../utils/aiConfig";
import { callXaiChatJSON } from "./xaiService";

const CHAT_HISTORY_LIMIT = 12;
const MODEL_MESSAGE_CHAR_LIMIT = 600;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TODO_CATEGORIES = new Set(["personal", "work", "health", "shopping"]);
const JOURNAL_MOODS = new Set(["good", "neutral", "bad"]);

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sanitizeAssistantReply = (reply: string, agentName?: string): string => {
  const trimmed = (reply || "").trim();
  if (!trimmed) return "";

  const tagMatch = trimmed.match(/^\[([^\]\n]{1,24})\]\s*/);
  let result = trimmed;
  if (tagMatch) {
    const tag = (tagMatch[1] || "").trim().toLowerCase();
    const normalizedAgentName = (agentName || "").trim().toLowerCase();
    const isGenericTag = /^(ai|assistant|어시스턴트|챗봇|bot)$/i.test(tag);
    const isSelfNameTag =
      normalizedAgentName.length > 0 &&
      (tag === normalizedAgentName || tag === `${normalizedAgentName}님` || tag.includes(normalizedAgentName));

    if (isGenericTag || isSelfNameTag) {
      result = result.slice(tagMatch[0].length).trimStart();
    }
  }

  if (agentName) {
    const escapedName = escapeRegex(agentName.trim());
    if (escapedName) {
      result = result.replace(new RegExp(`^${escapedName}\\s*[:：]\\s*`, "i"), "").trimStart();
    }
  }

  return result || trimmed;
};

const stripCrossPersonaSpeech = (
  reply: string,
  agentName?: string,
  otherPersonaNames: string[] = []
): string => {
  const base = (reply || "").trim();
  if (!base) return "";

  const normalizedSelf = (agentName || "").trim().toLowerCase();
  const blockedNames = otherPersonaNames
    .map((name) => (name || "").trim())
    .filter((name) => name.length > 0 && name.toLowerCase() !== normalizedSelf);

  if (blockedNames.length === 0) return base;

  const patterns = blockedNames.map((name) => {
    const escaped = escapeRegex(name);
    return new RegExp(`^\\s*(?:[-*•]\\s*)?(?:\\[\\s*)?${escaped}(?:\\s*님)?(?:\\s*\\])?\\s*[:：-]\\s*`, "i");
  });

  const lines = base.split("\n");
  const filtered = lines.filter((line) => !patterns.some((pattern) => pattern.test(line)));
  const cleaned = filtered.join("\n").trim();
  return cleaned || base;
};

const truncateForModel = (text: string, maxChars: number): string => {
  const normalized = (text || "").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
};

const toModelContents = (
  messageHistory: { role: "user" | "assistant"; content: string }[],
  maxMessages: number,
  maxChars: number
) =>
  messageHistory.slice(-maxMessages).map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: truncateForModel(msg.content, maxChars) }],
  }));

const toDateOnly = (date: Date): string => date.toISOString().split("T")[0];

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const normalizeDateString = (rawValue: unknown, baseDate: Date): string | undefined => {
  if (typeof rawValue !== "string") return undefined;
  const value = rawValue.trim();
  if (!value) return undefined;

  if (DATE_ONLY_PATTERN.test(value)) {
    const parsed = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return value;
  }

  const lowered = value.toLowerCase();
  if (lowered === "today" || value === "\uC624\uB298") return toDateOnly(baseDate);
  if (lowered === "tomorrow" || value === "\uB0B4\uC77C") return toDateOnly(addDays(baseDate, 1));
  if (lowered === "day after tomorrow" || value === "\uBAA8\uB808") return toDateOnly(addDays(baseDate, 2));
  if (lowered === "next week" || value === "\uB2E4\uC74C\uC8FC" || value === "\uB2E4\uC74C \uC8FC") return toDateOnly(addDays(baseDate, 7));

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return toDateOnly(parsed);
  return undefined;
};

const normalizeTimeString = (rawValue: unknown): string | undefined => {
  if (typeof rawValue !== "string") return undefined;
  const value = rawValue.trim();
  if (!value) return undefined;

  if (TIME_PATTERN.test(value)) return value;

  const numericHourOnly = value.match(/^(\d{1,2})$/);
  if (numericHourOnly) {
    const hour = Number(numericHourOnly[1]);
    if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, "0")}:00`;
  }

  const koreanTime = value.match(/(\uC624\uC804|\uC624\uD6C4)?\s*(\d{1,2})\s*\uC2DC(?:\s*(\d{1,2})\s*\uBD84)?/);
  if (koreanTime) {
    let hour = Number(koreanTime[2]);
    const minute = Number(koreanTime[3] ?? "0");
    if (minute < 0 || minute > 59) return undefined;
    if (koreanTime[1] === "\uC624\uD6C4" && hour < 12) hour += 12;
    if (koreanTime[1] === "\uC624\uC804" && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const amPmTime = value.match(/(am|pm)\s*(\d{1,2})(?::(\d{1,2}))?/i);
  if (amPmTime) {
    const marker = amPmTime[1].toLowerCase();
    let hour = Number(amPmTime[2]);
    const minute = Number(amPmTime[3] ?? "0");
    if (minute < 0 || minute > 59) return undefined;
    if (marker === "pm" && hour < 12) hour += 12;
    if (marker === "am" && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  return undefined;
};

const inferDateFromText = (text: string, baseDate: Date): string | undefined => {
  const normalized = text.toLowerCase();
  if (normalized.includes("\uB0B4\uC77C") || normalized.includes("tomorrow")) return toDateOnly(addDays(baseDate, 1));
  if (normalized.includes("\uBAA8\uB808") || normalized.includes("day after tomorrow")) return toDateOnly(addDays(baseDate, 2));
  if (normalized.includes("\uB2E4\uC74C\uC8FC") || normalized.includes("\uB2E4\uC74C \uC8FC") || normalized.includes("next week")) return toDateOnly(addDays(baseDate, 7));
  if (normalized.includes("\uC624\uB298") || normalized.includes("today")) return toDateOnly(baseDate);

  const isoDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDate) return normalizeDateString(isoDate[1], baseDate);
  return undefined;
};

const inferTimeFromText = (text: string): string | undefined => {
  const hhmm = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hhmm) return `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`;

  const koreanTime = text.match(/(\uC624\uC804|\uC624\uD6C4)?\s*(\d{1,2})\s*\uC2DC(?:\s*(\d{1,2})\s*\uBD84)?/);
  if (koreanTime) {
    return normalizeTimeString(`${koreanTime[1] ?? ""} ${koreanTime[2]}\uC2DC${koreanTime[3] ? `${koreanTime[3]}\uBD84` : ""}`.trim());
  }

  return undefined;
};

export const generateLifeInsight = async (
  apiKey: string,
  events: CalendarEvent[],
  todos: Todo[],
  journalEntries: JournalEntry[],
  modelName: string = DEFAULT_GEMINI_MODEL,
  provider: ApiConnection['provider'] = 'gemini'
): Promise<AiPost> => {
  if (!apiKey) {
    throw new Error("API Key is required.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const today = new Date().toISOString().split("T")[0];

  const contextData = {
    currentDate: today,
    recentEvents: events.slice(0, 10),
    pendingTasks: todos.filter((t) => !t.completed).slice(0, 20),
    completedTasks: todos.filter((t) => t.completed).slice(0, 10),
    recentJournal: journalEntries.slice(0, 5),
  };

  const prompt = `
You are the LifeSync analysis assistant.
Write in Korean.

Analyze this context:
${JSON.stringify(contextData, null, 2)}

Output JSON with:
- title: short but compelling
- content: practical and readable analysis
- tags: array of short tags
`;

  try {
    if (provider === 'xai') {
      const xaiSystemPrompt = `${prompt}\n\nIMPORTANT: You MUST respond with a valid JSON object with exactly these keys: "title" (string), "content" (string), "tags" (array of strings).`;
      const parsed = await callXaiChatJSON(
        apiKey,
        xaiSystemPrompt,
        [{ role: 'user', content: 'Generate the insight now.' }],
        modelName,
        { temperature: 0.5, maxTokens: 900 }
      );
      return {
        id: crypto.randomUUID(),
        title: parsed.title || "오늘의 인사이트",
        content: parsed.content || "분석 결과를 생성하지 못했습니다.",
        tags: Array.isArray(parsed.tags) ? parsed.tags : ["Insight", "Daily"],
        date: new Date().toISOString(),
        type: "analysis",
      };
    }

    const response = await ai.models.generateContent({
      model: normalizeGeminiModelName(modelName),
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.5,
        maxOutputTokens: 900,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            content: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["title", "content", "tags"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return {
      id: crypto.randomUUID(),
      title: parsed.title || "오늘의 인사이트",
      content: parsed.content || "분석 결과를 생성하지 못했습니다.",
      tags: Array.isArray(parsed.tags) ? parsed.tags : ["Insight", "Daily"],
      date: new Date().toISOString(),
      type: "analysis",
    };
  } catch (error) {
    console.error("AI generation failed:", error);
    throw new Error("AI insight generation failed.");
  }
};

export interface ChatActionResult {
  reply: string;
  action: {
    type: "add_event" | "delete_event" | "add_todo" | "add_journal" | "generate_insight" | "generate_image" | "generate_video" | "none";
    event?: {
      title: string;
      date: string;
      startTime?: string;
      endTime?: string;
      type?: string;
    };
    deleteEvent?: {
      id?: string;
      title?: string;
      date?: string;
      startTime?: string;
    };
    todo?: {
      text: string;
      category?: string;
      dueDate?: string;
    };
    journal?: {
      title: string;
      content: string;
      mood?: string;
    };
    prompt?: string;
  };
}

export interface GroupChatAgentResult {
  agentId: string;
  reply: string;
  action: ChatActionResult["action"];
}

export interface GroupChatResult {
  responses: GroupChatAgentResult[];
}

const sanitizeAction = (
  rawAction: ChatActionResult["action"] | undefined,
  latestUserText: string,
  baseDate: Date
): ChatActionResult["action"] => {
  if (!rawAction || typeof rawAction.type !== "string") return { type: "none" };
  const actionType = rawAction.type;

  if (actionType === "add_event") {
    const event = rawAction.event;
    const title = typeof event?.title === "string" && event.title.trim()
      ? event.title.trim()
      : (latestUserText.trim().slice(0, 60) || "New event");
    const date = normalizeDateString(event?.date, baseDate) ?? inferDateFromText(latestUserText, baseDate) ?? toDateOnly(baseDate);
    const startTime = normalizeTimeString(event?.startTime) ?? inferTimeFromText(latestUserText);
    const endTime = normalizeTimeString(event?.endTime);
    const type = typeof event?.type === "string" && event.type.trim() ? event.type.trim() : "tag_1";
    return { type: "add_event", event: { title, date, startTime, endTime, type } };
  }

  if (actionType === "delete_event") {
    const target = rawAction.deleteEvent;
    const id = typeof target?.id === "string" && target.id.trim() ? target.id.trim() : undefined;
    const title = typeof target?.title === "string" && target.title.trim() ? target.title.trim() : undefined;
    const date = normalizeDateString(target?.date, baseDate) ?? inferDateFromText(latestUserText, baseDate);
    const startTime = normalizeTimeString(target?.startTime) ?? inferTimeFromText(latestUserText);
    if (!id && !title && !date) return { type: "none" };
    return { type: "delete_event", deleteEvent: { id, title, date, startTime } };
  }

  if (actionType === "add_todo") {
    const todo = rawAction.todo;
    if (!todo?.text || typeof todo.text !== "string") return { type: "none" };
    const category = TODO_CATEGORIES.has(todo.category || "") ? todo.category : "personal";
    const dueDate = normalizeDateString(todo.dueDate, baseDate);
    return { type: "add_todo", todo: { text: todo.text.trim(), category, dueDate } };
  }

  if (actionType === "add_journal") {
    const journal = rawAction.journal;
    if (!journal?.content || typeof journal.content !== "string") return { type: "none" };
    const title = typeof journal.title === "string" && journal.title.trim()
      ? journal.title.trim()
      : journal.content.trim().slice(0, 24) || "Chat memo";
    const mood = JOURNAL_MOODS.has(journal.mood || "") ? journal.mood : "neutral";
    return { type: "add_journal", journal: { title, content: journal.content.trim(), mood } };
  }

  if (actionType === "generate_insight") return { type: "generate_insight" };
  if (actionType === "generate_image") {
    return { type: "generate_image", prompt: typeof rawAction.prompt === "string" ? rawAction.prompt.trim() : latestUserText.trim() };
  }
  if (actionType === "generate_video") {
    return { type: "generate_video", prompt: typeof rawAction.prompt === "string" ? rawAction.prompt.trim() : latestUserText.trim() };
  }
  return { type: "none" };
};

export const generateChatResponse = async (
  apiKey: string,
  messageHistory: { role: "user" | "assistant"; content: string }[],
  events: CalendarEvent[],
  todos: Todo[],
  journalEntries: JournalEntry[],
  userName: string,
  modelName: string = DEFAULT_GEMINI_MODEL,
  agent?: AIAgent,
  mode: ChatMode = "basic",
  personaMemoryContext: string = "",
  provider: ApiConnection['provider'] = 'gemini',
  otherPersonaNames: string[] = []
): Promise<ChatActionResult> => {
  if (!apiKey) throw new Error("API Key is required.");

  const ai = new GoogleGenAI({ apiKey });
  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const contextData = {
    date: today,
    currentTime,
    userName,
    upcomingEvents: events.filter((e) => e.date >= today).slice(0, 5),
    pendingTasks: todos.filter((t) => !t.completed).slice(0, 5),
    recentJournal: journalEntries.slice(0, 3),
  };

  const agentName = agent?.name || "LifeSync AI";
  const agentRole = agent?.role || "AI assistant";
  const agentPersonality = agent?.personality || "Helpful, observant, and practical.";
  const agentTone = agent?.tone || "Warm and clear";

  const modeInstruction =
    mode === "learning"
      ? "Explain clearly and teach step by step when useful."
      : "Keep answers practical and direct.";

  const memoryInstruction = personaMemoryContext
    ? `[Long-term memory from previous chat sessions]\n${truncateForModel(personaMemoryContext, 1000)}\n\n`
    : "";
  const otherPersonaInstruction = otherPersonaNames.length > 0
    ? `Other persona names currently in this chat: ${otherPersonaNames.join(", ")}.\nNever output lines or dialogue prefixed with those names.`
    : "";

  const geminiSystemInstruction = `
${memoryInstruction}
You are "${agentName}" (${agentRole}).
Persona profile: ${agentPersonality}

Conversation context:
- Date: ${today}
- Time: ${currentTime}
- Upcoming events: ${JSON.stringify(contextData.upcomingEvents)}
- Pending todos: ${JSON.stringify(contextData.pendingTasks)}
- Recent journal: ${JSON.stringify(contextData.recentJournal)}

Persona guidance:
- Follow this tone: ${agentTone}.
- ${modeInstruction}
- Speak like a real person, not a scripted assistant.
- Vary sentence rhythm and wording each turn. Avoid fixed opening/ending patterns.
- Keep the voice specific to this persona's role/personality.
- Use calendar/todo/journal context only when directly relevant to the user's current request.
- Use bullets only when the user asks for structured output.
- Match the user's language naturally.
- If the user asks to "draw", "generate an image", or "create video", set the action type to "generate_image" or "generate_video" and provide a detailed prompt in English (e.g. "A futuristic city in cyberpunk style") even if the user spoke Korean.
- ${otherPersonaInstruction || "No other persona constraint provided."}
`;

  const xaiSystemInstruction = `
${memoryInstruction}
You are "${agentName}" (${agentRole}) speaking as a distinct persona.
Persona profile: ${agentPersonality}

Conversation context:
- Date: ${today}
- Time: ${currentTime}
- Upcoming events: ${JSON.stringify(contextData.upcomingEvents)}
- Pending todos: ${JSON.stringify(contextData.pendingTasks)}
- Recent journal: ${JSON.stringify(contextData.recentJournal)}

Persona guidance:
- Apply this tone strongly: ${agentTone}.
- ${modeInstruction}
- 한국어는 원어민처럼 자연스럽게 작성해. 어색한 직역투, 번역체 문장, 부자연스러운 조사/어미를 피해.
- 같은 문장 끝 패턴을 반복하지 말고, 답변마다 리듬과 어감을 조금씩 바꿔.
- 사람처럼 대화하듯 답하고, 템플릿처럼 기계적으로 쓰지 마.
- 달력/할일/메모 맥락은 현재 요청과 직접 관련 있을 때만 사용해.
- 구조화된 출력을 요청받지 않으면 목록형 문장을 남발하지 마.
- Use vivid wording unique to this persona's role.
- If the user asks to "draw", "generate an image", or "create video", set the action type to "generate_image" or "generate_video" and provide a detailed prompt in English (e.g. "A majestic mountain landscape at sunset, cinematic lighting") even if the user spoke Korean.
- ${otherPersonaInstruction || "No other persona constraint provided."}
`;

  try {
    const validContents = toModelContents(messageHistory, CHAT_HISTORY_LIMIT, MODEL_MESSAGE_CHAR_LIMIT);

    // --- XAI branch ---
    if (provider === 'xai') {
      const jsonSchemaInstruction = `

IMPORTANT: You MUST respond with a valid JSON object with exactly these keys:
- "reply": string (your conversational response)
- "action": object with key "type" (one of: "add_event", "delete_event", "add_todo", "add_journal", "generate_insight", "generate_image", "generate_video", "none")
  - If type is "generate_image" or "generate_video", include "prompt": string (a descriptive prompt in English for the generation model)
  - If type is "add_event", include "event": { "title": string, "date": string (YYYY-MM-DD), "startTime"?: string (HH:mm), "endTime"?: string (HH:mm), "type"?: string }
  - If type is "delete_event", include "deleteEvent": { "id"?: string, "title"?: string, "date"?: string, "startTime"?: string }
  - If type is "add_todo", include "todo": { "text": string, "category"?: string, "dueDate"?: string }
  - If type is "add_journal", include "journal": { "title": string, "content": string, "mood"?: string }
  - If type is "none", no additional fields needed.
`;

      const xaiMessages = validContents.map(msg => ({
        role: (msg.role === 'model' ? 'assistant' : msg.role) as 'user' | 'assistant',
        content: msg.parts.map((p: any) => p.text).join(''),
      }));

      const latestUserText = [...messageHistory].reverse().find((m) => m.role === "user")?.content || "";
      const nowForSanitize = new Date();

      try {
        const parsed: ChatActionResult = await callXaiChatJSON(
          apiKey,
          xaiSystemInstruction + jsonSchemaInstruction,
          xaiMessages,
          modelName,
          { temperature: 0.68, maxTokens: 2048 }
        );
        const cleanedReply = stripCrossPersonaSpeech(
          sanitizeAssistantReply(parsed.reply || "", agentName),
          agentName,
          otherPersonaNames
        );
        return {
          reply: typeof cleanedReply === "string" && cleanedReply.trim() ? cleanedReply : "도와드릴게요.",
          action: sanitizeAction(parsed.action, latestUserText, nowForSanitize),
        };
      } catch {
        return { reply: "죄송해요, 답변 생성에 실패했어요.", action: { type: "none" } };
      }
    }

    // --- Gemini branch ---
    const response = await ai.models.generateContent({
      model: normalizeGeminiModelName(modelName),
      contents: validContents,
      config: {
        systemInstruction: { parts: [{ text: geminiSystemInstruction }] },
        responseMimeType: "application/json",
        temperature: 0.68,
        maxOutputTokens: 2048,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            action: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                event: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    date: { type: Type.STRING },
                    startTime: { type: Type.STRING, nullable: true },
                    endTime: { type: Type.STRING, nullable: true },
                    type: { type: Type.STRING, nullable: true },
                  },
                  nullable: true,
                },
                deleteEvent: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, nullable: true },
                    title: { type: Type.STRING, nullable: true },
                    date: { type: Type.STRING, nullable: true },
                    startTime: { type: Type.STRING, nullable: true },
                  },
                  nullable: true,
                },
                todo: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    category: { type: Type.STRING, nullable: true },
                    dueDate: { type: Type.STRING, nullable: true },
                  },
                  nullable: true,
                },
                journal: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    content: { type: Type.STRING },
                    mood: { type: Type.STRING, nullable: true },
                  },
                  nullable: true,
                },
                prompt: { type: Type.STRING, nullable: true },
              },
              required: ["type"],
            },
          },
          required: ["reply", "action"],
        },
      },
    });

    let text = "";
    try {
      const resp = response as any;
      text = typeof resp.text === "function" ? resp.text() : resp.text || "";
    } catch (e) {
      text = (response as any).text || "";
    }

    const latestUserText = [...messageHistory].reverse().find((m) => m.role === "user")?.content || "";
    const nowForSanitize = new Date();

    // Clean text if it contains markdown JSON blocks
    if (text.includes("```json")) {
      text = text.split("```json")[1].split("```")[0].trim();
    } else if (text.includes("```")) {
      text = text.split("```")[1].split("```")[0].trim();
    }

    try {
      const parsed: ChatActionResult = JSON.parse(text);
      const cleanedReply = stripCrossPersonaSpeech(
        sanitizeAssistantReply(parsed.reply || "", agentName),
        agentName,
        otherPersonaNames
      );
      return {
        reply: typeof cleanedReply === "string" && cleanedReply.trim() ? cleanedReply : "도와드릴게요.",
        action: sanitizeAction(parsed.action, latestUserText, nowForSanitize),
      };
    } catch {
      let fallbackReply = text;
      try {
        const replyMatch = text.match(/"reply"\s*:\s*"([^]+?)(?:",\s*"action"|"\s*}$|"$|$)/);
        if (replyMatch && replyMatch[1]) {
          fallbackReply = replyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
        }
      } catch (e) {
        // ignore extracting errors
      }

      const cleanedText = stripCrossPersonaSpeech(
        sanitizeAssistantReply(fallbackReply, agentName),
        agentName,
        otherPersonaNames
      );
      return { reply: cleanedText || "죄송해요, 답변 생성에 실패했어요.", action: { type: "none" } };
    }
  } catch (error) {
    console.error("Chat generation failed:", error);
    return { reply: "죄송해요, 잠시 후 다시 시도해 주세요.", action: { type: "none" } };
  }
};

export const generateGroupChatResponses = async (
  apiKey: string,
  messageHistory: { role: "user" | "assistant"; content: string }[],
  events: CalendarEvent[],
  todos: Todo[],
  journalEntries: JournalEntry[],
  userName: string,
  agents: AIAgent[],
  modelName: string = DEFAULT_GEMINI_MODEL,
  mode: ChatMode = "basic",
  personaMemoryByAgent: Record<string, string> = {}
): Promise<GroupChatResult> => {
  if (!apiKey) throw new Error("API Key is required.");

  const selectedAgents = (agents || []).filter(Boolean).slice(0, 4);
  if (selectedAgents.length === 0) return { responses: [] };

  const ai = new GoogleGenAI({ apiKey });
  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const contextData = {
    date: today,
    currentTime,
    userName,
    upcomingEvents: events.filter((e) => e.date >= today).slice(0, 5),
    pendingTasks: todos.filter((t) => !t.completed).slice(0, 5),
    recentJournal: journalEntries.slice(0, 3),
  };

  const modeInstruction =
    mode === "learning"
      ? "Explain clearly and teach step by step when useful."
      : "Keep answers practical and direct.";

  const personaBlock = selectedAgents
    .map((persona, index) => {
      const memory = personaMemoryByAgent[persona.id]
        ? truncateForModel(personaMemoryByAgent[persona.id], 520)
        : "";
      return [
        `Persona ${index + 1}:`,
        `- id: ${persona.id}`,
        `- name: ${persona.name}`,
        `- role: ${persona.role || "AI assistant"}`,
        `- personality: ${persona.personality || "Helpful and practical."}`,
        `- tone: ${persona.tone || "Warm and clear"}`,
        memory ? `- memory:\n${memory}` : "- memory: (none)",
      ].join("\n");
    })
    .join("\n\n");

  const systemInstruction = `
You are a multi-persona chat orchestrator for LifeSync.
Generate exactly one reply for each listed persona id.

Conversation context:
- Date: ${today}
- Time: ${currentTime}
- Upcoming events: ${JSON.stringify(contextData.upcomingEvents)}
- Pending todos: ${JSON.stringify(contextData.pendingTasks)}
- Recent journal: ${JSON.stringify(contextData.recentJournal)}

Mode rule: ${modeInstruction}

Persona list:
${personaBlock}

Output rules:
1. Return JSON only.
2. "responses" must include all listed persona ids exactly once.
3. Each reply should be readable with line breaks when useful.
4. Keep each reply concise unless the user asked for depth.
5. Only the first persona may set an app action (add_event, delete_event, add_todo, add_journal, generate_insight). All other personas must use action.type = "none".
`;

  try {
    const validContents = toModelContents(messageHistory, CHAT_HISTORY_LIMIT, MODEL_MESSAGE_CHAR_LIMIT);
    const response = await ai.models.generateContent({
      model: normalizeGeminiModelName(modelName),
      contents: validContents,
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        responseMimeType: "application/json",
        temperature: 0.55,
        maxOutputTokens: 3000,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            responses: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  agentId: { type: Type.STRING },
                  reply: { type: Type.STRING },
                  action: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      event: {
                        type: Type.OBJECT,
                        properties: {
                          title: { type: Type.STRING },
                          date: { type: Type.STRING },
                          startTime: { type: Type.STRING, nullable: true },
                          endTime: { type: Type.STRING, nullable: true },
                          type: { type: Type.STRING, nullable: true },
                        },
                        nullable: true,
                      },
                      deleteEvent: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING, nullable: true },
                          title: { type: Type.STRING, nullable: true },
                          date: { type: Type.STRING, nullable: true },
                          startTime: { type: Type.STRING, nullable: true },
                        },
                        nullable: true,
                      },
                      todo: {
                        type: Type.OBJECT,
                        properties: {
                          text: { type: Type.STRING },
                          category: { type: Type.STRING, nullable: true },
                          dueDate: { type: Type.STRING, nullable: true },
                        },
                        nullable: true,
                      },
                      journal: {
                        type: Type.OBJECT,
                        properties: {
                          title: { type: Type.STRING },
                          content: { type: Type.STRING },
                          mood: { type: Type.STRING, nullable: true },
                        },
                        nullable: true,
                      },
                    },
                    required: ["type"],
                  },
                },
                required: ["agentId", "reply", "action"],
              },
            },
          },
          required: ["responses"],
        },
      },
    });

    const latestUserText = [...messageHistory].reverse().find((m) => m.role === "user")?.content || "";
    const nowForSanitize = new Date();

    let parsedResponses: Array<{ agentId?: string; reply?: string; action?: ChatActionResult["action"] }> = [];
    try {
      const parsed = JSON.parse(response.text || "{}");
      parsedResponses = Array.isArray(parsed?.responses) ? parsed.responses : [];
    } catch {
      parsedResponses = [];
    }

    const responseById = new Map<string, { reply?: string; action?: ChatActionResult["action"] }>();
    parsedResponses.forEach((item) => {
      if (typeof item?.agentId !== "string") return;
      responseById.set(item.agentId, { reply: item.reply, action: item.action });
    });

    const responses: GroupChatAgentResult[] = selectedAgents.map((persona, index) => {
      const raw = responseById.get(persona.id);
      const reply =
        typeof raw?.reply === "string" && raw.reply.trim()
          ? raw.reply.trim()
          : `${persona.name}입니다. 이어서 도와드릴게요, 주인님.`;

      const action =
        index === 0
          ? sanitizeAction(raw?.action, latestUserText, nowForSanitize)
          : { type: "none" as const };

      return {
        agentId: persona.id,
        reply,
        action,
      };
    });

    return { responses };
  } catch (error) {
    console.error("Gemini group chat generation failed:", error);
    return {
      responses: selectedAgents.map((persona) => ({
        agentId: persona.id,
        reply: "죄송해요, 잠시 후 다시 시도해 주세요.",
        action: { type: "none" },
      })),
    };
  }
};

// Disabled by design: persona auto-update has been removed in favor of manual editing.
export const analyzePersonaUpdate = async (
  _apiKey: string,
  _messageHistory: { role: "user" | "assistant"; content: string }[],
  _currentAgent: AIAgent,
  _modelName: string = DEFAULT_GEMINI_MODEL
): Promise<Partial<AIAgent> | null> => {
  return null;
};

export const callGeminiImageGeneration = async (
  apiKey: string,
  prompt: string,
  modelName: string = 'gemini-3-pro-image-preview',
  onUpdateUsage?: (stats: { totalRequests: number; totalTokens: number }) => void
): Promise<string> => {
  if (!apiKey) throw new Error("API Key is required.");

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    if (onUpdateUsage) {
      onUpdateUsage({ totalRequests: 1, totalTokens: 1000 }); // Default cost for image
    }

    // Based on SDK: generateContent returns the response directly or result with response.
    // The lint suggests 'response' is not on the type, so it might be the response itself.
    const candidates = (response as any).candidates || [];
    const firstCandidate = candidates[0];
    const parts = firstCandidate?.content?.parts || [];

    // Find the first image part
    const imagePart = parts.find((p: any) => p.inlineData && p.inlineData.mimeType.startsWith('image/'));

    if (imagePart && imagePart.inlineData) {
      const { mimeType, data } = imagePart.inlineData;
      return `data:${mimeType};base64,${data}`;
    }

    throw new Error("이미지 데이터를 받지 못했습니다.");
  } catch (error) {
    console.error("Gemini image generation failed:", error);
    throw error;
  }
};
