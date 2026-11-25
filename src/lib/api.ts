import { createMockClient } from "./demo.js";
import { createGeminiClient, getGeminiApiKey, getModelId, type EnvMap } from "./gemini.js";
import { cors, methodOf, readJsonBody, tooLarge, type HttpRequest, type HttpResponse } from "./http.js";
import { allow, clientIp } from "./rate-limit.js";
import { parseTask, type RunMode, type RunResult } from "./schemas.js";
import { runTeam, type LlmClient } from "./supervisor.js";

export const RUN_LIMIT = 4;
export const RUN_WINDOW_MS = 60_000;

export interface RunRequest {
  prompt?: unknown;
  language?: unknown;
  mode?: unknown;
}

export function resolveMode(
  requested: unknown,
  hasKey: boolean,
): { mode: Exclude<RunMode, "sample">; notice?: string; useMock: boolean } {
  if (requested === "demo") {
    return { mode: "demo", useMock: true, notice: "Demo mode is using a local mock team, not the live model." };
  }
  if (requested === "live" || requested == null || requested === "") {
    if (!hasKey) {
      return {
        mode: "demo",
        useMock: true,
        notice: "No API key is configured, so this run used the built-in demo team.",
      };
    }
    return { mode: "live", useMock: false };
  }
  return { mode: "demo", useMock: true, notice: "Unknown mode; falling back to the built-in demo team." };
}

export async function executeRun(
  input: unknown,
  deps: { env?: EnvMap; client?: LlmClient; generate?: LlmClient } = {},
): Promise<{ ok: true; result: RunResult } | { ok: false; status: number; error: string }> {
  const body = (input ?? {}) as RunRequest;
  const parsed = parseTask({ prompt: body.prompt, language: body.language });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const env = deps.env ?? process.env;
  const apiKey = getGeminiApiKey(env);
  const resolved = resolveMode(body.mode, Boolean(apiKey));
  const client =
    deps.client ??
    (resolved.useMock ? createMockClient() : createGeminiClient(apiKey!, getModelId(env)));

  try {
    let result = await runTeam(parsed.task, client, { mode: resolved.mode, notice: resolved.notice });
    if (result.status === "failed" && !resolved.useMock) {
      result = await runTeam(parsed.task, createMockClient(), {
        mode: "demo",
        notice: "The live model failed, so this run used the built-in demo team instead.",
      });
    }
    return { ok: true, result };
  } catch {
    if (!resolved.useMock) {
      const result = await runTeam(parsed.task, createMockClient(), {
        mode: "demo",
        notice: "The live model failed, so this run used the built-in demo team instead.",
      });
      return { ok: true, result };
    }
    return { ok: false, status: 502, error: "The agent team could not complete this run." };
  }
}

export async function handleRunHttp(
  req: HttpRequest,
  res: HttpResponse,
  deps: { env?: EnvMap; client?: LlmClient; now?: number } = {},
): Promise<void> {
  cors(res);
  if (methodOf(req) === "OPTIONS") {
    res.status(204).json(null);
    return;
  }
  if (methodOf(req) !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (tooLarge(req)) {
    res.status(413).json({ error: "The request is too large." });
    return;
  }
  const body = readJsonBody(req);
  if (!body.ok) {
    res.status(400).json({ error: body.error });
    return;
  }
  const ip = clientIp(req.headers ?? {}, req.socket?.remoteAddress ?? "unknown");
  if (!allow(`run:${ip}`, RUN_LIMIT, RUN_WINDOW_MS, deps.now ?? Date.now())) {
    res.status(429).json({ error: "Too many runs. Please wait a moment and try again." });
    return;
  }
  const result = await executeRun(body.value, deps);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(200).json(result.result);
}
