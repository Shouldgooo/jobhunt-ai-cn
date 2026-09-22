# CLAUDE.md

Guidance for Claude Code when working in this repository.

> These rules apply to every conversation. Follow them automatically without being asked.

---

## Project Summary

Semi-automatic job application pipeline. User pastes JD → AI tailors resume + cover letter → user reviews/edits in browser → exports PDF on demand.

Architecture and file structure: **see SPEC.md**.

---

## Commands

```bash
npm run install:all          # install root + backend + frontend deps
npm run setup                # first-time: copy example files into user/
npm run dev                  # start both servers (backend :3000, frontend :5173)
npm run build                # Vite → backend/public/ (production)
npm run start                # backend only (serves built frontend)
npm run build:demo           # static demo build → demo-dist/
npm run gen:demo             # regenerate demo PDFs + preview HTML

cd backend && npm test                        # run all tests
cd backend && node --test tests/<file>.test.js  # run one test file
```

---

## Automatic Rules

### Rule 1 — Update SPEC.md automatically

Update `SPEC.md` whenever any of the following change:
- API endpoints (added / removed / request or response shape changed)
- File structure (new files added, files removed or renamed)
- Component behaviour (tailor.js, coverletter.js, evaluator.js, renderer.js logic)
- Tech stack decisions (new dependency added or removed)
- Environment variables (new keys in .env)
- DB schema (new columns, new tables)

Read the current SPEC.md first, then make targeted edits to the affected sections only.

### Rule 2 — Update PLAN.md automatically

- Task completed → mark `[x]`, add notes
- New task identified → add a row to the appropriate phase
- Architecture decision made → update the Component Reference section

### Rule 3 — Run tests after code changes

After any change to `tailor.js`, `coverletter.js`, `db.js`, or `renderer.js`:

```bash
cd backend && npm test
```

Report pass/fail. Fix before finishing if tests fail.

### Rule 4 — Update CHANGELOG.md on every code change

```
## YYYY-MM-DD — <short title>

<what changed and why, 2–5 bullet points>
```

- Same conversation → keep editing the same entry
- New conversation → prepend a new entry at the top
- Imperative mood ("Add", "Fix", "Refactor"); focus on *what* and *why*

---

## Key Conventions

### node:sqlite
- Built-in Node v22+ — no npm install needed
- Named params: `:name` syntax in SQL; `stmt.run(obj)` takes plain object keys (no `:` prefix)
- Do not enable WAL mode via pragma — version support is inconsistent

### LLM (Gemini or Ollama)
- Provider: `LLM_PROVIDER` env var (`gemini` | `ollama`)
- Gemini model: always from `GEMINI_MODEL` env var — never hardcode a model name
- Tailor prompt: assembled from `prompts/tailor.md` + `user/profile.md` + `user/cv.md`
- Rescore + coverletter prompts: loaded from `user/prompts.json` at runtime
- JSON mode: Gemini → `response_mime_type: 'application/json'`; Ollama → `format: "json"`

### Fetch / API
- All browser `fetch()` calls must go through `frontend/src/lib/api.ts` — never raw fetch in components
- When adding an endpoint: add the typed method to `api.ts` first, then update SPEC.md and the demo mock

### SQLite access
- All reads and writes go through `backend/db.js` — `server.js` never queries the DB directly
- DB schema changes: add column to `CREATE TABLE` block AND to the `ALTER TABLE` migration loop in `db.js`
- Valid status values: `not_started` | `applied` | `followed_up` | `interviewed` | `rejected`

### Demo mode
- `VITE_DEMO_MODE=true` intercepts all API calls before any `fetch`
- New read paths → add mock data to `demo-data.ts` and a branch in `api.ts`
- After editing demo source markdown: `npm run gen:demo`

### renderer.js
- `renderResume(markdown, theme)` — reads `themes/<theme>.css`
- `renderResumeWithCss(markdown, css, theme)` — injects CSS string (live style editor)
- `renderCoverLetter(markdown)` — simple HTML wrapper
- Two-column layout: controlled by `TWO_COLUMN_THEMES` set; emits `.resume-left` / `.resume-right`

### exporter.js
- `exportResumePDF(markdown, theme)` and `exportCoverLetterPDF(markdown)` → Buffer
- Always use `printBackground: true` — required for coloured elements

### user/ directory
- `user/cv.md` — complete resume, no `{{placeholders}}`, AI rewrites directly
- `user/profile.md` — target roles + adaptive framing; read by tailor.js on every analyze
- `user/prompts.json` — user-editable prompts (`rescore` and `coverletter` keys only)
- This directory is gitignored; never commit personal files

---

## Known Gotchas

1. `user.config.js` is not cached (`delete require.cache[...]`) — live theme changes work without restart
2. `tailor.js` uses `baseMd` if provided (from a DB template); falls back to `user/cv.md` otherwise
3. Puppeteer `page.pdf()` requires `printBackground: true` or coloured backgrounds vanish
