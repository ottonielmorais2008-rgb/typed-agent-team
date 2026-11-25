import { describe, expect, it } from "vitest";
import { formatZodError, parseTask, ResearchNotesSchema, ReviewVerdictSchema, TaskSchema } from "../src/lib/schemas.js";
import { CodeOutputSchema } from "../src/lib/schemas.js";

describe("task schema", () => {
  it("accepts a normal coding task and defaults the language to TypeScript", () => {
    const parsed = parseTask({ prompt: "Write a unique function" });
    expect(parsed).toEqual({ ok: true, task: { prompt: "Write a unique function", language: "typescript" } });
  });

  it("trims the prompt and rejects a short or oversized description", () => {
    expect(parseTask({ prompt: "  short  " }).ok).toBe(false);
    expect(parseTask({ prompt: "x".repeat(2001) }).ok).toBe(false);
    expect(TaskSchema.safeParse({ prompt: "  long enough task  ", language: "python" }).data).toEqual({
      prompt: "long enough task",
      language: "python",
    });
  });

  it("rejects an unknown language", () => {
    expect(parseTask({ prompt: "Write a unique function", language: "ruby" }).ok).toBe(false);
  });
});

describe("research, code and review schemas", () => {
  const notes = {
    goal: "Build it",
    constraints: ["Stay small"],
    approach: "Write a function",
    pitfalls: ["Empty input"],
    acceptance: ["It works"],
  };

  it("accepts complete research notes and rejects an empty list", () => {
    expect(ResearchNotesSchema.parse(notes).goal).toBe("Build it");
    expect(ResearchNotesSchema.safeParse({ ...notes, constraints: [] }).success).toBe(false);
  });

  it("requires a filename with an extension", () => {
    const code = { language: "typescript", filename: "iban.ts", code: "export {}", notes: "ok" };
    expect(CodeOutputSchema.parse(code).filename).toBe("iban.ts");
    expect(CodeOutputSchema.safeParse({ ...code, filename: "iban" }).success).toBe(false);
    expect(CodeOutputSchema.safeParse({ ...code, filename: "../secret.ts" }).success).toBe(false);
  });

  it("requires a must-fix issue when changes are requested, and allows an approved review with nits", () => {
    const approved = ReviewVerdictSchema.parse({
      status: "approved",
      summary: "Looks good",
      issues: [{ severity: "nit", message: "Optional length tables can wait." }],
    });
    expect(approved.hints).toEqual([]);
    const rejected = ReviewVerdictSchema.safeParse({
      status: "changes_requested",
      summary: "Not yet",
      issues: [{ severity: "nit", message: "Rename a variable" }],
    });
    expect(rejected.success).toBe(false);
    expect(formatZodError(rejected.error!)).toMatch(/must-fix/i);
  });
});
