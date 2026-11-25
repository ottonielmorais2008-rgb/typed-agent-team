import { z } from "zod";

export const LANGUAGES = ["typescript", "javascript", "python"] as const;
export const LanguageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof LanguageSchema>;

export const MAX_PROMPT_CHARS = 2_000;

export const TaskSchema = z.object({
  prompt: z.string().trim().min(8, "Describe the task in at least 8 characters.").max(MAX_PROMPT_CHARS),
  language: LanguageSchema.default("typescript"),
});
export type Task = z.infer<typeof TaskSchema>;

export const ResearchNotesSchema = z.object({
  goal: z.string().trim().min(1).max(500),
  constraints: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  approach: z.string().trim().min(1).max(800),
  pitfalls: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  acceptance: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
});
export type ResearchNotes = z.infer<typeof ResearchNotesSchema>;

export const CodeOutputSchema = z.object({
  language: LanguageSchema,
  filename: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[\w][\w./-]*\.\w+$/, "Filename must look like path/name.ext"),
  code: z.string().min(1).max(8_000),
  notes: z.string().trim().min(1).max(800),
});
export type CodeOutput = z.infer<typeof CodeOutputSchema>;

export const ReviewIssueSchema = z.object({
  severity: z.enum(["must-fix", "nit"]),
  message: z.string().trim().min(1).max(400),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

export const ReviewVerdictSchema = z
  .object({
    status: z.enum(["approved", "changes_requested"]),
    summary: z.string().trim().min(1).max(600),
    issues: z.array(ReviewIssueSchema).max(8),
    hints: z.array(z.string().trim().min(1).max(240)).max(6).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.status === "changes_requested") {
      const mustFix = value.issues.filter((issue) => issue.severity === "must-fix");
      if (mustFix.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "changes_requested requires at least one must-fix issue.",
          path: ["issues"],
        });
      }
    }
  });
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const AGENTS = ["supervisor", "researcher", "coder", "reviewer"] as const;
export const AgentSchema = z.enum(AGENTS);
export type Agent = z.infer<typeof AgentSchema>;

export const StepStatusSchema = z.enum(["running", "retrying", "valid", "invalid", "info"]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const AgentStepSchema = z.object({
  id: z.string().min(1),
  agent: AgentSchema,
  title: z.string().min(1).max(120),
  status: StepStatusSchema,
  attempt: z.number().int().min(1),
  detail: z.string().max(800).optional(),
  payload: z.unknown().optional(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const RunStatusSchema = z.enum(["running", "approved", "changes_requested", "failed"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunModeSchema = z.enum(["live", "demo", "sample"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RunResultSchema = z.object({
  task: TaskSchema,
  steps: z.array(AgentStepSchema).min(1),
  research: ResearchNotesSchema.optional(),
  code: CodeOutputSchema.optional(),
  review: ReviewVerdictSchema.optional(),
  revisions: z.number().int().min(0).max(2),
  status: RunStatusSchema,
  mode: RunModeSchema,
  notice: z.string().max(400).optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export function parseTask(input: unknown): { ok: true; task: Task } | { ok: false; error: string } {
  const parsed = TaskSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "A valid coding task is required." };
  }
  return { ok: true, task: parsed.data };
}

export function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "The payload failed schema validation.";
  const path = first.path.length ? first.path.join(".") : "payload";
  return `${path}: ${first.message}`;
}
