import type { LlmClient } from "./supervisor.js";
import {
  type CodeOutput,
  type Language,
  type ResearchNotes,
  type ReviewVerdict,
  type RunResult,
  type Task,
} from "./schemas.js";
import { LANGUAGE_EXT } from "./prompts.js";

export const SAMPLE_TASK: Task = {
  prompt:
    "Write a TypeScript function that validates an IBAN and returns the country code plus a checksum verdict.",
  language: "typescript",
};

export const SAMPLE_TASKS: Task[] = [
  SAMPLE_TASK,
  {
    prompt: "Write a TypeScript function that scores password strength and lists every rule that failed.",
    language: "typescript",
  },
  {
    prompt: "Write a TypeScript function that parses a single CSV line and keeps commas that sit inside quotes.",
    language: "typescript",
  },
];

const SAMPLE_RESEARCH: ResearchNotes = {
  goal: "Validate an IBAN string and return the country code with a checksum verdict.",
  constraints: [
    "Accept spaced or compact input and compare in a case-insensitive way.",
    "Do not call the network or depend on a country registry beyond the two-letter prefix.",
    "Return a structured result rather than throwing on ordinary invalid input.",
  ],
  approach:
    "Normalise the input, check the country prefix and total length, then apply the ISO 13616 move-and-mod-97 checksum.",
  pitfalls: [
    "Forgetting to move the first four characters to the end before the checksum.",
    "Mapping letters to numbers incorrectly (A must be 10, not 1).",
    "Using Number() on the whole rearranged string, which overflows.",
  ],
  acceptance: [
    "A well-known valid IBAN such as GB82 WEST 1234 5698 7654 32 is accepted.",
    "A one-character checksum typo is rejected.",
    "Empty, too-short, and non-alphanumeric values are rejected with a clear reason.",
  ],
};

const FIRST_CODE = `export type IbanVerdict = {
  ok: boolean;
  country: string | null;
  reason: string;
};

const MIN_LENGTH = 15;
const MAX_LENGTH = 34;

export function validateIban(input: string): IbanVerdict {
  const compact = input.replace(/\\s+/g, "").toUpperCase();
  if (!compact) return { ok: false, country: null, reason: "empty" };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(compact)) {
    return { ok: false, country: null, reason: "malformed" };
  }
  if (compact.length < MIN_LENGTH || compact.length > MAX_LENGTH) {
    return { ok: false, country: compact.slice(0, 2), reason: "length" };
  }
  return { ok: true, country: compact.slice(0, 2), reason: "format" };
}
`;

const REVISED_CODE = `export type IbanVerdict = {
  ok: boolean;
  country: string | null;
  reason: string;
};

const MIN_LENGTH = 15;
const MAX_LENGTH = 34;

export function validateIban(input: string): IbanVerdict {
  const compact = input.replace(/\\s+/g, "").toUpperCase();
  if (!compact) return { ok: false, country: null, reason: "empty" };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(compact)) {
    return { ok: false, country: null, reason: "malformed" };
  }
  const country = compact.slice(0, 2);
  if (compact.length < MIN_LENGTH || compact.length > MAX_LENGTH) {
    return { ok: false, country, reason: "length" };
  }
  if (mod97(rearrange(compact)) !== 1) {
    return { ok: false, country, reason: "checksum" };
  }
  return { ok: true, country, reason: "valid" };
}

function rearrange(iban: string): string {
  return iban.slice(4) + iban.slice(0, 4);
}

function mod97(value: string): number {
  const expanded = value.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const char of expanded) {
    rest = (rest * 10 + Number(char)) % 97;
  }
  return rest;
}
`;

const FIRST_REVIEW: ReviewVerdict = {
  status: "changes_requested",
  summary: "The format checks are fine, but the function never runs the ISO 13616 checksum, so a typo would still pass.",
  issues: [
    {
      severity: "must-fix",
      message: "Implement the move-four-characters-and-mod-97 checksum and return a distinct checksum failure.",
    },
    {
      severity: "nit",
      message: "The success reason is labelled 'format', which will be misleading once the checksum exists.",
    },
  ],
  hints: [
    "Move the first four characters to the end, map A–Z to 10–35, then reduce the number modulo 97 in chunks.",
    "A valid check is GB82WEST12345698765432; flipping a single digit should fail.",
  ],
};

