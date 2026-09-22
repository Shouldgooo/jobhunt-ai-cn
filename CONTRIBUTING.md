# Contributing to jobhunt-ai

Thanks for your interest in contributing! This document covers everything you need to get started.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Project Architecture](#project-architecture)
- [Development Rules](#development-rules)
- [Demo Mode](#demo-mode)
- [Database Schema Changes](#database-schema-changes)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Welcome Contributions](#welcome-contributions)
- [Off-Limits](#off-limits)

---

## Prerequisites

**Node.js v22 or newer is required** — not optional.

The project uses `node:sqlite`, which is a built-in SQLite driver that ships with Node.js starting at v22. There is no npm package to install and no native compilation step; if you use an older Node version it will simply crash at startup with `Cannot find module 'node:sqlite'`.

Check your version:

```bash
node --version   # must be v22.x.x or higher
```

If you need to manage multiple Node versions, [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows) work well.

You also need either:
- A **Gemini API key** — get one free at [Google AI Studio](https://aistudio.google.com/app/apikey)
- Or a running **Ollama** instance (set `LLM_PROVIDER=ollama` in `.env`)

---

## Local Development Setup

### 1. Clone and install

```bash
git clone https://github.com/tristachou/jobhunt-ai.git
cd jobhunt-ai

# Installs root devDependencies (concurrently) + backend + frontend in one shot
npm run install:all
```

This is equivalent to running `npm install` in the root, `backend/`, and `frontend/` directories separately.

### 2. Create your personal files

```bash
npm run setup
```

This copies `user/cv.example.md` → `user/cv.md` and `user/profile.example.md` → `user/profile.md` so the backend has something to read. (The `user/` directory is gitignored — your personal data never gets committed.)

### 3. Configure the backend

Create `backend/.env` by copying the example:

```bash
cp backend/.env.example backend/.env
```

Fill in at least `GEMINI_API_KEY`. Full variable reference:

```
# Required for Gemini (default provider)
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.5-flash

# LLM provider — "gemini" (default) or "ollama"
LLM_PROVIDER=gemini

# Ollama config (only needed when LLM_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:12b

# Optional timeout override (default 120000ms)
LLM_TIMEOUT_MS=120000
```

### 4. Start the dev server

```bash
npm run dev
```

This starts both servers concurrently:
- **Backend** — Express on `http://localhost:3000` (hot-reloaded via `node --watch`)
- **Frontend** — Vite dev server on `http://localhost:5173` (proxies `/api/*` → `:3000`)

Open **http://localhost:5173** in your browser.

### 5. Run the tests

```bash
cd backend && npm test
```

Tests use `node --test` (built-in test runner, no Jest/Vitest). A `TEST_DB_PATH` env var points tests to an in-memory/temp database so your local `applications.db` is never touched.

To run a single test file:

```bash
cd backend && node --test tests/tailor.test.js
```

---

## Project Architecture

```
jobhunt-ai/
├── frontend/src/          # React + Vite + TypeScript + Tailwind + shadcn/ui
│   ├── pages/             # One file per route
│   ├── components/        # AppSidebar + shadcn/ui primitives in ui/
│   └── lib/api.ts         # ← ONLY place that calls fetch()
├── backend/
│   ├── server.js          # Express; all routes mounted under /api
│   ├── tailor.js          # LLM call for resume tailoring (Gemini or Ollama)
│   ├── coverletter.js     # LLM call for cover letter placeholder fill
│   ├── evaluator.js       # LLM call for job fit evaluation
│   ├── renderer.js        # Oh My CV markdown → HTML
│   ├── exporter.js        # HTML → PDF via Puppeteer
│   └── db.js              # ← ONLY place that touches SQLite
├── prompts/               # Fixed prompt templates (system logic, not user data)
│   ├── tailor.md          # One-shot resume tailor prompt
│   ├── evaluate.md        # Job fit evaluation prompt
│   └── _shared.md         # Shared scoring rules and archetype table
├── themes/                # Resume CSS (classic / modern / executive / sidebar)
├── user/                  # ← gitignored; each contributor keeps their own copy
│   ├── cv.md              # Complete resume (Oh My CV markdown, no placeholders)
│   ├── profile.md         # Target roles + narrative framing
│   ├── prompts.json       # User-editable rescore + coverletter prompts
│   └── cover-letter/template.md
├── scripts/setup.js       # First-time setup: copies example files into place
└── user.config.js         # Active theme name (live-reloaded, no restart needed)
```

### Responsibility boundaries

| Directory / file | Owns |
|---|---|
| `frontend/src/lib/api.ts` | All HTTP calls from the browser |
| `backend/db.js` | All SQLite reads and writes |
| `backend/tailor.js` | Resume tailoring LLM logic |
| `backend/coverletter.js` | Cover letter LLM logic |
| `backend/evaluator.js` | Job fit evaluation LLM logic |
| `backend/renderer.js` | Markdown → HTML conversion |
| `backend/exporter.js` | HTML → PDF via Puppeteer |
| `backend/server.js` | Express routing and request/response wiring only |

---

## Development Rules

### API calls live only in `api.ts`

All `fetch()` calls from the frontend must go through `frontend/src/lib/api.ts`. Do not write raw `fetch` inside a component or page. If you add a new endpoint, add a typed method to the `api` object in `api.ts` first.

### SQLite access lives only in `db.js`

All reads and writes to SQLite must go through `backend/db.js`. `server.js` imports named functions from `db.js` — it never calls the database directly. If you need a new query, add it to `db.js` and export it.

### LLM logic lives only in `tailor.js`, `coverletter.js`, or `evaluator.js`

No Gemini or Ollama calls outside these three files. `server.js` calls into them, it does not construct prompts or parse LLM responses itself.

### `node:sqlite` conventions

- Named parameters use `:name` syntax in SQL strings.
- `stmt.run(data)` takes a plain object — keys have **no** `:` prefix.
- Do not enable WAL mode via pragma — `node:sqlite` support is version-dependent; keep the default journal mode.

### Gemini / Ollama conventions

- The model name must come from the `GEMINI_MODEL` env var — never hardcode `gemini-2.5-flash` or any model string in source code.
- LLM provider is selected via `LLM_PROVIDER` env var (`gemini` | `ollama`).
- Use JSON mode for all structured LLM responses (`response_mime_type: 'application/json'` for Gemini; `format: "json"` for Ollama).
- User-editable prompts live in `user/prompts.json`. Fixed system prompts (archetype rules, evaluation rubrics) live in `prompts/*.md`.

---

## Demo Mode

The project includes a static demo build that runs entirely in the browser without a backend or API key. It is deployed to GitHub Pages automatically on every push to `main`.

### How it works

Setting `VITE_DEMO_MODE=true` activates a mock layer inside `api.ts`. Every API call is intercepted **before any `fetch` is issued**:
- Read operations return hardcoded fictional data from `frontend/src/lib/demo-data.ts`.
- Write operations show a `DemoCloneModal` that prompts the user to clone the repo instead of saving.

Pre-generated static assets (PDFs, preview HTML) live in `frontend/public/demo/`.

### Rules for new API endpoints

If you add a new API endpoint and the feature touches any read path that demo users would encounter, you must:

1. Add mock data to `frontend/src/lib/demo-data.ts`.
2. Add a branch in the `api.ts` mock layer that handles the new endpoint.
3. Run `npm run build:demo` locally to verify the demo build still works.

To regenerate the demo PDF and preview HTML after editing source markdown:

```bash
npm run gen:demo
```

To build and preview the demo locally:

```bash
npm run build:demo
cd frontend && npx vite preview --outDir ../demo-dist --port 4173
# then open http://localhost:4173
```

---

## Database Schema Changes

The project uses auto-migration: `db.js` runs `ALTER TABLE ... ADD COLUMN` statements wrapped in a try/catch on every startup. This means users never need to delete and recreate their database.

**When you add a column:**

1. Add the column to the `CREATE TABLE IF NOT EXISTS` statement so new databases get it immediately.
2. Add an `ALTER TABLE ... ADD COLUMN` line to the migration block in `db.js` so existing databases are upgraded silently.

```js
// db.js — migration block (runs on every startup, safe to repeat)
for (const col of [
  // existing columns …
  'your_new_column TEXT',  // ← add here
]) {
  try { db.exec(`ALTER TABLE applications ADD COLUMN ${col}`); } catch { /* already exists */ }
}
```

3. Update `SPEC.md` to document the new column in the DB schema table.
4. Never ask users to delete `applications.db` — they will lose all their application history.

---

## Pull Request Guidelines

### Branch naming

Use the format `<type>/<short-description>` — keep it lowercase with hyphens:

| Pattern | Example |
|---|---|
| `feat/<description>` | `feat/ollama-provider` |
| `fix/<description>` | `fix/pdf-export-blank-page` |
| `docs/<description>` | `docs/update-readme` |
| `chore/<description>` | `chore/bump-puppeteer` |

If the change relates to an issue, include the number: `fix/123-pdf-export-blank-page`.

### Title prefix

Use one of these prefixes so the change type is immediately clear:

| Prefix | When to use |
|---|---|
| `feat:` | New user-facing feature |
| `fix:` | Bug fix |
| `refactor:` | Code restructure with no behavior change |
| `style:` | CSS / theme changes only |
| `docs:` | Documentation only |
| `test:` | Tests only |
| `chore:` | Tooling, deps, CI |

Example: `feat: add dark mode toggle to Style page`

### Description

Your PR description should answer:
- **What** changed and **why**
- **How you tested it** — what scenarios did you exercise manually? Did you run `cd backend && npm test`?
- **UI changes** — attach at least one screenshot or screen recording if any page visually changed

### Before submitting

- [ ] `cd backend && npm test` passes
- [ ] `npm run typecheck` passes (frontend TypeScript — same check as CI)
- [ ] `npm run lint` passes (ESLint for both backend and frontend — same check as CI)
- [ ] If you changed LLM-related code (`tailor.js`, `coverletter.js`, `evaluator.js`): tested with at least one real job description against your configured provider
- [ ] If you added a new API endpoint: updated `SPEC.md` (API endpoints table) and added a mock in `api.ts` demo layer (if applicable)
- [ ] If you changed the DB schema: followed the migration pattern above and updated `SPEC.md`
- [ ] If you changed the UI: screenshots attached
- [ ] No new calls to external services beyond the Gemini API / Ollama

---

## Welcome Contributions

- **New themes** — add a CSS file to `themes/` and document it in `README.md`. Single-column and two-column layouts both work; look at `classic.css` (single-column) and `modern.css` (two-column) as references. The four existing themes are `classic`, `modern`, `executive`, and `sidebar`.
- **New LLM providers** — add a branch in `tailor.js`'s `callLLM()` function. The provider must return the same JSON shape as Gemini; no changes to `server.js` or the frontend should be needed.
- **UI and UX improvements** — History filtering, Editor keyboard shortcuts, mobile layout fixes, accessibility improvements.
- **Test coverage** — additional test cases for `tailor.js`, `renderer.js`, `db.js`.
- **Documentation** — corrections, clarifications, translations of the README.

---

## Off-Limits

The following will not be accepted:

- **External service calls** — no analytics, telemetry, crash reporting, or any outbound HTTP beyond the configured LLM API. The tool is explicitly designed to keep all data local.
- **Authentication or multi-user support** — out of scope; the README states this is a single-user local tool.
- **Changes to the `user/` directory structure** — `user/cv.md`, `user/profile.md`, `user/prompts.json`, and `user/cover-letter/template.md` are user-owned files. Renaming or restructuring them is a breaking change for every existing user.
- **Hardcoded model names or API keys** — model names must always come from env vars.
- **Removing the `node:sqlite` dependency in favor of an npm SQLite package** — the built-in driver is a deliberate choice to reduce the dependency surface.
