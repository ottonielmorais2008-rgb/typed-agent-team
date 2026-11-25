import { useEffect, useMemo, useState } from "react";
import { buildSampleRun, SAMPLE_TASK, SAMPLE_TASKS } from "./lib/demo";
import type { Agent, AgentStep, Language, RunResult, Task } from "./lib/schemas";

const SOURCE_URL = "https://github.com/ottonielmorais2008-rgb/typed-agent-team";

const AGENT_LABEL: Record<Agent, string> = {
  supervisor: "Supervisor",
  researcher: "Researcher",
  coder: "Coder",
  reviewer: "Reviewer",
};

export function App() {
  const [prompt, setPrompt] = useState(SAMPLE_TASK.prompt);
  const [language, setLanguage] = useState<Language>(SAMPLE_TASK.language);
  const [run, setRun] = useState<RunResult | null>(buildSampleRun);
  const [visible, setVisible] = useState(buildSampleRun().steps.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!run) {
      setVisible(0);
      return;
    }
    if (run.mode === "sample" && visible === run.steps.length) return;
    setVisible(0);
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setVisible(count);
      if (count >= run.steps.length) window.clearInterval(timer);
    }, 180);
    return () => window.clearInterval(timer);
  }, [run]);

  const shown = useMemo(() => run?.steps.slice(0, visible) ?? [], [run, visible]);
  const latestCode = useMemo(() => latestPayload(shown, "coder"), [shown]);
  const latestReview = useMemo(() => latestPayload(shown, "reviewer"), [shown]);
  const latestResearch = useMemo(() => latestPayload(shown, "researcher"), [shown]);

  async function submit(mode: "live" | "demo") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, language, mode }),
      });
      const payload = (await response.json()) as RunResult & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The team could not complete this run.");
        return;
      }
      setRun(payload);
    } catch {
      setError("The request failed. You can still play the sample run.");
    } finally {
      setBusy(false);
    }
  }

  function playSample() {
    setError(null);
    setPrompt(SAMPLE_TASK.prompt);
    setLanguage(SAMPLE_TASK.language);
    setVisible(0);
    setRun(buildSampleRun());
  }

  function applyChip(task: Task) {
    setPrompt(task.prompt);
    setLanguage(task.language);
  }

  return (
    <div className="page">
      <header className="hero">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <h1>Typed Multi-Agent Team</h1>
            <p className="tagline">
              A supervisor routes a coding task through a Researcher, a Coder and a Reviewer. Every hand-off
              is validated with Zod before the next agent can start.
            </p>
          </div>
        </div>
        <div className="badges">
          <span className="badge">Zod contracts</span>
          <span className="badge">Max 2 revisions</span>
          <a className="badge link" href={SOURCE_URL} target="_blank" rel="noreferrer">
            Source
          </a>
        </div>
      </header>

      <section className="panel form" aria-label="Task">
        <label htmlFor="task">Coding task</label>
        <textarea
          id="task"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Describe the function you want the team to implement…"
        />
        <div className="form-row">
          <label className="inline">
            Language
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
            </select>
          </label>
          <div className="actions">
            <button type="button" className="primary" disabled={busy || prompt.trim().length < 8} onClick={() => void submit("live")}>
              {busy ? "Running…" : "Run the team"}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void submit("demo")}>
              Run in demo mode
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={playSample}>
              Play sample run
            </button>
          </div>
        </div>
        <div className="chips" aria-label="Example tasks">
          {SAMPLE_TASKS.map((task) => (
            <button key={task.prompt} type="button" className="chip" onClick={() => applyChip(task)}>
              {shortLabel(task.prompt)}
            </button>
          ))}
        </div>
      </section>

      {error ? <p className="banner error">{error}</p> : null}
      {run?.notice ? <p className="banner">{run.notice}</p> : null}

      <div className="layout">
        <section className="panel timeline-panel" aria-label="Run timeline">
          <div className="panel-head">
            <h2>Timeline</h2>
            {run ? <StatusPill result={run} /> : null}
          </div>
          {busy && !shown.length ? <p className="muted">The supervisor is starting the team…</p> : null}
          <ol className="timeline">
            {shown.map((item) => (
              <TimelineItem key={item.id} step={item} />
            ))}
          </ol>
        </section>

        <div className="side">
          {isResearch(latestResearch) ? (
            <section className="panel">
              <h2>Research notes</h2>
              <p>{latestResearch.goal}</p>
              <List title="Approach" items={[latestResearch.approach]} />
              <List title="Constraints" items={latestResearch.constraints} />
              <List title="Pitfalls" items={latestResearch.pitfalls} />
              <List title="Acceptance" items={latestResearch.acceptance} />
            </section>
          ) : null}

          {isCode(latestCode) ? (
            <section className="panel code-panel">
              <div className="panel-head">
                <h2>{latestCode.filename}</h2>
                <span className="badge">{latestCode.language}</span>
              </div>
              <pre>
                <code>{latestCode.code}</code>
              </pre>
              <p className="muted small">{latestCode.notes}</p>
            </section>
          ) : null}

          {isReview(latestReview) ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Review</h2>
                <span className={`badge ${latestReview.status === "approved" ? "ok" : "warn"}`}>
                  {latestReview.status === "approved" ? "Approved" : "Changes requested"}
                </span>
              </div>
              <p>{latestReview.summary}</p>
              {latestReview.issues.length ? <List title="Issues" items={latestReview.issues.map(issueLine)} /> : null}
              {latestReview.hints.length ? <List title="Hints" items={latestReview.hints} /> : null}
            </section>
          ) : null}
        </div>
      </div>

      <footer className="fineprint">
        <p>
          The live path calls Gemini <code>gemini-3.5-flash-lite</code> from a serverless function. The API key never
          ships to the browser. If the key is missing or the model fails, the page falls back to a deterministic demo
          team so the flow still works.
        </p>
        <p>
          Limits: the reviewer can send the work back at most twice; malformed agent output is retried once and then
          stops the run. This is an educational demo, not a production coding agent.
        </p>
      </footer>
    </div>
  );
}

