// src/lib/schemas.ts
import { z } from "zod";
var LANGUAGES = ["typescript", "javascript", "python"];
var LanguageSchema = z.enum(LANGUAGES);
var MAX_PROMPT_CHARS = 2e3;
var TaskSchema = z.object({
  prompt: z.string().trim().min(8, "Describe the task in at least 8 characters.").max(MAX_PROMPT_CHARS),
  language: LanguageSchema.default("typescript")
});
var ResearchNotesSchema = z.object({
  goal: z.string().trim().min(1).max(500),
  constraints: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  approach: z.string().trim().min(1).max(800),
  pitfalls: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  acceptance: z.array(z.string().trim().min(1).max(240)).min(1).max(8)
});
var CodeOutputSchema = z.object({
  language: LanguageSchema,
  filename: z.string().trim().min(1).max(80).regex(/^[\w][\w./-]*\.\w+$/, "Filename must look like path/name.ext"),
  code: z.string().min(1).max(8e3),
  notes: z.string().trim().min(1).max(800)
});
var ReviewIssueSchema = z.object({
  severity: z.enum(["must-fix", "nit"]),
  message: z.string().trim().min(1).max(400)
});
var ReviewVerdictSchema = z.object({
  status: z.enum(["approved", "changes_requested"]),
  summary: z.string().trim().min(1).max(600),
  issues: z.array(ReviewIssueSchema).max(8),
  hints: z.array(z.string().trim().min(1).max(240)).max(6).default([])
}).superRefine((value, ctx) => {
  if (value.status === "changes_requested") {
    const mustFix = value.issues.filter((issue) => issue.severity === "must-fix");
    if (mustFix.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "changes_requested requires at least one must-fix issue.",
        path: ["issues"]
      });
    }
  }
});
var AGENTS = ["supervisor", "researcher", "coder", "reviewer"];
var AgentSchema = z.enum(AGENTS);
var StepStatusSchema = z.enum(["running", "retrying", "valid", "invalid", "info"]);
var AgentStepSchema = z.object({
  id: z.string().min(1),
  agent: AgentSchema,
  title: z.string().min(1).max(120),
  status: StepStatusSchema,
  attempt: z.number().int().min(1),
  detail: z.string().max(800).optional(),
  payload: z.unknown().optional()
});
var RunStatusSchema = z.enum(["running", "approved", "changes_requested", "failed"]);
var RunModeSchema = z.enum(["live", "demo", "sample"]);
var RunResultSchema = z.object({
  task: TaskSchema,
  steps: z.array(AgentStepSchema).min(1),
  research: ResearchNotesSchema.optional(),
  code: CodeOutputSchema.optional(),
  review: ReviewVerdictSchema.optional(),
  revisions: z.number().int().min(0).max(2),
  status: RunStatusSchema,
  mode: RunModeSchema,
  notice: z.string().max(400).optional()
});
function parseTask(input) {
  const parsed = TaskSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "A valid coding task is required." };
  }
  return { ok: true, task: parsed.data };
}
function formatZodError(error) {
  const first = error.issues[0];
  if (!first) return "The payload failed schema validation.";
  const path = first.path.length ? first.path.join(".") : "payload";
  return `${path}: ${first.message}`;
}

