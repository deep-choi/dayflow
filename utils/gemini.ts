import { ApiUsageStats } from '../types';
import { DEFAULT_GEMINI_MODEL, normalizeGeminiModelName } from './aiConfig';

/**
 * Interface for Gemini API Response
 */
interface GeminiResponse {
    candidates: {
        finishReason?: string;
        content: {
            parts: {
                text: string;
            }[];
        };
    }[];
}

interface GeminiCallOptions {
    temperature?: number;
    maxOutputTokens?: number;
}

/**
 * Call the Google Gemini API to generate content.
 * Note: In a production app, this should ideally go through a backend to protect the API Key.
 */
export const callGeminiAPI = async (
    apiKey: string,
    prompt: string,
    updateUsage?: (stats: ApiUsageStats) => void,
    modelName: string = DEFAULT_GEMINI_MODEL,
    options?: GeminiCallOptions
): Promise<string> => {
    if (!apiKey) {
        throw new Error('API Key가 필요합니다.');
    }

    const normalizedModelName = normalizeGeminiModelName(modelName);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${normalizedModelName}:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: prompt }],
                    },
                ],
                generationConfig: {
                    temperature: options?.temperature ?? 0.5,
                    maxOutputTokens: options?.maxOutputTokens ?? 768,
                }
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'API 요청 중 오류가 발생했습니다.');
        }

        const data: GeminiResponse = await response.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const text = parts
            .map(part => part?.text || '')
            .join('')
            .trim();

        if (!text) {
            throw new Error('응답이 비어 있습니다.');
        }

        // Update usage stats if callback provided
        if (updateUsage) {
            // Basic simulation of token count (approximation)
            const estimatedTokens = Math.ceil((prompt.length + text.length) / 4);
            updateUsage({
                totalRequests: 1, // This will be added to the current total
                totalTokens: estimatedTokens,
                lastRequestDate: new Date().toISOString(),
            });
        }

        return text.trim();
    } catch (error) {
        console.error('Gemini API Error:', error);
        throw error;
    }
};

/**
 * Create a specialized prompt for an AI agent persona.
 */
export const createAgentPrompt = (
    persona: { name: string; role: string; personality: string; tone: string },
    context: string,
    userAction: string
): string => {
    return `
You are "${persona.name}".
Role: ${persona.role}
Personality: ${persona.personality}
Tone: ${persona.tone}

Context:
${context}

User action:
${userAction}

Write a Korean response that sounds natural and empathetic.
Length target: 5-8 sentences (roughly 220-420 Korean characters).
Use short line breaks to improve readability.
`;
};
