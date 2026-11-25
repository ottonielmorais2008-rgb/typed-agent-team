# Typed Multi-Agent Team

**Live demo:** https://typed-agent-team.vercel.app

Give the team a coding task. A supervisor sends it to a Researcher, then a Coder, then a Reviewer. The reviewer can send the work back for at most two revisions. Every hand-off is a JSON payload that must pass a Zod schema before the next agent starts; a malformed reply is retried once and then stops the run.

The page opens on a sample IBAN validator so you can see a full loop, including a review that requests changes, without calling a model.

## How a run works

1. **Researcher** — produces a goal, constraints, an approach, pitfalls and acceptance checks.
2. **Coder** — writes a single source file that follows those notes (and any review hints on a revision).
3. **Reviewer** — either approves the file or requests changes. A `changes_requested` verdict must include at least one `must-fix` issue.
4. **Supervisor** — validates each payload, retries once on a schema miss, and stops after two revisions even if the reviewer is not yet satisfied.

### Live model and demo mode

"Run the team" posts the task to a Vercel serverless function that calls Gemini (`gemini-3.5-flash-lite`). The API key lives only in Vercel environment variables and is never sent to the browser. Requests are rate-limited and size-capped.

If the key is missing or the model fails, the same supervisor loop runs against a deterministic mock team, so the page still works. "Play sample run" is a canned timeline and does not call the network at all.

## Tech

- React 19, TypeScript, Vite
- Zod schemas for the task, research notes, code output, review verdict and the run result
- Vercel serverless function for the optional Gemini path
- Vitest unit tests for the schemas, the supervisor loop (with a mocked model), the demo team and the API handler
- GitHub Actions: lint, typecheck, test and build on every push and pull request

```
src/lib/schemas.ts      Zod contracts for every hand-off
src/lib/supervisor.ts   Researcher → Coder → Reviewer loop, retries and revision cap
src/lib/demo.ts         Sample IBAN run and the mock team
src/lib/api.ts          /api/run handler, rate limit and live-to-demo fallback
```

## Limits

- The coder returns a single file, not a multi-file project.
- The reviewer may send work back at most twice.
- Malformed model output is retried once; a second failure stops the run.
- The mock team and the canned sample are deterministic stand-ins, not a measure of model quality.
- This is an educational demo of typed agent hand-offs, not a production coding agent.

## Running it yourself

Requires Node.js 20.9+.

```bash
npm install
npm test
npm run dev
```

The Vite dev server also serves `/api/run`. To try the live model locally, copy `.env.example` to `.env` and set `GEMINI_API_KEY`. The sample run and demo mode work without it.

## License

[MIT](LICENSE)
