import { beforeEach, describe, expect, it } from "vitest";
import { executeRun, handleRunHttp, RUN_LIMIT, resolveMode } from "../src/lib/api.js";
import { resetRateLimit } from "../src/lib/rate-limit.js";
import { SAMPLE_TASK } from "../src/lib/demo.js";
import { FakeResponse, post, queueClient } from "./helpers.js";

beforeEach(() => {
  resetRateLimit();
});

describe("resolveMode", () => {
  it("uses the mock team when demo is requested or when no key is present", () => {
    expect(resolveMode("demo", true)).toMatchObject({ mode: "demo", useMock: true });
    expect(resolveMode("live", false)).toMatchObject({ mode: "demo", useMock: true });
    expect(resolveMode("live", true)).toEqual({ mode: "live", useMock: false });
  });
});

describe("executeRun", () => {
  it("rejects a short prompt", async () => {
    const result = await executeRun({ prompt: "short" });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("runs the mock team when no key is configured", async () => {
    const result = await executeRun({ prompt: SAMPLE_TASK.prompt, language: "typescript" }, { env: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.mode).toBe("demo");
      expect(result.result.status).toBe("approved");
      expect(result.result.notice).toMatch(/no api key/i);
    }
  });

  it("falls back to the demo team when the live model fails", async () => {
    const result = await executeRun(
      { prompt: SAMPLE_TASK.prompt, language: "typescript", mode: "live" },
      { env: { GEMINI_API_KEY: "test-key" }, client: queueClient([new Error("down")]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.mode).toBe("demo");
      expect(result.result.status).toBe("approved");
      expect(result.result.notice).toMatch(/live model failed/i);
    }
  });
});

describe("handleRunHttp", () => {
  it("answers OPTIONS and rejects methods other than POST", async () => {
    const options = new FakeResponse();
    await handleRunHttp({ method: "OPTIONS" }, options);
    expect(options.statusCode).toBe(204);
    const wrong = new FakeResponse();
    await handleRunHttp({ method: "GET" }, wrong);
    expect(wrong.statusCode).toBe(405);
  });

  it("rejects invalid JSON, oversized bodies and too many runs", async () => {
    const invalid = new FakeResponse();
    await handleRunHttp(post("{"), invalid);
    expect(invalid.statusCode).toBe(400);

    const huge = new FakeResponse();
    await handleRunHttp(post("x", { body: "n".repeat(9000), headers: { "content-length": "9000" } }), huge);
    expect(huge.statusCode).toBe(413);

    for (let i = 0; i < RUN_LIMIT; i += 1) {
      const ok = new FakeResponse();
      await handleRunHttp(post({ prompt: SAMPLE_TASK.prompt, mode: "demo" }), ok);
      expect(ok.statusCode).toBe(200);
    }
    const limited = new FakeResponse();
    await handleRunHttp(post({ prompt: SAMPLE_TASK.prompt, mode: "demo" }), limited);
    expect(limited.statusCode).toBe(429);
  });
});