function TimelineItem({ step }: { step: AgentStep }) {
  return (
    <li className={`event agent-${step.agent} status-${step.status}`}>
      <div className="event-meta">
        <span className="agent">{AGENT_LABEL[step.agent]}</span>
        <span className="status">{statusLabel(step)}</span>
      </div>
      <h3>{step.title}</h3>
      {step.detail ? <p className="muted small">{step.detail}</p> : null}
    </li>
  );
}

function StatusPill({ result }: { result: RunResult }) {
  const label =
    result.status === "approved"
      ? "Approved"
      : result.status === "changes_requested"
        ? "Needs changes"
        : result.status === "failed"
          ? "Stopped"
          : "Running";
  return <span className={`badge ${result.status}`}>{`${label} · ${result.mode}`}</span>;
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="list">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function shortLabel(prompt: string): string {
  if (prompt.includes("IBAN")) return "Validate an IBAN";
  if (prompt.includes("password")) return "Password strength";
  if (prompt.includes("CSV")) return "Parse a CSV line";
  return prompt.slice(0, 32);
}

function issueLine(issue: { severity: string; message: string }): string {
  return `${issue.severity}: ${issue.message}`;
}

function statusLabel(step: AgentStep): string {
  if (step.status === "valid") return "Schema valid";
  if (step.status === "invalid") return "Schema rejected";
  if (step.status === "retrying") return "Retrying";
  if (step.status === "running") return "Running";
  return "Info";
}

function latestPayload(steps: AgentStep[], agent: Agent): unknown {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const item = steps[index];
    if (item?.agent === agent && item.status === "valid" && item.payload != null) return item.payload;
  }
  return undefined;
}

function isResearch(value: unknown): value is {
  goal: string;
  approach: string;
  constraints: string[];
  pitfalls: string[];
  acceptance: string[];
} {
  return Boolean(value && typeof value === "object" && "goal" in value && "acceptance" in value);
}

function isCode(value: unknown): value is { language: string; filename: string; code: string; notes: string } {
  return Boolean(value && typeof value === "object" && "filename" in value && "code" in value);
}

function isReview(value: unknown): value is {
  status: "approved" | "changes_requested";
  summary: string;
  issues: { severity: string; message: string }[];
  hints: string[];
} {
  return Boolean(value && typeof value === "object" && "status" in value && "summary" in value);
}
