import type { LlmClient } from "./supervisor.js";

export type EnvMap = Record<string, string | undefined>;

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export function getGeminiApiKey(env: EnvMap = process.env): string | undefined {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return undefined;
  return key.trim();
}

export function getModelId(env: EnvMap = process.env): string {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}

export function createGeminiClient(
  apiKey: string,
  model: string,
  fetchFn: typeof fetch = fetch,
): LlmClient {
  return {
    async complete({ system, user }) {
      return callGemini({ system, user, model, apiKey, fetchFn });
    },
  };
}

export async function callGemini(options: {
  system: string;
  user: string;
  model: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": options.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: options.system }] },
      contents: [{ role: "user", parts: [{ text: options.user }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2_048,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!response.ok) throw new Error("The model service is unavailable right now.");
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The model returned an empty response.");
  return text;
}