// src/lib/prompts.ts
var RESEARCHER_SYSTEM = `You are the Researcher on a small typed agent team that implements a coding task.
Return ONLY a JSON object with this exact shape:
{
  "goal": "one-sentence goal",
  "constraints": ["short constraint", "..."],
  "approach": "short plan of the implementation",
  "pitfalls": ["likely mistake", "..."],
  "acceptance": ["testable acceptance check", "..."]
}
Rules:
- 1\u20136 items in each array, all non-empty strings.
- Stay faithful to the user's task. Do not change the language they asked for.
- No markdown, no code fences, no commentary outside the JSON.`;
var CODER_SYSTEM = `You are the Coder on a small typed agent team.
Return ONLY a JSON object with this exact shape:
{
  "language": "typescript" | "javascript" | "python",
  "filename": "path/name.ext",
  "code": "full source of one file",
  "notes": "what you implemented and any leftover risks"
}
Rules:
- Implement the task using the research notes (and reviewer hints when present).
- Prefer a small, complete, readable solution with clear names. Include a couple of obvious edge cases.
- language and filename must match the requested language.
- No markdown, no code fences around the JSON, no commentary outside the JSON.`;
var REVIEWER_SYSTEM = `You are the Reviewer on a small typed agent team.
Return ONLY a JSON object with this exact shape:
{
  "status": "approved" | "changes_requested",
  "summary": "short verdict",
  "issues": [{ "severity": "must-fix" | "nit", "message": "concrete issue" }],
  "hints": ["actionable hint for the coder"]
}
Rules:
- If status is "changes_requested", include at least one issue with severity "must-fix".
- Approve only if the code meets the acceptance checks well enough for a first version.
- Do not request changes for style nits alone. Do not invent requirements that were not in the task or notes.
- No markdown, no code fences, no commentary outside the JSON.`;
function researcherUser(task) {
  return `Language: ${task.language}
Task:
${task.prompt}`;
}
function coderUser(task, research, review, revision = 0) {
  const parts = [
    `Language: ${task.language}`,
    `Task:
${task.prompt}`,
    `Research notes (JSON):
${JSON.stringify(research)}`
  ];
  if (review && revision > 0) {
    parts.push(`This is revision ${revision} of at most 2. Address every must-fix issue.`);
    parts.push(`Previous review (JSON):
${JSON.stringify(review)}`);
  }
  return parts.join("\n\n");
}
function reviewerUser(task, research, code, revision) {
  return [
    `Language: ${task.language}`,
    `Task:
${task.prompt}`,
    `Research notes (JSON):
${JSON.stringify(research)}`,
    `Code (JSON):
${JSON.stringify(code)}`,
    `Revision number: ${revision} of at most 2.`
  ].join("\n\n");
}
var LANGUAGE_EXT = {
  typescript: "ts",
  javascript: "js",
  python: "py"
};