const FINAL_REVIEW: ReviewVerdict = {
  status: "approved",
  summary: "The checksum is implemented correctly and ordinary invalid input is rejected with a structured reason.",
  issues: [
    {
      severity: "nit",
      message: "Country-specific length tables are optional and were correctly left out of this first version.",
    },
  ],
  hints: [],
};

export const SAMPLE_CODE: CodeOutput = {
  language: "typescript",
  filename: "iban.ts",
  code: REVISED_CODE.trim() + "\n",
  notes: "Normalises spaces and case, checks the prefix and length, then applies the ISO 13616 mod-97 checksum without using BigInt.",
};

export function isSampleTask(task: Task): boolean {
  return normalize(task.prompt) === normalize(SAMPLE_TASK.prompt) && task.language === SAMPLE_TASK.language;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function createMockClient(): LlmClient {
  let coderDrafts = 0;
  return {
    async complete({ role, user }) {
      const task = taskFromUser(user);
      if (role === "researcher") {
        return JSON.stringify(isSampleTask(task) ? SAMPLE_RESEARCH : genericResearch(task));
      }
      if (role === "coder") {
        coderDrafts += 1;
        const revised = coderDrafts > 1;
        return JSON.stringify(isSampleTask(task) ? sampleCode(revised) : genericCode(task, revised));
      }
      return JSON.stringify(isSampleTask(task) ? (coderDrafts > 1 ? FINAL_REVIEW : FIRST_REVIEW) : genericReview(coderDrafts > 1));
    },
  };
}

function sampleCode(revised: boolean): CodeOutput {
  if (!revised) {
    return {
      language: "typescript",
      filename: "iban.ts",
      code: FIRST_CODE.trim() + "\n",
      notes: "Normalises the IBAN and checks the country prefix and length. The checksum is still missing.",
    };
  }
  return SAMPLE_CODE;
}

function taskFromUser(user: string): Task {
  const language = (user.match(/Language:\s+(typescript|javascript|python)/i)?.[1]?.toLowerCase() ??
    "typescript") as Language;
  const taskBlock = user.match(/Task:\n([\s\S]*?)(?:\n\n[A-Z]|$)/);
  const prompt = taskBlock?.[1]?.trim() || user.slice(0, 200);
  return { prompt, language };
}

function genericResearch(task: Task): ResearchNotes {
  return {
    goal: `Implement the requested ${task.language} solution.`,
    constraints: [
      `Write the solution in ${task.language}.`,
      "Keep the surface area small and return structured results for invalid input.",
      "Do not depend on the network or hidden global state.",
    ],
    approach: `Read the task, cover the main path and two or three edge cases, and export a clearly named function.`,
    pitfalls: [
      "Skipping empty or nullish input.",
      "Throwing instead of returning a structured failure.",
      "Leaving the happy path untested in comments or notes.",
    ],
    acceptance: [
      "The main example implied by the task works.",
      "Invalid or empty input is rejected without throwing.",
      "The exported function name and types are obvious to a caller.",
    ],
  };
}

function genericCode(task: Task, revised: boolean): CodeOutput {
  const ext = LANGUAGE_EXT[task.language];
  const filename = `solution.${ext}`;
  const headline = task.prompt.replace(/\s+/g, " ").trim();
  if (task.language === "python") {
    const first = `def solve(value: str) -> dict:\n    if not value:\n        return {"ok": False, "reason": "empty"}\n    return {"ok": True, "value": value.strip(), "reason": "todo"}\n`;
    const second = `def solve(value: str) -> dict:\n    if not isinstance(value, str) or not value.strip():\n        return {"ok": False, "reason": "empty"}\n    cleaned = value.strip()\n    return {"ok": True, "value": cleaned, "reason": "ok"}\n`;
    return {
      language: "python",
      filename,
      code: revised ? second : first,
      notes: revised ? `Revised implementation for: ${headline}` : `First draft for: ${headline}. Edge-case handling is still thin.`,
    };
  }
  const typings = task.language === "typescript" ? ": string" : "";
  const ret = task.language === "typescript" ? ": { ok: boolean; value?: string; reason: string }" : "";
  const first = `export function solve(value${typings})${ret} {\n  if (!value) return { ok: false, reason: "empty" };\n  return { ok: true, value: value.trim(), reason: "todo" };\n}\n`;
  const second = `export function solve(value${typings})${ret} {\n  if (typeof value !== "string" || !value.trim()) {\n    return { ok: false, reason: "empty" };\n  }\n  const cleaned = value.trim();\n  return { ok: true, value: cleaned, reason: "ok" };\n}\n`;
  return {
    language: task.language,
    filename,
    code: revised ? second : first,
    notes: revised ? `Revised implementation for: ${headline}` : `First draft for: ${headline}. Input checks are still incomplete.`,
  };
}

function genericReview(revised: boolean): ReviewVerdict {
  if (!revised) {
    return {
      status: "changes_requested",
      summary: "The first draft is a stub. Add real input checks and a clear success path before this can be approved.",
      issues: [
        {
          severity: "must-fix",
          message: "Reject empty or non-string input explicitly and do not return a 'todo' success reason.",
        },
      ],
      hints: ["Trim the input, return a structured error for empty values, and describe the success path in notes."],
    };
  }
  return {
    status: "approved",
    summary: "The revised function handles empty input and returns a structured result.",
    issues: [{ severity: "nit", message: "This is a compact first version; domain-specific rules can be added later." }],
    hints: [],
  };
}

export function buildSampleRun(): RunResult {
  return {
    task: SAMPLE_TASK,
    research: SAMPLE_RESEARCH,
    code: SAMPLE_CODE,
    review: FINAL_REVIEW,
    revisions: 1,
    status: "approved",
    mode: "sample",
    notice: "This is a canned sample run. It does not call the model.",
    steps: [
      {
        id: "sample-1",
        agent: "supervisor",
        title: "Task accepted",
        status: "info",
        attempt: 1,
        detail: "Routing a typescript task through Researcher → Coder → Reviewer.",
        payload: SAMPLE_TASK,
      },
      {
        id: "sample-2",
        agent: "researcher",
        title: "Research notes validated",
        status: "valid",
        attempt: 1,
        detail: "Payload passed the Zod schema.",
        payload: SAMPLE_RESEARCH,
      },
      {
        id: "sample-3",
        agent: "coder",
        title: "Implementation validated",
        status: "valid",
        attempt: 1,
        detail: "Payload passed the Zod schema.",
        payload: sampleCode(false),
      },
      {
        id: "sample-4",
        agent: "reviewer",
        title: "Review validated",
        status: "valid",
        attempt: 1,
        detail: "Payload passed the Zod schema.",
        payload: FIRST_REVIEW,
      },
      {
        id: "sample-5",
        agent: "supervisor",
        title: "Sending back to the Coder (revision 1/2)",
        status: "info",
        attempt: 1,
        detail: FIRST_REVIEW.summary,
        payload: FIRST_REVIEW,
      },
      {
        id: "sample-6",
        agent: "coder",
        title: "Revision 1 validated",
        status: "valid",
        attempt: 1,
        detail: "Payload passed the Zod schema.",
        payload: SAMPLE_CODE,
      },
      {
        id: "sample-7",
        agent: "reviewer",
        title: "Review validated",
        status: "valid",
        attempt: 1,
        detail: "Payload passed the Zod schema.",
        payload: FINAL_REVIEW,
      },
      {
        id: "sample-8",
        agent: "supervisor",
        title: "Run complete",
        status: "valid",
        attempt: 1,
        detail: "The reviewer approved revision 1.",
      },
    ],
  };
}
