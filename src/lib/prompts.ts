import type { CodeOutput, Language, ResearchNotes, ReviewVerdict, Task } from "./schemas.js";

export const RESEARCHER_SYSTEM = `You are the Researcher on a small typed agent team that implements a coding task.
Return ONLY a JSON object with this exact shape:
{
  "goal": "one-sentence goal",
  "constraints": ["short constraint", "..."],
  "approach": "short plan of the implementation",
  "pitfalls": ["likely mistake", "..."],
  "acceptance": ["testable acceptance check", "..."]
}
Rules:
- 1–6 items in each array, all non-empty strings.
- Stay faithful to the user's task. Do not change the language they asked for.
- No markdown, no code fences, no commentary outside the JSON.`;

export const CODER_SYSTEM = `You are the Coder on a small typed agent team.
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

export const REVIEWER_SYSTEM = `You are the Reviewer on a small typed agent team.
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

export function researcherUser(task: Task): string {
  return `Language: ${task.language}\nTask:\n${task.prompt}`;
}

export function coderUser(task: Task, research: ResearchNotes, review?: ReviewVerdict, revision = 0): string {
  const parts = [
    `Language: ${task.language}`,
    `Task:\n${task.prompt}`,
    `Research notes (JSON):\n${JSON.stringify(research)}`,
  ];
  if (review && revision > 0) {
    parts.push(`This is revision ${revision} of at most 2. Address every must-fix issue.`);
    parts.push(`Previous review (JSON):\n${JSON.stringify(review)}`);
  }
  return parts.join("\n\n");
}

export function reviewerUser(task: Task, research: ResearchNotes, code: CodeOutput, revision: number): string {
  return [
    `Language: ${task.language}`,
    `Task:\n${task.prompt}`,
    `Research notes (JSON):\n${JSON.stringify(research)}`,
    `Code (JSON):\n${JSON.stringify(code)}`,
    `Revision number: ${revision} of at most 2.`,
  ].join("\n\n");
}

export const LANGUAGE_EXT: Record<Language, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
};