// src/lib/demo.ts
var SAMPLE_TASK = {
  prompt: "Write a TypeScript function that validates an IBAN and returns the country code plus a checksum verdict.",
  language: "typescript"
};
var SAMPLE_RESEARCH = {
  goal: "Validate an IBAN string and return the country code with a checksum verdict.",
  constraints: [
    "Accept spaced or compact input and compare in a case-insensitive way.",
    "Do not call the network or depend on a country registry beyond the two-letter prefix.",
    "Return a structured result rather than throwing on ordinary invalid input."
  ],
  approach: "Normalise the input, check the country prefix and total length, then apply the ISO 13616 move-and-mod-97 checksum.",
  pitfalls: [
    "Forgetting to move the first four characters to the end before the checksum.",
    "Mapping letters to numbers incorrectly (A must be 10, not 1).",
    "Using Number() on the whole rearranged string, which overflows."
  ],
  acceptance: [
    "A well-known valid IBAN such as GB82 WEST 1234 5698 7654 32 is accepted.",
    "A one-character checksum typo is rejected.",
    "Empty, too-short, and non-alphanumeric values are rejected with a clear reason."
  ]
};
var FIRST_CODE = `export type IbanVerdict = {
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
var REVISED_CODE = `export type IbanVerdict = {
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
var FIRST_REVIEW = {
  status: "changes_requested",
  summary: "The format checks are fine, but the function never runs the ISO 13616 checksum, so a typo would still pass.",
  issues: [
    {
      severity: "must-fix",
      message: "Implement the move-four-characters-and-mod-97 checksum and return a distinct checksum failure."
    },
    {
      severity: "nit",
      message: "The success reason is labelled 'format', which will be misleading once the checksum exists."
    }
  ],
  hints: [
    "Move the first four characters to the end, map A\u2013Z to 10\u201335, then reduce the number modulo 97 in chunks.",
    "A valid check is GB82WEST12345698765432; flipping a single digit should fail."
  ]
};
var FINAL_REVIEW = {
  status: "approved",
  summary: "The checksum is implemented correctly and ordinary invalid input is rejected with a structured reason.",
  issues: [
    {
      severity: "nit",
      message: "Country-specific length tables are optional and were correctly left out of this first version."
    }
  ],
  hints: []
};
var SAMPLE_CODE = {
  language: "typescript",
  filename: "iban.ts",
  code: REVISED_CODE.trim() + "\n",
  notes: "Normalises spaces and case, checks the prefix and length, then applies the ISO 13616 mod-97 checksum without using BigInt."
};
function isSampleTask(task) {
  return normalize(task.prompt) === normalize(SAMPLE_TASK.prompt) && task.language === SAMPLE_TASK.language;
}
function normalize(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
function createMockClient() {
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
      return JSON.stringify(isSampleTask(task) ? coderDrafts > 1 ? FINAL_REVIEW : FIRST_REVIEW : genericReview(coderDrafts > 1));
    }
  };
}
function sampleCode(revised) {
  if (!revised) {
    return {
      language: "typescript",
      filename: "iban.ts",
      code: FIRST_CODE.trim() + "\n",
      notes: "Normalises the IBAN and checks the country prefix and length. The checksum is still missing."
    };
  }
  return SAMPLE_CODE;
}
function taskFromUser(user) {
  const language = user.match(/Language:\s+(typescript|javascript|python)/i)?.[1]?.toLowerCase() ?? "typescript";
  const taskBlock = user.match(/Task:\n([\s\S]*?)(?:\n\n[A-Z]|$)/);
  const prompt = taskBlock?.[1]?.trim() || user.slice(0, 200);
  return { prompt, language };
}
function genericResearch(task) {
  return {
    goal: `Implement the requested ${task.language} solution.`,
    constraints: [
      `Write the solution in ${task.language}.`,
      "Keep the surface area small and return structured results for invalid input.",
      "Do not depend on the network or hidden global state."
    ],
    approach: `Read the task, cover the main path and two or three edge cases, and export a clearly named function.`,
    pitfalls: [
      "Skipping empty or nullish input.",
      "Throwing instead of returning a structured failure.",
      "Leaving the happy path untested in comments or notes."
    ],
    acceptance: [
      "The main example implied by the task works.",
      "Invalid or empty input is rejected without throwing.",
      "The exported function name and types are obvious to a caller."
    ]
  };
}
function genericCode(task, revised) {
  const ext = LANGUAGE_EXT[task.language];
  const filename = `solution.${ext}`;
  const headline = task.prompt.replace(/\s+/g, " ").trim();
  if (task.language === "python") {
    const first2 = `def solve(value: str) -> dict:
    if not value:
        return {"ok": False, "reason": "empty"}
    return {"ok": True, "value": value.strip(), "reason": "todo"}
`;
    const second2 = `def solve(value: str) -> dict:
    if not isinstance(value, str) or not value.strip():
        return {"ok": False, "reason": "empty"}
    cleaned = value.strip()
    return {"ok": True, "value": cleaned, "reason": "ok"}
`;
    return {
      language: "python",
      filename,
      code: revised ? second2 : first2,
      notes: revised ? `Revised implementation for: ${headline}` : `First draft for: ${headline}. Edge-case handling is still thin.`
    };
  }
  const typings = task.language === "typescript" ? ": string" : "";
  const ret = task.language === "typescript" ? ": { ok: boolean; value?: string; reason: string }" : "";
  const first = `export function solve(value${typings})${ret} {
  if (!value) return { ok: false, reason: "empty" };
  return { ok: true, value: value.trim(), reason: "todo" };
}
`;
  const second = `export function solve(value${typings})${ret} {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, reason: "empty" };
  }
  const cleaned = value.trim();
  return { ok: true, value: cleaned, reason: "ok" };
}
`;
  return {
    language: task.language,
    filename,
    code: revised ? second : first,
    notes: revised ? `Revised implementation for: ${headline}` : `First draft for: ${headline}. Input checks are still incomplete.`
  };
}
function genericReview(revised) {
  if (!revised) {
    return {
      status: "changes_requested",
      summary: "The first draft is a stub. Add real input checks and a clear success path before this can be approved.",
      issues: [
        {
          severity: "must-fix",
          message: "Reject empty or non-string input explicitly and do not return a 'todo' success reason."
        }
      ],
      hints: ["Trim the input, return a structured error for empty values, and describe the success path in notes."]
    };
  }
  return {
    status: "approved",
    summary: "The revised function handles empty input and returns a structured result.",
    issues: [{ severity: "nit", message: "This is a compact first version; domain-specific rules can be added later." }],
    hints: []
  };
}

// src/lib/gemini.ts
var DEFAULT_MODEL = "gemini-3.5-flash-lite";
function getGeminiApiKey(env = process.env) {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return void 0;
  return key.trim();
}
function getModelId(env = process.env) {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}
function createGeminiClient(apiKey, model, fetchFn = fetch) {
  return {
    async complete({ system, user }) {
      return callGemini({ system, user, model, apiKey, fetchFn });
    }
  };
}
async function callGemini(options) {
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
        maxOutputTokens: 2048,
        responseMimeType: "application/json"
      }
    })
  });
  if (!response.ok) throw new Error("The model service is unavailable right now.");
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The model returned an empty response.");
  return text;
}

