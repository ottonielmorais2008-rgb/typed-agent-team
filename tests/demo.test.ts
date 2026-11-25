import { describe, expect, it } from "vitest";
import { buildSampleRun, createMockClient, isSampleTask, SAMPLE_TASK } from "../src/lib/demo.js";
import { CodeOutputSchema, ResearchNotesSchema, ReviewVerdictSchema, RunResultSchema } from "../src/lib/schemas.js";
import { runTeam } from "../src/lib/supervisor.js";

describe("sample run and mock team", () => {
  it("exposes a schema-valid canned sample that includes one revision loop", () => {
    const sample = buildSampleRun();
    expect(RunResultSchema.parse(sample).status).toBe("approved");
    expect(sample.mode).toBe("sample");
    expect(sample.revisions).toBe(1);
    expect(sample.code?.code).toMatch(/mod97/);
    expect(sample.steps.some((step) => step.title.includes("revision 1/2"))).toBe(true);
    expect(isSampleTask(SAMPLE_TASK)).toBe(true);
    expect(isSampleTask({ prompt: "something else entirely here", language: "typescript" })).toBe(false);
  });

  it("lets the mock team research, request changes, revise and approve the sample task", async () => {
    const result = await runTeam(SAMPLE_TASK, createMockClient(), { mode: "demo" });
    expect(result.status).toBe("approved");
    expect(result.revisions).toBe(1);
    expect(result.mode).toBe("demo");
    expect(ResearchNotesSchema.parse(result.research).acceptance.length).toBeGreaterThan(0);
    expect(CodeOutputSchema.parse(result.code).filename).toBe("iban.ts");
    expect(ReviewVerdictSchema.parse(result.review).status).toBe("approved");
    expect(result.code?.code).toContain("mod97");
  });

  it("still produces valid hand-offs for a custom task in another language", async () => {
    const result = await runTeam(
      { prompt: "Write a function that reverses a string safely", language: "python" },
      createMockClient(),
      { mode: "demo" },
    );
    expect(result.status).toBe("approved");
    expect(result.revisions).toBe(1);
    expect(result.code?.language).toBe("python");
    expect(result.code?.filename).toMatch(/\.py$/);
    expect(result.code?.code).toMatch(/def solve/);
  });
});
