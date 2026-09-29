import { GoogleGenAI, HarmBlockThreshold, HarmCategory, Type } from "@google/genai";
import {
  CalendarEvent,
  JournalEntry,
  Todo,
  AIAgent,
  ApiConnection,
  ChatGeneratedAction,
  ChatSingleGeneratedAction,
} from "../types";
import {
  DEFAULT_GEMINI_MODEL,
  getProviderDefaultBaseUrl,
  isHostedOpenAICompatibleProvider,
  normalizeGeminiModelName,
} from "../utils/aiConfig";
import { callAnthropicChatAPI } from "./anthropicService";
import {
  DAYFLOW_TRIAL_API_KEY,
  generateTrialGeminiContent,
  isTrialExhaustedError,
} from "./trialChatService";
import { callOpenAIChatAPI } from "./openaiService";
import { callXaiChatAPI } from "./xaiService";
import { callOllamaChatAPI } from "./ollamaService";
import { callLocalServerChatAPI } from "./localServerService";
import { callOpenAICompatibleChatAPI } from "./openAICompatibleService";

const CHAT_HISTORY_LIMIT = 8;
const MODEL_MESSAGE_CHAR_LIMIT = 420;
const PERSONA_MEMORY_CHAR_LIMIT = 1000;
const SHARED_SCENE_CONTEXT_CHAR_LIMIT = 2400;
const PEER_REPLY_CHAR_LIMIT = 180;
const SELF_REPLY_CHAR_LIMIT = 120;
const CHAT_MAX_OUTPUT_TOKENS = 8192;
const CHAT_CONTINUATION_OUTPUT_TOKENS = 4096;
const GROUP_CHAT_MAX_OUTPUT_TOKENS = 8192;
const AGENT_TONE_CHAR_LIMIT = 1200;
const AGENT_PROFILE_CHAR_LIMIT = 12000;
const PERSONAL_CONTEXT_CHAR_LIMIT = 9000;
const ACTION_JSON_MAX_ACTIONS = 5;
const GEMINI_SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));
const RESPONSE_LENGTH_CONFIG = {
  short: {
    maxOutputTokens: 1024,
    continuationMaxOutputTokens: 768,
  },
  medium: {
    maxOutputTokens: 4096,
    continuationMaxOutputTokens: 2048,
  },
  long: {
    maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    continuationMaxOutputTokens: CHAT_CONTINUATION_OUTPUT_TOKENS,
  },
} as const;

const getResponseLengthConfig = (responseLength?: AIAgent['responseLength']) =>
  RESPONSE_LENGTH_CONFIG[responseLength || 'medium'];
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildGeminiGenerationConfig = <T extends { temperature?: number }>(modelName: string, config: T): T => {
  // Gemini 3.5 and later (3.5 Flash-Lite, 3.6-3.8 Flash) no longer accept sampling parameters.
  if (!/^gemini-3\.[5-9]-/i.test(normalizeGeminiModelName(modelName))) return config;
  const { temperature: _deprecatedTemperature, ...currentConfig } = config;
  return currentConfig as T;
};

const stripModelfileExamplesForRuntime = (text: string): string => {
  const lines = (text || "").split("\n");
  const firstMessageIndex = lines.findIndex((line) => /^\s*MESSAGE\s+(?:user|assistant)\s+/i.test(line));
  const scopedLines = firstMessageIndex >= 0 ? lines.slice(0, firstMessageIndex) : lines;
  return scopedLines
    .filter((line) => !/^\s*#.*(?:MESSAGE|Modelfile|Copy these)/i.test(line))
    .join("\n")
    .replace(/\bSYSTEM\s+"""/gi, "SYSTEM")
    .replace(/"""\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const prepareAgentInstructionText = (text: string, maxChars: number): string => {
  const withoutExamples = stripModelfileExamplesForRuntime(text || "");
  const normalized = withoutExamples.replace(/[ \t]{2,}/g, " ").trim();
  return truncateForModel(normalized, maxChars);
};

const estimateTokens = (text: string): number => {
  const value = text || "";
  const koreanChars = (value.match(/[가-힣]/g) || []).length;
  const nonKoreanChars = Math.max(0, value.length - koreanChars);
  return Math.ceil(koreanChars * 0.9 + nonKoreanChars / 4);
};

const logPromptBudget = (label: string, payload: Record<string, unknown>): void => {
  try {
    if (!(import.meta as any)?.env?.DEV) return;
    console.info(`[Dayflow prompt budget] ${label}`, payload);
  } catch {
    // Dev-only diagnostics should never affect chat generation.
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableGenerationError = (error: unknown): boolean => {
  const err = error as any;
  const code = Number(err?.code ?? err?.status ?? err?.error?.code);
  const status = String(err?.status ?? err?.error?.status ?? "");
  const message = String(err?.message ?? err?.error?.message ?? "");
  return (
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 503 ||
    code === 504 ||
    /unavailable|temporar|overloaded|rate\s*limit|timeout/i.test(`${status} ${message}`)
  );
};

const generateGeminiContentWithRetry = async (
  ai: GoogleGenAI,
  request: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  attempts = 3
) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await ai.models.generateContent(request);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !isRetryableGenerationError(error)) break;
      await sleep(450 * (attempt + 1));
    }
  }
  throw lastError;
};

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

const removeDislikedPunctuation = (reply: string): string =>
  (reply || "").replace(/^\s*["“”‘’'「」『』]\s*([\s\S]*?)\s*["“”‘’'「」『』]\s*$/, "$1");

const normalizeKoreanSpacingArtifacts = (reply: string): string =>
  (reply || "")
    .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?。！？…❤️])/g, "$1")
    .replace(/([가-힣])\s+(게요|까요|네요|어요|예요|이에요|입니다|습니다|군요|죠|지요|나요|거예요|걸요|니까요|라니까요|더라고요|잖아요|잖습니까)/g, "$1$2");

const normalizeVisibleSpacing = (reply: string): string =>
  normalizeKoreanSpacingArtifacts(reply || "")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const isInternalMetaLine = (line: string): boolean => {
  const value = (line || "").trim();
  if (!value) return false;
  const unbulleted = value
    .replace(/^(?:[-*•]|\d{1,2}[.)])\s*/, "")
    .trim();
  return (
    /^(okay\s+no\s+commas|no\s+commas|drafting\s+(?:the\s+)?final\s+response|final\s+response|analysis|assistant\s*:|system\s*:)/i.test(unbulleted) ||
    /^(?:wait\b.*\buser\b|let'?s\b.*\b(?:provide|write|answer|respond|continue|complete)|text\s*:|the\s+user\b|we\s+need\b|need\s+to\b|i\s+need\b|now\s+(?:provide|write|answer|respond)|continu(?:e|ing)\b|response\s*:)/i.test(unbulleted) ||
    /(사용자에게 보이는 답변 텍스트|대화 답변 텍스트만 반환|JSON으로 감싸지|문장부호 규칙|괄호 묘사 규칙|언어 규칙|페르소나 지침|모드 규칙|가독성 규칙|내부 규칙|시스템 지침|초안|최종 답변|Drafting final response)/i.test(unbulleted)
  );
};