// src/lib/http.ts
var MAX_BODY_BYTES = 8192;
function methodOf(req) {
  return (req.method ?? "GET").toUpperCase();
}
function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}
function byteLength(value) {
  return new TextEncoder().encode(value).length;
}
function tooLarge(req, max = MAX_BODY_BYTES) {
  const length = header(req, "content-length");
  if (length && Number(length) > max) return true;
  if (typeof req.body === "string" && byteLength(req.body) > max) return true;
  return false;
}
function readJsonBody(req) {
  if (req.body == null || req.body === "") {
    return { ok: false, error: "Invalid JSON body." };
  }
  if (typeof req.body === "string") {
    try {
      return { ok: true, value: JSON.parse(req.body) };
    } catch {
      return { ok: false, error: "Invalid JSON body." };
    }
  }
  return { ok: true, value: req.body };
}
function cors(res) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
}

// src/lib/rate-limit.ts
var hits = /* @__PURE__ */ new Map();
function allow(key, limit = 20, windowMs = 6e4, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5e3) hits.clear();
  return true;
}
function clientIp(headers, fallback = "unknown") {
  const forwarded = headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value && value.trim()) return value.split(",")[0].trim();
  const real = headers["x-real-ip"];
  const realValue = Array.isArray(real) ? real[0] : real;
  if (realValue && realValue.trim()) return realValue.trim();
  return fallback;
}

// src/lib/supervisor.ts
import "zod";

// src/lib/json.ts
function parseJsonPayload(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("The model returned an empty response.");
  }
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : trimmed).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The model response did not contain a JSON object.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("The model response was not valid JSON.");
  }
}

// src/lib/supervisor.ts
var MAX_SCHEMA_ATTEMPTS = 2;
var MAX_REVISIONS = 2;
var stepSeq = 0;
function nextId(prefix) {
  stepSeq += 1;
  return `${prefix}-${stepSeq}`;
}
function step(partial) {
  return { id: partial.id ?? nextId(partial.agent), ...partial };
}
async function callValidated(options) {
  const steps = [];
  const emit = (event) => {
    steps.push(event);
    options.onEvent?.(event);
  };
  let lastError = "The agent returned an invalid payload.";
  for (let attempt = 1; attempt <= MAX_SCHEMA_ATTEMPTS; attempt += 1) {
    emit(
      step({
        agent: options.role,
        title: attempt === 1 ? options.title : `${options.title} (retry)`,
        status: attempt === 1 ? "running" : "retrying",
        attempt,
        detail: attempt === 1 ? "Waiting for a schema-valid JSON payload." : `Previous payload failed validation: ${lastError}`
      })
    );
    try {
      const raw = await options.client.complete({
        role: options.role,
        system: options.system,
        user: attempt === 1 ? options.user : `${options.user}

Your previous reply was rejected: ${lastError}
Reply with valid JSON only, matching the required schema.`
      });
      const parsed = parseJsonPayload(raw);
      const checked = options.schema.safeParse(parsed);
      if (!checked.success) {
        lastError = formatZodError(checked.error);
        emit(
          step({
            agent: "supervisor",
            title: `Rejected ${options.role} output`,
            status: "invalid",
            attempt,
            detail: lastError
          })
        );
        continue;
      }
      emit(
        step({
          agent: options.role,
          title: `${options.title} validated`,
          status: "valid",
          attempt,
          detail: "Payload passed the Zod schema.",
          payload: checked.data
        })
      );
      return { ok: true, value: checked.data, steps };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "The agent call failed.";
      emit(
        step({
          agent: "supervisor",
          title: `Rejected ${options.role} output`,
          status: "invalid",
          attempt,
          detail: lastError
        })
      );
    }
  }
  return { ok: false, error: lastError, steps };
}
async function runTeam(task, client, options = {}) {
  const steps = [];
  const emit = (event) => {
    steps.push(event);
    options.onEvent?.(event);
  };
  const mode = options.mode ?? "live";
  emit(
    step({
      agent: "supervisor",
      title: "Task accepted",
      status: "info",
      attempt: 1,
      detail: `Routing a ${task.language} task through Researcher \u2192 Coder \u2192 Reviewer.`,
      payload: task
    })
  );
  const researchCall = await callValidated({
    schema: ResearchNotesSchema,
    role: "researcher",
    title: "Research notes",
    system: RESEARCHER_SYSTEM,
    user: researcherUser(task),
    client,
    onEvent: emit
  });
  if (!researchCall.ok) {
    return fail(task, steps, mode, options.notice, `Researcher failed schema validation: ${researchCall.error}`);
  }
  const research = researchCall.value;
  let review;
  let code;
  let revisions = 0;
  while (true) {
    const coderCall = await callValidated({
      schema: CodeOutputSchema,
      role: "coder",
      title: revisions === 0 ? "Implementation" : `Revision ${revisions}`,
      system: CODER_SYSTEM,
      user: coderUser(task, research, review, revisions),
      client,
      onEvent: emit
    });
    if (!coderCall.ok) {
      return fail(task, steps, mode, options.notice, `Coder failed schema validation: ${coderCall.error}`, {
        research,
        code,
        review,
        revisions
      });
    }
    code = coderCall.value;
    const reviewerCall = await callValidated({
      schema: ReviewVerdictSchema,
      role: "reviewer",
      title: "Review",
      system: REVIEWER_SYSTEM,
      user: reviewerUser(task, research, code, revisions),
      client,
      onEvent: emit
    });
    if (!reviewerCall.ok) {
      return fail(task, steps, mode, options.notice, `Reviewer failed schema validation: ${reviewerCall.error}`, {
        research,
        code,
        review,
        revisions
      });
    }
    const verdict = {
      ...reviewerCall.value,
      hints: reviewerCall.value.hints ?? []
    };
    review = verdict;
    if (verdict.status === "approved") {
      emit(
        step({
          agent: "supervisor",
          title: "Run complete",
          status: "valid",
          attempt: 1,
          detail: revisions === 0 ? "The reviewer approved the first draft." : `The reviewer approved revision ${revisions}.`
        })
      );
      return {
        task,
        steps,
        research,
        code,
        review,
        revisions,
        status: "approved",
        mode,
        notice: options.notice
      };
    }
    if (revisions >= MAX_REVISIONS) {
      emit(
        step({
          agent: "supervisor",
          title: "Stopped after two revisions",
          status: "info",
          attempt: 1,
          detail: "The reviewer still wants changes. The latest code and review are shown as-is."
        })
      );
      return {
        task,
        steps,
        research,
        code,
        review,
        revisions,
        status: "changes_requested",
        mode,
        notice: options.notice
      };
    }
    revisions += 1;
    emit(
      step({
        agent: "supervisor",
        title: `Sending back to the Coder (revision ${revisions}/${MAX_REVISIONS})`,
        status: "info",
        attempt: 1,
        detail: verdict.summary,
        payload: verdict
      })
    );
  }
}
function fail(task, steps, mode, notice, error, extra = {}) {
  steps.push(
    step({
      agent: "supervisor",
      title: "Run stopped",
      status: "invalid",
      attempt: 1,
      detail: error
    })
  );
  return {
    task,
    steps,
    research: extra.research,
    code: extra.code,
    review: extra.review,
    revisions: extra.revisions ?? 0,
    status: "failed",
    mode,
    notice: notice ?? error
  };
}

