import { z, type ZodType } from "zod";
import { parseJsonPayload } from "./json.js";
import { coderUser, CODER_SYSTEM, researcherUser, RESEARCHER_SYSTEM, reviewerUser, REVIEWER_SYSTEM } from "./prompts.js";
import {
  type Agent,
  type AgentStep,
  CodeOutputSchema,
  formatZodError,
  type ResearchNotes,
  ResearchNotesSchema,
  type ReviewVerdict,
  ReviewVerdictSchema,
  type RunMode,
  type RunResult,
  type Task,
} from "./schemas.js";

export const MAX_SCHEMA_ATTEMPTS = 2;
export const MAX_REVISIONS = 2;

export interface LlmClient {
  complete(input: { role: Exclude<Agent, "supervisor">; system: string; user: string }): Promise<string>;
}

export type RunEvent = AgentStep;

let stepSeq = 0;

function nextId(prefix: string): string {
  stepSeq += 1;
  return `${prefix}-${stepSeq}`;
}

export function resetStepIds(): void {
  stepSeq = 0;
}

function step(partial: Omit<AgentStep, "id"> & { id?: string }): AgentStep {
  return { id: partial.id ?? nextId(partial.agent), ...partial };
}

async function callValidated<T>(
  options: {
    schema: ZodType<T>;
    role: Exclude<Agent, "supervisor">;
    title: string;
    system: string;
    user: string;
    client: LlmClient;
    onEvent?: (event: RunEvent) => void;
  },
): Promise<{ ok: true; value: T; steps: AgentStep[] } | { ok: false; error: string; steps: AgentStep[] }> {
  const steps: AgentStep[] = [];
  const emit = (event: AgentStep) => {
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
        detail: attempt === 1 ? "Waiting for a schema-valid JSON payload." : `Previous payload failed validation: ${lastError}`,
      }),
    );
    try {
      const raw = await options.client.complete({
        role: options.role,
        system: options.system,
        user:
          attempt === 1
            ? options.user
            : `${options.user}\n\nYour previous reply was rejected: ${lastError}\nReply with valid JSON only, matching the required schema.`,
      });
      const parsed = parseJsonPayload(raw);
      const checked = options.schema.safeParse(parsed);
      if (!checked.success) {
        lastError = formatZodError(checked.error as z.ZodError);
        emit(
          step({
            agent: "supervisor",
            title: `Rejected ${options.role} output`,
            status: "invalid",
            attempt,
            detail: lastError,
          }),
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
          payload: checked.data,
        }),
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
          detail: lastError,
        }),
      );
    }
  }
  return { ok: false, error: lastError, steps };
}

export async function runTeam(
  task: Task,
  client: LlmClient,
  options: { mode?: RunMode; notice?: string; onEvent?: (event: RunEvent) => void } = {},
): Promise<RunResult> {
  const steps: AgentStep[] = [];
  const emit = (event: AgentStep) => {
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
      detail: `Routing a ${task.language} task through Researcher → Coder → Reviewer.`,
      payload: task,
    }),
  );

  const researchCall = await callValidated({
    schema: ResearchNotesSchema,
    role: "researcher",
    title: "Research notes",
    system: RESEARCHER_SYSTEM,
    user: researcherUser(task),
    client,
    onEvent: emit,
  });
  if (!researchCall.ok) {
    return fail(task, steps, mode, options.notice, `Researcher failed schema validation: ${researchCall.error}`);
  }
  const research = researchCall.value;

  let review: ReviewVerdict | undefined;
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
      onEvent: emit,
    });
    if (!coderCall.ok) {
      return fail(task, steps, mode, options.notice, `Coder failed schema validation: ${coderCall.error}`, {
        research,
        code,
        review,
        revisions,
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
      onEvent: emit,
    });
    if (!reviewerCall.ok) {
      return fail(task, steps, mode, options.notice, `Reviewer failed schema validation: ${reviewerCall.error}`, {
        research,
        code,
        review,
        revisions,
      });
    }
    const verdict: ReviewVerdict = {
      ...reviewerCall.value,
      hints: reviewerCall.value.hints ?? [],
    };
    review = verdict;

    if (verdict.status === "approved") {
      emit(
        step({
          agent: "supervisor",
          title: "Run complete",
          status: "valid",
          attempt: 1,
          detail: revisions === 0 ? "The reviewer approved the first draft." : `The reviewer approved revision ${revisions}.`,
        }),
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
        notice: options.notice,
      };
    }

    if (revisions >= MAX_REVISIONS) {
      emit(
        step({
          agent: "supervisor",
          title: "Stopped after two revisions",
          status: "info",
          attempt: 1,
          detail: "The reviewer still wants changes. The latest code and review are shown as-is.",
        }),
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
        notice: options.notice,
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
        payload: verdict,
      }),
    );
  }
}

function fail(
  task: Task,
  steps: AgentStep[],
  mode: RunMode,
  notice: string | undefined,
  error: string,
  extra: { research?: ResearchNotes; code?: RunResult["code"]; review?: ReviewVerdict; revisions?: number } = {},
): RunResult {
  steps.push(
    step({
      agent: "supervisor",
      title: "Run stopped",
      status: "invalid",
      attempt: 1,
      detail: error,
    }),
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
    notice: notice ?? error,
  };
}