const stripEnglishContinuationLeadIn = (reply: string): string => {
  let result = (reply || "").trim();
  const leadInPatterns = [
    // Some local models narrate their continuation before producing it, e.g.
    // "Drawing from the end point ... So the continuation is: ...".
    /^\s*(?:drawing|continuing|picking|resuming)\s+(?:from|at|on)\s+(?:the\s+)?(?:end(?:\s+point)?|previous(?:\s+(?:output|response))?|last\s+(?:sentence|line|point)|cut[-\s]?off\s+point)\b[\s\S]{0,500}?(?:so\s*,?\s*)?(?:the\s+)?continuation\s+(?:is|starts|would be)\s*:\s*/i,
    /^\s*(?:the\s+)?(?:previous\s+)?(?:output|response)\s+(?:ended|stopped)\b[\s\S]{0,300}?(?:continuation\s+(?:is|starts)|continue\s+from)\s*:\s*/i,
    /^\s*(?:here(?:'s| is)\s+)?(?:the\s+)?continuation\s*:\s*/i,
  ];

  let stripped = false;
  for (const pattern of leadInPatterns) {
    const next = result.replace(pattern, "").trim();
    if (next !== result) {
      result = next;
      stripped = true;
      break;
    }
  }

  // The leaked explanation frequently wraps only the actual continuation in
  // quotes. Remove those wrapper quotes after a known lead-in was stripped.
  return stripped
    ? result.replace(/^\s*["“”'‘’]\s*/, "").replace(/\s*["“”'‘’]\s*$/, "").trim()
    : result;
};

const stripInternalMetaLeakage = (reply: string): string => {
  const lines = stripEnglishContinuationLeadIn(reply || "").split("\n");
  const markerIndex = [...lines]
    .map((line, index) => ({ line, index }))
    .reverse()
    .find(({ line }) => /drafting\s+(?:the\s+)?final\s+response|final\s+response\s*:|최종\s*답변\s*[:：]/i.test(line))?.index;
  const scopedLines = typeof markerIndex === "number" ? lines.slice(markerIndex + 1) : lines;
  const filtered = scopedLines.filter((line) => !isInternalMetaLine(line));
  const cleaned = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
};

const stripDanglingReplyTail = (reply: string): string =>
  (reply || "")
    .replace(/(?:^|\n)\s*(?:[-*•]|\d{1,2}[.)]?|[가-힣A-Za-z]\.)\s*$/g, "")
    .replace(/(?:^|\n)\s*\*\*선택지\*\*\s*$/g, "")
    .trim();

const normalizeNumberedListMarkers = (reply: string): string => {
  let nextNumber = 1;
  return (reply || "")
    .split("\n")
    .map((line) => {
      const normalized = line.replace(/^(\s*)(\d{1,2})(?:[.)]|\s+)\s*(?=\S)/, "$1$2. ");
      const numbered = normalized.match(/^(\s*)\d{1,2}\.\s+(.+)$/);
      if (!numbered) return normalized;
      const [, indent, content] = numbered;
      return `${indent}${nextNumber++}. ${content}`;
    })
    .join("\n");
};

const KOREAN_COUNT_WORDS: Record<string, number> = {
  한: 1,
  하나: 1,
  두: 2,
  둘: 2,
  세: 3,
  셋: 3,
  네: 4,
  넷: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
  열한: 11,
  열하나: 11,
  열두: 12,
  열둘: 12,
};

const getRequestedListCount = (text: string): number | undefined => {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  const numberMatch = normalized.match(/(?:^|[^\d])(\d{1,2})\s*(?:가지|개|항목|문장|줄|번)(?:\b|[^\d가-힣A-Za-z]|$)/);
  const numberValue = numberMatch ? Number(numberMatch[1]) : NaN;
  if (Number.isFinite(numberValue) && numberValue >= 2 && numberValue <= 20) return numberValue;

  const wordPattern = Object.keys(KOREAN_COUNT_WORDS)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");
  const wordMatch = normalized.match(new RegExp(`(?:${wordPattern})\\s*(?:가지|개|항목|문장|줄|번)`));
  const wordValue = wordMatch ? KOREAN_COUNT_WORDS[wordMatch[0].replace(/\s*(?:가지|개|항목|문장|줄|번).*/, "")] : undefined;
  return typeof wordValue === "number" && wordValue >= 2 && wordValue <= 20 ? wordValue : undefined;
};

const countNumberedItems = (text: string): number =>
  ((normalizeNumberedListMarkers(text) || "").match(/(?:^|\n)\s*\d{1,2}\.\s+\S/g) || []).length;

const needsListCompletion = (latestUserText: string, reply: string): boolean => {
  const requestedCount = getRequestedListCount(latestUserText);
  if (!requestedCount) return false;
  return countNumberedItems(stripDanglingReplyTail(reply)) < requestedCount;
};

const hasEnglishLeakForKoreanList = (latestUserText: string, reply: string): boolean => {
  const requestedCount = getRequestedListCount(latestUserText);
  if (!requestedCount || !/[가-힣]/.test(latestUserText)) return false;
  const englishWords = (reply.match(/[A-Za-z]{3,}/g) || []).length;
  const koreanChars = (reply.match(/[가-힣]/g) || []).length;
  return /list of|wrongs?|writing|numbers?|repeatedly|steps?|options?/i.test(reply) || englishWords >= 4 && koreanChars < englishWords * 8;
};

const shouldRepairStructuredReply = (latestUserText: string, reply: string): boolean => {
  const requestedCount = getRequestedListCount(latestUserText);
  if (!requestedCount) return false;
  const itemCount = countNumberedItems(reply);
  if (itemCount === 0) return true;
  if (hasEnglishLeakForKoreanList(latestUserText, reply)) return true;
  return false;
};

const buildContinuationPrompt = (latestUserText: string, reply: string): string => {
  const requestedCount = getRequestedListCount(latestUserText);
  if (requestedCount) {
    const currentCount = countNumberedItems(stripDanglingReplyTail(reply));
    const nextNumber = Math.max(1, currentCount + 1);
    return [
      `사용자는 ${requestedCount}개 항목을 요구했습니다.`,
      currentCount > 0
        ? `현재 답변은 ${currentCount}개 항목만 있습니다. 기존 항목은 반복하지 말고 ${nextNumber}번부터 ${requestedCount}번까지 이어서 완성하세요.`
        : `1번부터 ${requestedCount}번까지 번호 목록을 완성하세요.`,
      "번호 목록은 반드시 `1. 항목`처럼 숫자 뒤에 마침표와 공백을 붙여 작성하세요.",
      "답변 전체를 한국어로 작성하세요.",
      "장면 묘사나 영어 제목은 붙이지 마세요.",
      "분석 과정이나 설명 없이 사용자에게 보일 이어지는 본문만 출력하세요.",
      "자연스러운 띄어쓰기와 마침표를 사용하세요.",
    ].join(" ");
  }

  return "직전 assistant 본문의 마지막 글자 바로 다음에 붙일 문장만 출력하세요. 처음부터 다시 쓰거나 요약하거나 안내 문구를 붙이지 마세요. 영어, 번역, 인용, `Drawing from`, `previous output`, `continuation` 같은 설명은 절대 출력하지 마세요. 분석 과정 없이 사용자에게 보일 이어지는 본문만 출력하세요. 답변 전체를 한국어로 작성하고 자연스러운 띄어쓰기와 마침표를 사용하세요.";
};

const buildStructuredRepairPrompt = (latestUserText: string, reply: string): string => {
  const requestedCount = getRequestedListCount(latestUserText);
  const countInstruction = requestedCount
    ? `사용자는 ${requestedCount}개 항목을 요구했습니다. 반드시 1번부터 ${requestedCount}번까지 정확히 ${requestedCount}개의 번호 목록으로 다시 답하세요. 번호는 반드시 1. 2. 3. 형식처럼 숫자 뒤에 마침표와 공백을 붙이세요.`
    : "최신 사용자 요청에 맞게 다시 답하세요.";

  return [
    "이전 답변이 사용자의 형식 요구를 충족하지 못했습니다.",
    countInstruction,
    "최신 사용자 요청에만 답하고 이전의 잘못된 답변 문장은 반복하지 마세요.",
    "사용자가 한국어로 물었으므로 답변 전체를 한국어로 작성하세요.",
    "장면 묘사 괄호 영어 제목 선택지는 넣지 마세요.",
    "분석 과정이나 안내 문구 없이 최종 답변 본문만 작성하세요.",
    "자연스러운 띄어쓰기와 마침표를 사용하세요.",
    `최신 사용자 요청: ${latestUserText}`,
    `잘못된 이전 답변: ${truncateForModel(reply, 500)}`,
  ].join("\n");
};

const isSituationNarrationText = (text: string): boolean =>
  /(고개|눈|손|입술|미소|웃|울|쳐다|바라|다가|숨|떨|속삭|무릎|어깨|몸|얼굴|표정|한숨|목소리|시선|조용히|천천히|잠시|상황|장면|분위기|머뭇|끄덕|숙이며|올려다|내려다|가까이|다가와|움찔|떨리는)/.test(text || "");

const removeParentheticalSituationNarration = (reply: string): string =>
  (reply || "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const fullLineMatch = trimmed.match(/^[（(]\s*([^()（）\n]{2,220})\s*[）)]$/);
      if (fullLineMatch && isSituationNarrationText(fullLineMatch[1])) return "";
      return line.replace(/[（(]\s*([^()（）\n]{2,160})\s*[）)]/g, (match, content) =>
        isSituationNarrationText(content) ? "" : match
      );
    })
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const joinContinuationText = (previous: string, continuation: string): string => {
  const base = stripDanglingReplyTail(previous || "").trim();
  const next = stripDanglingReplyTail(stripInternalMetaLeakage(continuation || "")).trim();
  if (!next) return base;
  if (!base) return next;

  const nextStartsList = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/.test(next);
  const baseLooksComplete =
    /[.!?。！？…)"'”’\]❤️]$/.test(base) ||
    /(입니다|습니다|어요|예요|세요|니다|까요|군요|네요|죠|해요|할게요|드릴게요)$/.test(base);
  const separator = nextStartsList || baseLooksComplete ? "\n" : " ";
  return `${base}${separator}${next}`.trim();
};

const formatVisibleReply = (reply: string): string => {
  const withoutMeta = stripInternalMetaLeakage(reply || "");
  const cleaned = removeDislikedPunctuation(withoutMeta);
  const formatted = removeParentheticalSituationNarration(cleaned).trim();
  const withoutIncompleteTail = trimIncompleteReplyTail(formatted);
  return normalizeVisibleSpacing(ensureKoreanSentencePunctuation(normalizeNumberedListMarkers(withoutIncompleteTail)));
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

const clampText = (value: unknown, maxChars: number): string => {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars).trim()}...` : normalized;
};

const toLocalYmd = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseLocalYmd = (value?: string): Date | null => {
  const match = (value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
};

const addLocalDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const isYmdInRange = (value: string | undefined, start: string, end: string): boolean => {
  if (!value || !parseLocalYmd(value)) return false;
  return value >= start && value <= end;
};

const normalizeActionDate = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return parseLocalYmd(trimmed) ? trimmed : undefined;
};

const normalizeActionTime = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return undefined;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
};

const normalizeTodoCategory = (value: unknown): Todo["category"] | undefined => {
  if (value === "work" || value === "personal" || value === "shopping" || value === "health") {
    return value;
  }
  return undefined;
};

const normalizeJournalMood = (value: unknown): JournalEntry["mood"] | undefined => {
  if (value === "good" || value === "neutral" || value === "bad") return value;
  return undefined;
};

const getPersonalContextWindow = (latestUserText: string, today: Date): { start: string; end: string; label: string } => {
  const text = latestUserText || "";
  const explicitDate = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (explicitDate && parseLocalYmd(explicitDate)) {
    return { start: explicitDate, end: explicitDate, label: "명시 날짜" };
  }
  if (/어제/.test(text)) {
    const y = toLocalYmd(addLocalDays(today, -1));
    return { start: y, end: y, label: "어제" };
  }
  if (/내일/.test(text)) {
    const t = toLocalYmd(addLocalDays(today, 1));
    return { start: t, end: t, label: "내일" };
  }
  if (/오늘|지금|현재/.test(text)) {
    const t = toLocalYmd(today);
    return { start: t, end: t, label: "오늘" };
  }
  if (/다음\s*(주|주간)/.test(text)) {
    return {
      start: toLocalYmd(addLocalDays(today, 7)),
      end: toLocalYmd(addLocalDays(today, 13)),
      label: "다음 주",
    };
  }
  if (/이번\s*(주|주간)|일주일|주간/.test(text)) {
    return {
      start: toLocalYmd(today),
      end: toLocalYmd(addLocalDays(today, 6)),
      label: "이번 주",
    };
  }
  if (/다음\s*(달|월)/.test(text)) {
    const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    return { start: toLocalYmd(start), end: toLocalYmd(end), label: "다음 달" };
  }
  if (/이번\s*(달|월)/.test(text)) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: toLocalYmd(start), end: toLocalYmd(end), label: "이번 달" };
  }
  return {
    start: toLocalYmd(today),
    end: toLocalYmd(addLocalDays(today, 14)),
    label: "다가오는 14일",
  };
};

const shouldIncludePersonalDataContext = (latestUserText: string): boolean =>
  /(일정|캘린더|스케줄|할\s*일|할일|투두|todo|마감|기한|메모|메모장|일기|기록|노트|오늘|내일|어제|이번|다음|계획|추가|넣어|등록|저장|작성|정리|뭐\s*있|뭐해|해야\s*할)/i.test(latestUserText || "");

const formatEventForContext = (event: CalendarEvent): string => {
  const time = event.isAllDay
    ? "종일"
    : [event.startTime, event.endTime].filter(Boolean).join("-") || "시간 없음";
  const endDate = event.endDate && event.endDate !== event.date ? `~${event.endDate}` : "";
  const description = event.description ? ` | ${clampText(event.description, 90)}` : "";
  return `- ${event.date}${endDate} ${time} | ${clampText(event.title, 80)}${description}`;
};

const formatTodoForContext = (todo: Todo): string => {
  const status = todo.completed ? "완료" : "미완료";
  const due = todo.dueDate ? ` | 마감 ${todo.dueDate}` : "";
  const category = todo.category ? ` | ${todo.category}` : "";
  return `- [${status}] ${clampText(todo.text, 90)}${due}${category}`;
};

const formatJournalForContext = (entry: JournalEntry): string => {
  const date = (entry.date || "").slice(0, 10) || "날짜 없음";
  const category = entry.category ? ` | ${entry.category}` : "";
  return `- ${date} | ${clampText(entry.title, 80)}${category} | ${clampText(entry.content, 160)}`;
};

const buildPersonalDataContext = (
  events: CalendarEvent[],
  todos: Todo[],
  journalEntries: JournalEntry[],
  latestUserText: string,
  now: Date
): string => {
  if (!shouldIncludePersonalDataContext(latestUserText)) return "";

  const today = toLocalYmd(now);
  const window = getPersonalContextWindow(latestUserText, now);
  const relevantEvents = (events || [])
    .filter((event) => {
      const eventStart = event.date;
      const eventEnd = event.endDate || event.date;
      return isYmdInRange(eventStart, window.start, window.end) || isYmdInRange(eventEnd, window.start, window.end);
    })
    .slice()
    .sort((a, b) => `${a.date} ${a.startTime || ""}`.localeCompare(`${b.date} ${b.startTime || ""}`))
    .slice(0, 14);

  const relevantTodos = (todos || [])
    .filter((todo) => {
      if (!todo.completed) return true;
      const todoDate = todo.dueDate || todo.startDate || todo.date;
      return isYmdInRange(todoDate, window.start, window.end);
    })
    .slice()
    .sort((a, b) => {
      const aDate = a.dueDate || a.startDate || a.date || "9999-12-31";
      const bDate = b.dueDate || b.startDate || b.date || "9999-12-31";
      return aDate.localeCompare(bDate);
    })
    .slice(0, 18);

  const recentJournal = (journalEntries || [])
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8);

  const sections = [
    `[사용자 데이터 요약]`,
    `- 오늘 날짜: ${today}`,
    `- 참고 범위: ${window.label} (${window.start} ~ ${window.end})`,
    ``,
    `관련 일정:`,
    relevantEvents.length > 0 ? relevantEvents.map(formatEventForContext).join("\n") : "- 없음",
    ``,
    `할 일:`,
    relevantTodos.length > 0 ? relevantTodos.map(formatTodoForContext).join("\n") : "- 없음",
    ``,
    `최근 메모장 기록:`,
    recentJournal.length > 0 ? recentJournal.map(formatJournalForContext).join("\n") : "- 없음",
  ];

  return truncateForModel(sections.join("\n"), PERSONAL_CONTEXT_CHAR_LIMIT);
};

const buildChatActionInstruction = (today: string, currentTime: string): string => `
앱 액션:
- 사용자가 일정, 할 일, 메모장 기록을 "추가", "넣어", "등록", "저장", "작성"해 달라고 명확히 요청한 경우에만 액션을 만드세요.
- 조회, 요약, 상담, 계획 정리 요청은 일반 답변만 하고 액션을 만들지 마세요.
- 삭제와 수정은 아직 지원하지 않습니다. 삭제/수정 요청에는 직접 화면에서 처리하라고 안내하고 액션을 만들지 마세요.
- 액션이 필요하면 일반 문장 대신 JSON 객체 하나만 반환하세요.
- 현재 날짜는 ${today}, 현재 시간은 ${currentTime}입니다. 상대 날짜는 반드시 YYYY-MM-DD로 변환하세요.
- 일정에 시간이 없으면 "isAllDay": true로 두세요. 할 일의 마감일이 불명확하면 dueDate를 생략하세요.
- 여러 개를 한 번에 추가해야 하면 batch 액션을 사용하고 actions는 최대 ${ACTION_JSON_MAX_ACTIONS}개까지만 넣으세요.

액션 JSON 형식:
{"reply":"사용자에게 보여줄 짧은 확인 문장","action":{"type":"add_event","data":{"title":"런닝","date":"YYYY-MM-DD","startTime":"07:00","endTime":"08:00","isAllDay":false,"description":"선택"}}}
{"reply":"사용자에게 보여줄 짧은 확인 문장","action":{"type":"add_todo","data":{"text":"포트폴리오 수정","dueDate":"YYYY-MM-DD","category":"personal","listName":"선택"}}}
{"reply":"사용자에게 보여줄 짧은 확인 문장","action":{"type":"add_journal_entry","data":{"title":"아이디어","content":"기록할 내용","category":"메모장","mood":"neutral"}}}
{"reply":"사용자에게 보여줄 짧은 확인 문장","action":{"type":"batch","actions":[{"type":"add_todo","data":{"text":"예시"}}]}}
`;

const extractJsonObjectText = (text: string): string | null => {
  const value = (text || "").trim();
  if (!value) return null;

  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1]?.trim() || value;
  const start = source.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }

  return null;
};

const normalizeSingleGeneratedAction = (raw: any): ChatSingleGeneratedAction | null => {
  const type = String(raw?.type || raw?.action || "").trim();
  const data = raw?.data && typeof raw.data === "object" ? raw.data : raw;

  if (type === "add_event") {
    const title = clampText(data?.title, 120);
    const date = normalizeActionDate(data?.date);
    if (!title || !date) return null;
    const startTime = normalizeActionTime(data?.startTime ?? data?.start_time);
    const endTime = normalizeActionTime(data?.endTime ?? data?.end_time);
    const endDate = normalizeActionDate(data?.endDate ?? data?.end_date);
    return {
      type: "add_event",
      data: {
        title,
        date,
        ...(endDate ? { endDate } : {}),
        ...(startTime ? { startTime } : {}),
        ...(endTime ? { endTime } : {}),
        isAllDay: typeof data?.isAllDay === "boolean" ? data.isAllDay : !startTime,
        ...(clampText(data?.description, 300) ? { description: clampText(data.description, 300) } : {}),
        ...(clampText(data?.type, 60) ? { type: clampText(data.type, 60) } : {}),
      },
    };
  }

  if (type === "add_todo") {
    const text = clampText(data?.text || data?.title, 160);
    if (!text) return null;
    const dueDate = normalizeActionDate(data?.dueDate ?? data?.due_date);
    const category = normalizeTodoCategory(data?.category);
    const listName = clampText(data?.listName ?? data?.list_name, 80);
    return {
      type: "add_todo",
      data: {
        text,
        ...(dueDate ? { dueDate } : {}),
        ...(category ? { category } : {}),
        ...(listName ? { listName } : {}),
      },
    };
  }

  if (type === "add_journal_entry") {
    const title = clampText(data?.title, 120) || "새 메모";
    const content = clampText(data?.content || data?.text || data?.body, 1800);
    if (!content) return null;
    const category = clampText(data?.category, 80);
    const mood = normalizeJournalMood(data?.mood);
    return {
      type: "add_journal_entry",
      data: {
        title,
        content,
        ...(category ? { category } : {}),
        ...(mood ? { mood } : {}),
      },
    };
  }

  return null;
};

const normalizeGeneratedAction = (raw: any): ChatGeneratedAction => {
  if (!raw || typeof raw !== "object") return { type: "none" };

  const rawActions = Array.isArray(raw?.actions)
    ? raw.actions
    : (raw?.type === "batch" && Array.isArray(raw?.actions) ? raw.actions : null);

  if (rawActions) {
    const actions = rawActions
      .slice(0, ACTION_JSON_MAX_ACTIONS)
      .map((item: any) => normalizeSingleGeneratedAction(item))
      .filter(Boolean) as ChatSingleGeneratedAction[];
    if (actions.length === 0) return { type: "none" };
    if (actions.length === 1) return actions[0];
    return { type: "batch", actions };
  }

  const single = normalizeSingleGeneratedAction(raw);
  return single || { type: "none" };
};

const parseChatActionEnvelope = (rawReply: string): { reply: string; action: ChatGeneratedAction } | null => {
  const jsonText = extractJsonObjectText(rawReply);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object") return null;
    const actionSource = parsed.action || (Array.isArray(parsed.actions) ? { type: "batch", actions: parsed.actions } : parsed);
    const action = normalizeGeneratedAction(actionSource);
    const reply = clampText(parsed.reply || parsed.message || parsed.text, 2400);
    if (action.type === "none" && !reply) return null;
    return { reply, action };
  } catch {
    return null;
  }
};

const finalizeChatResult = (
  rawReply: string,
  agentName: string,
  otherPersonaNames: string[]
): ChatActionResult => {
  const envelope = parseChatActionEnvelope(rawReply || "");
  const visibleRaw = envelope?.reply || rawReply || "";
  const cleanedReply = stripCrossPersonaSpeech(
    sanitizeAssistantReply(visibleRaw, agentName),
    agentName,
    otherPersonaNames
  );
  const finalReply = formatVisibleReply(cleanedReply);
  return {
    reply: typeof finalReply === "string" && finalReply.trim() ? finalReply : "도와드릴게요.",
    action: envelope?.action || sanitizeAction(),
  };
};

const toModelContents = (
  messageHistory: { role: "user" | "assistant"; content: string }[],
  maxMessages: number,
  maxChars: number
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> =>
  messageHistory.slice(-maxMessages).map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: truncateForModel(msg.content, maxChars) }],
  }));

type ProviderChatMessage = { role: "system" | "user" | "assistant"; content: string };

const toProviderChatMessages = (
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>
): ProviderChatMessage[] =>
  contents.map((msg): ProviderChatMessage => ({
    role: msg.role === "model" ? "assistant" : "user",
    content: msg.parts.map((part) => part.text || "").join("").trim(),
  })).filter((message) => message.content.length > 0);

const callTextProviderChatAPI = async (
  provider: ApiConnection["provider"],
  apiKey: string,
  messages: ProviderChatMessage[],
  modelName: string,
  options: { temperature?: number; maxTokens?: number } = {},
  baseUrl?: string
): Promise<string> => {
  if (provider === "ollama") {
    return callOllamaChatAPI(baseUrl, modelName, messages, options);
  }
  if (provider === "custom") {
    return callLocalServerChatAPI(baseUrl, apiKey, modelName, messages, options);
  }
  if (provider === "xai") {
    return callXaiChatAPI(apiKey, messages, undefined, modelName, options);
  }
  if (provider === "openai") {
    return callOpenAIChatAPI(apiKey, messages, undefined, modelName, options);
  }
  if (provider === "anthropic") {
    return callAnthropicChatAPI(apiKey, messages, undefined, modelName, options);
  }
  if (isHostedOpenAICompatibleProvider(provider)) {
    const compatibleBaseUrl = baseUrl || getProviderDefaultBaseUrl(provider);
    if (!compatibleBaseUrl) throw new Error(`${provider} provider requires an API Base URL.`);
    return callOpenAICompatibleChatAPI(apiKey, compatibleBaseUrl, messages, modelName, options);
  }
  throw new Error(`${provider} provider is not supported for chat.`);
};

const readGeminiResponseText = (response: unknown): { text: string; finishReason?: string } => {
  const resp = response as any;
  let text = "";
  try {
    text = typeof resp?.text === "function" ? resp.text() : resp?.text || "";
  } catch {
    text = resp?.text || "";
  }

  const finishReason = resp?.candidates?.[0]?.finishReason;
  return {
    text: (text || "").trim(),
    finishReason: typeof finishReason === "string" ? finishReason : undefined,
  };
};

const endedByOutputLimit = (finishReason?: string): boolean =>
  /max[_-]?tokens|length|token/i.test(finishReason || "");

const COMMON_KOREAN_ENDING_PATTERN =
  /(입니다|습니다|어요|예요|이에요|세요|니다|까요|군요|네요|죠|지요|나요|해요|할게요|드릴게요|거예요|걸요|니까요|더라고요|잖아요|겠습니다|했어요|였어요|있어요|없어요)$/;

const looksLikeIncompleteKoreanFragment = (text: string): boolean => {
  const value = (text || "").trim();
  if (!value || /[.!?。！？…)"'”’\]❤️]$/.test(value)) return false;
  if (COMMON_KOREAN_ENDING_PATTERN.test(value)) return false;

  const lastLine = value.split("\n").filter((line) => line.trim()).pop()?.trim() || value;
  const lastToken = lastLine.split(/\s+/).pop() || "";
  if (/^[가-힣]{1,2}$/.test(lastToken)) return true;
  if (/^\s*(?:[-*•]|\d{1,2}[.)])\s+/.test(lastLine)) return true;
  return false;
};

const ensureKoreanSentencePunctuation = (reply: string): string =>
  (reply || "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || !/[가-힣]/.test(trimmed)) return line;
      if (/^(?:#{1,6}\s+|\*\*[^*\n]+\*\*$)/.test(trimmed)) return line;
      if (/[.!?。！？…)"'”’\]❤️:]$/.test(trimmed)) return line;
      if (looksLikeIncompleteKoreanFragment(trimmed)) return line;
      return `${line}.`;
    })
    .join("\n");

const looksAbruptlyCutOff = (text: string): boolean => {
  const value = (text || "").trim();
  if (!value) return false;
  if (/(?:^|\n)\s*(?:[-*•]|\d{1,2}[.)]?|[가-힣A-Za-z]\.)\s*$/.test(value)) return true;
  if (/(?:^|\n)\s*\*\*선택지\*\*\s*$/.test(value)) return true;
  if (/\*\*[^*\n]*$/.test(value) || /\*[^*\n]*$/.test(value)) return true;
  if (/[(（][^()（）\n]*$/.test(value)) return true;
  if (looksLikeIncompleteKoreanFragment(value)) return true;
  if (value.length < 240) return false;
  if (/[.!?。！？…)"'”’\]❤️]$/.test(value)) return false;
  if (COMMON_KOREAN_ENDING_PATTERN.test(value)) return false;
  return true;
};

const trimIncompleteReplyTail = (reply: string): string => {
  const value = stripDanglingReplyTail(reply || "").trim();
  if (!value || !looksAbruptlyCutOff(value)) return value;

  const listMarkers = [...value.matchAll(/(?:^|\n)\s*\d{1,2}\.\s+/g)];
  const lastListMarker = listMarkers.at(-1);
  if (lastListMarker && typeof lastListMarker.index === "number") {
    const lastItem = value.slice(lastListMarker.index).trim();
    if (looksAbruptlyCutOff(lastItem) || looksLikeIncompleteKoreanFragment(lastItem)) {
      const beforeLastItem = value.slice(0, lastListMarker.index).trim();
      if (beforeLastItem) return beforeLastItem;
    }
  }

  const terminalMarks = [...value.matchAll(/[.!?。！？…❤️](?=\s|$)/g)];
  const lastTerminal = terminalMarks.at(-1);
  if (lastTerminal && typeof lastTerminal.index === "number") {
    return value.slice(0, lastTerminal.index + lastTerminal[0].length).trim();
  }

  const lastParagraphBreak = value.lastIndexOf("\n\n");
  if (lastParagraphBreak > 0) return value.slice(0, lastParagraphBreak).trim();

  const lastLineBreak = value.lastIndexOf("\n");
  if (lastLineBreak > 0) return value.slice(0, lastLineBreak).trim();

  return value;
};

export interface ChatActionResult {
  reply: string;
  action: ChatGeneratedAction;
}

export interface GroupChatAgentResult {
  agentId: string;
  reply: string;
  action: ChatActionResult["action"];
}

export interface GroupChatResult {
  responses: GroupChatAgentResult[];
}

export interface ChatGenerationOptions {
  otherPersonaNames?: string[];
  addressedPersonaNames?: string[];
  peerTurnReplies?: Array<{ name: string; content: string }>;
  recentSelfReplies?: string[];
  sharedSceneContext?: string;
  isNewSession?: boolean;
  sessionStartedAt?: string;
  sessionTimePeriod?: string;
  sessionTimezone?: string;
  ollamaBaseUrl?: string;
  trialTurnId?: string;
}

const sanitizeAction = (): ChatActionResult["action"] => ({ type: "none" });

export const generateChatResponse = async (
  apiKey: string,
  messageHistory: { role: "user" | "assistant"; content: string }[],
  _events: CalendarEvent[],
  _todos: Todo[],
  _journalEntries: JournalEntry[],
  userName: string,
  modelName: string = DEFAULT_GEMINI_MODEL,
  agent?: AIAgent,
  personaMemoryContext: string = "",
  provider: ApiConnection['provider'] = 'gemini',
  options: ChatGenerationOptions = {}
): Promise<ChatActionResult> => {
  if (!apiKey && provider !== 'ollama' && provider !== 'custom') throw new Error("API Key is required.");

  const {
    otherPersonaNames = [],
    addressedPersonaNames = [],
    peerTurnReplies = [],
    recentSelfReplies = [],
    sharedSceneContext = "",
    isNewSession = false,
    sessionStartedAt = "",
    sessionTimePeriod = "",
    sessionTimezone = "local time",
  } = options;

  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const latestUserText = [...messageHistory].reverse().find((m) => m.role === "user")?.content || "";
  const personalDataContext = buildPersonalDataContext(_events, _todos, _journalEntries, latestUserText, now);

  const agentName = agent?.name || "Dayflow";
  const agentRole = agent?.role || "인공지능 비서";
  const rawAgentPersonality = agent?.personality || "도움이 되고 관찰력이 좋으며 실용적인 성격";
  const rawAgentTone = agent?.tone?.trim() || "";
  const agentPersonality = prepareAgentInstructionText(rawAgentPersonality, AGENT_PROFILE_CHAR_LIMIT)
    || "도움이 되고 관찰력이 좋으며 실용적인 성격";
  const agentTone = prepareAgentInstructionText(rawAgentTone, AGENT_TONE_CHAR_LIMIT);
  const responseLengthConfig = getResponseLengthConfig(agent?.responseLength);
  const preferredUserName = userName?.trim() || "";
  const personaIdentityInstruction = `당신은 "${agentName}" (${agentRole})입니다.\n페르소나 프로필: ${agentPersonality}`;
  const toneInstruction = agentTone ? `- 사용자가 설정한 페르소나 말투: ${agentTone}.` : "";
  const noMetaInstruction = "내부 분석, 시스템 지침, 초안, `Wait the user`, `Text:` 같은 메타 문장을 출력하지 마세요.";
  const completionInstruction = "완성된 한국어 문장으로 끝내고, 토큰이 부족하면 새 항목을 시작하지 말고 현재 문장을 마무리하세요.";
  const lineBreakInstruction = "일반 대화와 롤플레이 답변은 한 문단을 1~2문장으로 유지하세요. 대사 뒤에 감정·행동·화제의 변화가 있으면 빈 줄로 문단을 나누고, 긴 답변은 최대 2문장마다 자연스럽게 끊으세요. 문장마다 억지로 줄바꿈하거나 모든 문장을 한 문단에 몰아넣지는 마세요.";
  const actionInstruction = shouldIncludePersonalDataContext(latestUserText)
    ? buildChatActionInstruction(today, currentTime)
    : "";
  const requestedListCount = getRequestedListCount(latestUserText);
  const listInstruction = requestedListCount
    ? `사용자가 ${requestedListCount}개 항목을 요구했습니다. 정확히 ${requestedListCount}개를 1. 2. 3. 형식으로 완성하세요.`
    : "";
  const needsTemporalContext = /(오늘|내일|어제|지금|현재|시간|날짜|요일|몇\s*시|일정|캘린더|마감|기한|오전|오후|이번\s*(주|달|월)|다음\s*(주|달|월))/i.test(latestUserText);
  const mediaInstruction = /(이미지|그림|사진|영상|비디오).*(생성|만들|그려)|(?:생성|만들|그려).*(이미지|그림|사진|영상|비디오)/i.test(latestUserText)
    ? "이 앱에서는 미디어 생성이 활성화되어 있지 않다고 짧게 설명하세요."
    : "";
  const conversationContextLines = [
    `- 사용자 이름: ${preferredUserName}`,
    needsTemporalContext ? `- 날짜: ${today}` : "",
    needsTemporalContext ? `- 시간: ${currentTime}` : "",
    needsTemporalContext && isNewSession ? `- 채팅 세션 시작: ${sessionStartedAt || "제공되지 않음"} (${sessionTimezone})` : "",
    needsTemporalContext && sessionTimePeriod ? `- 세션 시작 시간대: ${sessionTimePeriod}` : "",
  ].filter(Boolean).join("\n");

  const memoryInstruction = personaMemoryContext
    ? `[이전 대화에서 누적된 장기 기억]\n${truncateForModel(personaMemoryContext, PERSONA_MEMORY_CHAR_LIMIT)}\n[Standing Instructions] 항목은 말투와 행동 규칙이므로 현재 답변에 우선 적용하세요.\n\n`
    : "";
  const sharedSceneInstruction = sharedSceneContext
    ? `[그룹 공유 장면 기억]\n${truncateForModel(sharedSceneContext, SHARED_SCENE_CONTEXT_CHAR_LIMIT)}\n이 내용은 같은 채팅방에서 모든 페르소나가 함께 겪은 최근 상황입니다. 다른 페르소나의 행동과 발화를 이미 알고 있는 전제로 자연스럽게 이어가세요.\n\n`
    : "";
  const otherPersonaInstruction = otherPersonaNames.length > 0
    ? `현재 이 채팅에 함께 있는 다른 페르소나 이름: ${otherPersonaNames.join(", ")}.\n그 이름을 앞에 붙인 대사 형식으로 출력하지 마세요.`
    : "";
  const directAddressInstruction = addressedPersonaNames.length > 0
    ? `사용자의 최신 메시지가 직접 부른 대상: ${addressedPersonaNames.join(", ")}.\n당신의 이름이 여기에 없다면 분명한 가치가 있을 때만 답하세요.`
    : "";
  const peerReplyInstruction = peerTurnReplies.length > 0
    ? `같은 턴에서 이미 다른 페르소나가 한 답변:\n${peerTurnReplies
      .slice(-3)
      .map((item, index) => `${index + 1}. ${item.name}: ${truncateForModel(item.content, PEER_REPLY_CHAR_LIMIT)}`)
      .join("\n")}\n무시하지 말고 자연스럽게 이어서 반응하세요.`
    : "";
  const antiRepetitionInstruction = recentSelfReplies.length > 0
    ? `직전 답변에서 쓴 다음 표현을 반복하지 마세요:\n${recentSelfReplies
      .slice(-3)
      .map((reply, index) => `${index + 1}. ${truncateForModel(reply, SELF_REPLY_CHAR_LIMIT)}`)
      .join("\n")}`
    : "";
  const optionalInstructionLines = [
    listInstruction,
    mediaInstruction,
    otherPersonaInstruction,
    directAddressInstruction,
    peerReplyInstruction,
    antiRepetitionInstruction,
  ].filter(Boolean).map((line) => `- ${line}`).join("\n");

  const geminiSystemInstruction = `
${memoryInstruction}
${sharedSceneInstruction}
${personaIdentityInstruction}

대화 상황:
${conversationContextLines}
${personalDataContext ? `\n${personalDataContext}` : ""}

규칙:
${toneInstruction}
- ${noMetaInstruction}
- ${completionInstruction}
- ${lineBreakInstruction}
${optionalInstructionLines}

${actionInstruction}
`;

  const xaiSystemInstruction = geminiSystemInstruction;

  try {
    const validContents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> =
      toModelContents(messageHistory, CHAT_HISTORY_LIMIT, MODEL_MESSAGE_CHAR_LIMIT);
    const modelHistoryChars = validContents.reduce(
      (sum, item) => sum + item.parts.reduce((partSum, part) => partSum + (part.text || "").length, 0),
      0
    );
    const systemInstructionChars =
      provider === "xai" ? xaiSystemInstruction.length : geminiSystemInstruction.length;
    logPromptBudget("chat", {
      provider,
      modelName,
      agentName,
      rawToneChars: rawAgentTone.length,
      runtimeToneChars: agentTone.length,
      rawPersonalityChars: rawAgentPersonality.length,
      runtimePersonalityChars: agentPersonality.length,
      personaMemoryChars: (personaMemoryContext || "").length,
      runtimePersonaMemoryChars: memoryInstruction.length,
      historyChars: modelHistoryChars,
      systemInstructionChars,
      estimatedInputTokens: estimateTokens(
        `${provider === "xai" ? xaiSystemInstruction : geminiSystemInstruction}\n${validContents
          .map((item) => item.parts.map((part) => part.text).join(""))
          .join("\n")}`
      ),
      maxOutputTokens: responseLengthConfig.maxOutputTokens,
    });

    // --- OpenAI-compatible / Anthropic text providers ---
    if (provider !== 'gemini') {
      const providerMessages = toProviderChatMessages(validContents);
      const systemMessage: ProviderChatMessage = {
        role: "system",
        content: `${xaiSystemInstruction}\n\n일반 답변은 텍스트만 반환하세요. 앱 액션이 필요한 경우에만 위의 액션 JSON 형식을 사용하세요.`,
      };

      try {
        let rawReply = await callTextProviderChatAPI(
          provider,
          apiKey,
          [systemMessage, ...providerMessages],
          modelName,
          { temperature: 0.68, maxTokens: responseLengthConfig.maxOutputTokens },
          options.ollamaBaseUrl
        );

        if (rawReply && shouldRepairStructuredReply(latestUserText, rawReply)) {
          const repairedReply = await callTextProviderChatAPI(
            provider,
            apiKey,
            [
              systemMessage,
              ...providerMessages,
              { role: "assistant", content: rawReply },
              {
                role: "user",
                content: buildStructuredRepairPrompt(latestUserText, rawReply),
              },
            ],
            modelName,
            { temperature: 0.55, maxTokens: responseLengthConfig.maxOutputTokens },
            options.ollamaBaseUrl
          );
          if (repairedReply) rawReply = repairedReply;
        }

        const maxContinuationAttempts = getRequestedListCount(latestUserText) ? 3 : 2;
        for (
          let attempt = 0;
          rawReply && attempt < maxContinuationAttempts && (looksAbruptlyCutOff(rawReply) || needsListCompletion(latestUserText, rawReply));
          attempt += 1
        ) {
          const replyBeforeContinuation = stripDanglingReplyTail(rawReply) || rawReply;
          let continuation = "";
          try {
            continuation = await callTextProviderChatAPI(
              provider,
              apiKey,
              [
                systemMessage,
                ...providerMessages,
                { role: "assistant", content: replyBeforeContinuation },
                {
                  role: "user",
                  content: buildContinuationPrompt(latestUserText, replyBeforeContinuation),
                },
              ],
              modelName,
              { temperature: 0.35, maxTokens: responseLengthConfig.continuationMaxOutputTokens },
              options.ollamaBaseUrl
            );
          } catch (error) {
            console.warn(`${provider} chat continuation failed:`, error);
            rawReply = replyBeforeContinuation;
            break;
          }
          if (continuation) {
            rawReply = joinContinuationText(replyBeforeContinuation, continuation);
          } else {
            rawReply = replyBeforeContinuation;
            break;
          }
        }
        return finalizeChatResult(rawReply || "", agentName, otherPersonaNames);
      } catch (error) {
        console.error(`${provider} chat generation failed:`, error);
        return { reply: "죄송해요 답변 생성에 실패했어요.", action: { type: "none" } };
      }
    }

    // --- Gemini branch ---
    const isTrialChat = apiKey === DAYFLOW_TRIAL_API_KEY;
    const ai = isTrialChat ? null : new GoogleGenAI({ apiKey });
    const normalizedModelName = normalizeGeminiModelName(modelName);
    const generateGeminiChatContent = async (
      request: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
    ) => {
      if (!isTrialChat) {
        return generateGeminiContentWithRetry(ai as GoogleGenAI, request);
      }
      if (!options.trialTurnId) {
        throw new Error('Trial turn ID is required.');
      }
      return generateTrialGeminiContent({
        contents: request.contents,
        systemInstruction: request.config?.systemInstruction,
        safetySettings: request.config?.safetySettings,
        temperature: request.config?.temperature,
        maxOutputTokens: request.config?.maxOutputTokens,
        trialTurnId: options.trialTurnId,
      });
    };
    const response = await generateGeminiChatContent({
      model: normalizedModelName,
      contents: validContents,
      config: buildGeminiGenerationConfig(normalizedModelName, {
        systemInstruction: { parts: [{ text: geminiSystemInstruction }] },
        safetySettings: GEMINI_SAFETY_SETTINGS,
        temperature: 0.68,
        maxOutputTokens: responseLengthConfig.maxOutputTokens,
      }),
    });

    const firstResult = readGeminiResponseText(response);
    let text = firstResult.text;
    let outputLimitReached = endedByOutputLimit(firstResult.finishReason);

    if (text && shouldRepairStructuredReply(latestUserText, text)) {
      const repair = await generateGeminiChatContent({
        model: normalizedModelName,
        contents: [
          ...validContents,
          { role: "model", parts: [{ text }] },
          {
            role: "user",
            parts: [{
              text: buildStructuredRepairPrompt(latestUserText, text),
            }],
          },
        ],
        config: buildGeminiGenerationConfig(normalizedModelName, {
          systemInstruction: { parts: [{ text: geminiSystemInstruction }] },
          safetySettings: GEMINI_SAFETY_SETTINGS,
          temperature: 0.55,
          maxOutputTokens: responseLengthConfig.maxOutputTokens,
        }),
      });
      const repairText = readGeminiResponseText(repair).text;
      if (repairText) {
        text = repairText;
        outputLimitReached = false;
      }
    }

    const maxContinuationAttempts = getRequestedListCount(latestUserText) ? 3 : 2;
    for (
      let attempt = 0;
      text && attempt < maxContinuationAttempts && (outputLimitReached || looksAbruptlyCutOff(text) || needsListCompletion(latestUserText, text));
      attempt += 1
    ) {
      const textBeforeContinuation = stripDanglingReplyTail(text) || text;
      let continuation;
      try {
        continuation = await generateGeminiChatContent({
          model: normalizedModelName,
          contents: [
            ...validContents,
            { role: "model", parts: [{ text: textBeforeContinuation }] },
            {
              role: "user",
              parts: [{
                text: buildContinuationPrompt(latestUserText, textBeforeContinuation),
              }],
            },
          ],
          config: buildGeminiGenerationConfig(normalizedModelName, {
            systemInstruction: { parts: [{ text: geminiSystemInstruction }] },
            safetySettings: GEMINI_SAFETY_SETTINGS,
            temperature: 0.35,
            maxOutputTokens: responseLengthConfig.continuationMaxOutputTokens,
          }),
        });
      } catch (error) {
        console.warn("Chat continuation failed:", error);
        text = textBeforeContinuation;
        break;
      }
      const continuationResult = readGeminiResponseText(continuation);
      const continuationText = continuationResult.text;
      if (continuationText) {
        text = joinContinuationText(textBeforeContinuation, continuationText);
      } else {
        text = textBeforeContinuation;
        break;
      }
      outputLimitReached = endedByOutputLimit(continuationResult.finishReason);
    }

    return finalizeChatResult(text, agentName, otherPersonaNames);
  } catch (error) {
    if (isTrialExhaustedError(error)) throw error;
    console.error("Chat generation failed:", error);
    return { reply: "죄송해요 잠시 후 다시 시도해 주세요.", action: { type: "none" } };
  }
};

export const generateGroupChatResponses = async (
  apiKey: string,
  messageHistory: { role: "user" | "assistant"; content: string }[],
  _events: CalendarEvent[],
  _todos: Todo[],
  _journalEntries: JournalEntry[],
  userName: string,
  agents: AIAgent[],
  modelName: string = DEFAULT_GEMINI_MODEL,
  personaMemoryByAgent: Record<string, string> = {}
): Promise<GroupChatResult> => {
  if (!apiKey) throw new Error("API Key is required.");

  const selectedAgents = (agents || []).filter(Boolean).slice(0, 4);
  if (selectedAgents.length === 0) return { responses: [] };

  const ai = new GoogleGenAI({ apiKey });
  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const latestUserText = [...messageHistory].reverse().find((m) => m.role === "user")?.content || "";
  const punctuationInstruction = "JSON 문법은 지키고, reply에는 자연스러운 한국어 띄어쓰기와 문장부호를 사용하세요.";
  const noMetaInstruction = "reply 텍스트에는 내부 규칙, 시스템 지침, 분석 과정, 초안 문구, `Drafting final response`, `Okay no commas`, `Wait the user`, `Text:` 같은 메타 문장을 절대 넣지 마세요.";
  const completionInstruction = "reply는 반드시 완성된 한국어 문장으로 끝내세요. 토큰이 부족할 것 같으면 새 항목을 시작하지 말고 현재 문장을 자연스럽게 마무리하세요.";
  const lineBreakInstruction = "일반 대화와 롤플레이 답변은 한 문단을 1~2문장으로 유지하세요. 대사 뒤에 감정·행동·화제의 변화가 있으면 빈 줄로 문단을 나누고, 긴 답변은 최대 2문장마다 자연스럽게 끊으세요. 문장마다 억지로 줄바꿈하거나 모든 문장을 한 문단에 몰아넣지는 마세요.";
  const preferredUserName = userName?.trim() || "";
  const requestedListCount = getRequestedListCount(latestUserText);
  const listInstruction = requestedListCount
    ? `사용자가 ${requestedListCount}개 항목을 요구했습니다. 정확히 ${requestedListCount}개를 1. 2. 3. 형식으로 완성하세요.`
    : "";
  const needsTemporalContext = /(오늘|내일|어제|지금|현재|시간|날짜|요일|몇\s*시|일정|캘린더|마감|기한|오전|오후|이번\s*(주|달|월)|다음\s*(주|달|월))/i.test(latestUserText);
  const conversationContextLines = [
    `- 사용자 이름: ${preferredUserName}`,
    needsTemporalContext ? `- 날짜: ${today}` : "",
    needsTemporalContext ? `- 시간: ${currentTime}` : "",
  ].filter(Boolean).join("\n");
  const optionalInstructionLines = [
    listInstruction,
  ].filter(Boolean).map((line) => `${line}`).join("\n");

  const personaBlock = selectedAgents
    .map((persona, index) => {
      const memory = personaMemoryByAgent[persona.id]
        ? truncateForModel(personaMemoryByAgent[persona.id], 220)
        : "";
      const runtimePersonality = prepareAgentInstructionText(
        persona.personality || "도움이 되고 실용적인 성격",
        AGENT_PROFILE_CHAR_LIMIT
      );
      const runtimeTone = prepareAgentInstructionText(
        persona.tone?.trim() || "",
        AGENT_TONE_CHAR_LIMIT
      );

      return [
        `페르소나 ${index + 1}:`,
        `- id: ${persona.id}`,
        `- 이름: ${persona.name}`,
        `- 역할: ${persona.role || "인공지능 비서"}`,
        `- 성격: ${runtimePersonality || "도움이 되고 실용적인 성격"}`,
        runtimeTone ? `- 말투: ${runtimeTone}` : "",
        memory ? `- 기억:\n${memory}` : "- 기억: 없음",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const systemInstruction = `
당신은 Dayflow의 다중 페르소나 채팅 조율자입니다.
나열된 각 페르소나 id마다 정확히 하나의 답변을 생성하세요.

대화 상황:
${conversationContextLines}

문장부호 규칙: ${punctuationInstruction}
메타 출력 금지: ${noMetaInstruction}
완결성 규칙: ${completionInstruction}
줄바꿈 규칙: ${lineBreakInstruction}
${optionalInstructionLines}

페르소나 목록:
${personaBlock}

출력 규칙:
1. JSON만 반환하세요.
2. "responses"에는 나열된 모든 페르소나 id가 정확히 한 번씩 들어가야 합니다.
3. reply 텍스트에는 자연스러운 띄어쓰기와 문장부호를 사용하세요.
`;

  try {
    const validContents = toModelContents(messageHistory, CHAT_HISTORY_LIMIT, MODEL_MESSAGE_CHAR_LIMIT);
    const modelHistoryChars = validContents.reduce(
      (sum, item) => sum + item.parts.reduce((partSum, part) => partSum + (part.text || "").length, 0),
      0
    );
    logPromptBudget("group-chat", {
      modelName,
      agentCount: selectedAgents.length,
      rawAgentProfileChars: selectedAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        toneChars: (agent.tone || "").length,
        personalityChars: (agent.personality || "").length,
      })),
      personaBlockChars: personaBlock.length,
      historyChars: modelHistoryChars,
      systemInstructionChars: systemInstruction.length,
      estimatedInputTokens: estimateTokens(
        `${systemInstruction}\n${validContents
          .map((item) => item.parts.map((part) => part.text).join(""))
          .join("\n")}`
      ),
      maxOutputTokens: GROUP_CHAT_MAX_OUTPUT_TOKENS,
    });
    const response = await generateGeminiContentWithRetry(ai, {
      model: normalizeGeminiModelName(modelName),
      contents: validContents,
      config: buildGeminiGenerationConfig(modelName, {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        safetySettings: GEMINI_SAFETY_SETTINGS,
        responseMimeType: "application/json",
        temperature: 0.55,
        maxOutputTokens: GROUP_CHAT_MAX_OUTPUT_TOKENS,
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
                },
                required: ["agentId", "reply"],
              },
            },
          },
          required: ["responses"],
        },
      }),
    });

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
          ? formatVisibleReply(raw.reply.trim())
          : `${persona.name}입니다. 이어서 도와드릴게요.`;

      const action =
        index === 0
          ? sanitizeAction()
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
        reply: "죄송해요 잠시 후 다시 시도해 주세요.",
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