// src/lib/api.ts
var RUN_LIMIT = 4;
var RUN_WINDOW_MS = 6e4;
function resolveMode(requested, hasKey) {
  if (requested === "demo") {
    return { mode: "demo", useMock: true, notice: "Demo mode is using a local mock team, not the live model." };
  }
  if (requested === "live" || requested == null || requested === "") {
    if (!hasKey) {
      return {
        mode: "demo",
        useMock: true,
        notice: "No API key is configured, so this run used the built-in demo team."
      };
    }
    return { mode: "live", useMock: false };
  }
  return { mode: "demo", useMock: true, notice: "Unknown mode; falling back to the built-in demo team." };
}
async function executeRun(input, deps = {}) {
  const body = input ?? {};
  const parsed = parseTask({ prompt: body.prompt, language: body.language });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const env = deps.env ?? process.env;
  const apiKey = getGeminiApiKey(env);
  const resolved = resolveMode(body.mode, Boolean(apiKey));
  const client = deps.client ?? (resolved.useMock ? createMockClient() : createGeminiClient(apiKey, getModelId(env)));
  try {
    let result = await runTeam(parsed.task, client, { mode: resolved.mode, notice: resolved.notice });
    if (result.status === "failed" && !resolved.useMock) {
      result = await runTeam(parsed.task, createMockClient(), {
        mode: "demo",
        notice: "The live model failed, so this run used the built-in demo team instead."
      });
    }
    return { ok: true, result };
  } catch {
    if (!resolved.useMock) {
      const result = await runTeam(parsed.task, createMockClient(), {
        mode: "demo",
        notice: "The live model failed, so this run used the built-in demo team instead."
      });
      return { ok: true, result };
    }
    return { ok: false, status: 502, error: "The agent team could not complete this run." };
  }
}
async function handleRunHttp(req, res, deps = {}) {
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

// server/run.ts
var maxDuration = 60;
async function handler(req, res) {
  await handleRunHttp(req, res);
}
export {
  handler as default,
  maxDuration
};
