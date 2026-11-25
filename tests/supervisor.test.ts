import { beforeEach, describe, expect, it } from "vitest";
import { resetStepIds, runTeam } from "../src/lib/supervisor.js";
import { queueClient } from "./helpers.js";

const task = { prompt: "Write a unique function that adds two numbers", language: "typescript" as const };

const research = {
  goal: "Add two numbers",
  constraints: ["Pure function"],
  approach: "Return a + b",
  pitfalls: ["Non-numeric input"],
  acceptance: ["1 + 2 is 3"],
};

const code = {
  language: "typescript",
  filename: "add.ts",
  code: "export const add = (a: number, b: number) => a + b;",
  notes: "Simple adder",
};

const approved = {
  status: "approved",
  summary: "Fine",
  issues: [],
  hints: [],
};

const changes = {
  status: "changes_requested",
  summary: "Add a type guard",
  issues: [{ severity: "must-fix", message: "Reject non-numbers." }],
  hints: ["Return null on bad input"],
};

beforeEach(() => {
  resetStepIds();
});

describe("runTeam", () => {
  it("routes researcher, coder and reviewer and finishes when the review is approved", async () => {
    const result = await runTeam(
      task,
      queueClient([JSON.stringify(research), JSON.stringify(code), JSON.stringify(approved)]),
    );
    expect(result.status).toBe("approved");
    expect(result.revisions).toBe(0);
    expect(result.code?.filename).toBe("add.ts");
    expect(result.steps.some((step) => step.title === "Task accepted")).toBe(true);
    expect(result.steps.filter((step) => step.status === "valid").length).toBeGreaterThanOrEqual(3);
  });

  it("sends the work back to the coder and stops after two rejected revisions", async () => {
    const result = await runTeam(
      task,
      queueClient([
        JSON.stringify(research),
        JSON.stringify(code),
        JSON.stringify(changes),
        JSON.stringify({ ...code, notes: "Revision 1" }),
        JSON.stringify(changes),
        JSON.stringify({ ...code, notes: "Revision 2" }),
        JSON.stringify(changes),
      ]),
    );
    expect(result.status).toBe("changes_requested");
    expect(result.revisions).toBe(2);
    expect(result.code?.notes).toBe("Revision 2");
    expect(result.steps.some((step) => step.title.includes("revision 2/2"))).toBe(true);
  });

  it("retries a malformed researcher payload once and then continues", async () => {
    const result = await runTeam(
      task,
      queueClient(["this is not json", JSON.stringify(research), JSON.stringify(code), JSON.stringify(approved)]),
    );
    expect(result.status).toBe("approved");
    expect(result.steps.some((step) => step.status === "retrying")).toBe(true);
    expect(result.steps.some((step) => step.status === "invalid")).toBe(true);
  });

  it("fails the run when the coder cannot produce a valid payload in two attempts", async () => {
    const result = await runTeam(
      task,
      queueClient([JSON.stringify(research), "not-json", "still-not-json"]),
    );
    expect(result.status).toBe("failed");
    expect(result.research?.goal).toBe("Add two numbers");
    expect(result.code).toBeUndefined();
    expect(result.notice ?? result.steps.at(-1)?.detail).toMatch(/Coder failed/i);
  });

  it("rejects a changes_requested verdict that only contains nits, then accepts a valid retry", async () => {
    const nitOnly = { status: "changes_requested", summary: "nits", issues: [{ severity: "nit", message: "Rename" }] };
    const result = await runTeam(
      task,
      queueClient([
        JSON.stringify(research),
        JSON.stringify(code),
        JSON.stringify(nitOnly),
        JSON.stringify(approved),
      ]),
    );
    expect(result.status).toBe("approved");
    expect(result.steps.some((step) => /must-fix/i.test(step.detail ?? ""))).toBe(true);
  });
});
