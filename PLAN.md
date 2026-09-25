# Job Application Tracking System — Implementation Plan

> Extension removed from scope — LinkedIn blocks content scripts.
> Input: manual paste via local web UI at localhost:3000.

---

## Status Legend
- `[ ]` not started
- `[~]` in progress
- `[x]` done

---

## Phase 1 — Inputs & Config

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | `resumes/base.md` — universal resume template | `[x]` | Done |
| 2 | `resumes/config.json` — per-stack skill lists + soft skill pool | `[x]` | soft_skills.pool uses `{ keyword, bullet }` objects |
| 3 | `cover-letter/template.md` | `[x]` | Done — has all 6 placeholders |
| 4a | Gemini `gemini-2.5-flash` 404s for new API keys on Analyze | `[x]` | Default model is now `gemini-3.6-flash`; frontend shows method + `/api` path + backend error |
| 4b | Retry Gemini 429/500/502/503/504 with exponential backoff | `[x]` | 503/5xx: 2s / 4s / 8s, max 3; 429: respect RetryInfo, at most one wait ≤ 60s; no generic exhausted-retry message |
| 4c | One LLM call per new application + local JD parse | `[x]` | `generateApplication`; cover letter filled locally; title/company/location parsed before Gemini |

---

## Phase 2 — Backend

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5 | `backend/db.js` — SQLite setup | `[x]` | uses `node:sqlite` (built-in Node v22+, no native deps) |
| 6 | `backend/server.js` — skeleton (`/health` + `/process` stub) | `[x]` | tested — curl /health → {"status":"ok"} |
| 7 | `backend/tailor.js` — stack detection + resume fill | `[x]` | Gemini JSON mode for stack/skills/score; programmatic for formatting |
| 8 | `backend/coverletter.js` — cover letter placeholder fill | `[x]` | Gemini JSON mode |
| 9 | `backend/exporter.js` — Oh My CV + Puppeteer → PDF | `[x]` | Oh My CV+IndexedDB for resume; plain HTML for cover letter |
| 10 | `backend/server.js` — full `/process` wiring all modules | `[x]` | all modules wired |
| 10a | `backend/server.js` — auto-start Oh My CV + `/cv` reverse proxy | `[x]` | spawns `pnpm dev` on startup, polls 40s, proxies `/cv` → `localhost:5173` via `http-proxy-middleware` |
| 10b | `backend/exporter.js` — remove dev server management | `[x]` | Oh My CV lifecycle moved to server.js; exporter assumes it's already running |
| 10c | `resumes/resume.css` — externalized CSS for PDF export | `[x]` | exporter reads from `resumes/resume.css` at startup; `themeColor` defaults to `#000000` |

---

## Phase 3 — Frontend

| # | Task | Status | Notes |
|---|------|--------|-------|
| 11 | `frontend/index.html` + `app.js` — input form + results UI | `[x]` | single-page with nav |
| 12 | `/applications` history page — table + status update | `[x]` | inline in index.html, inline status PATCH |

---

## Phase 4 — End-to-End Test ✅

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13 | Smoke test: paste JD → POST /process → PDFs generated | `[x]` | Atlassian/Full-Stack-Developer — fit_score: 92, stack: csharp |
| 14 | Verify: SQLite record created, status updatable | `[x]` | DB insert + PATCH /applications/:id confirmed |
| 15 | Verify: PDFs saved to `output/YYYY-MM-DD_Company_Title/` | `[x]` | resume.pdf (72 KB) + cover-letter.pdf (48 KB) |

---

## Phase 5 — Frontend Modernization (Open Source Prep)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16 | Root `package.json` with `concurrently` dev script | `[x]` | `npm run dev` starts both servers |
| 17 | Init Vite + React + TypeScript project in `frontend/` | `[x]` | Manual scaffold, build outputs to `backend/public/` |
| 18 | Install & configure Tailwind CSS | `[x]` | With CSS variables for shadcn/ui compatibility |
| 19 | Install shadcn/ui, add base components (Button, Badge, Card, Input, Textarea, Label, Select) | `[x]` | Manual setup (non-interactive env); all components in `src/components/ui/` |
| 20 | `vite.config.ts`: proxy `/api/*` → `localhost:3000`, build outDir → `../backend/public` | `[x]` | proxy target now follows `PORT` in `backend/.env` |
| 20a | Avoid proxying `/api` to a non-Express process when port 3000 is taken | `[x]` | Vite reads `PORT` from `backend/.env`; backend loads that file from `__dirname` |
| 21 | Backend: add `/api` prefix to all routes | `[x]` | Using express.Router mounted at `/api` |
| 22 | Backend: serve `public/` in production, keep CORS for dev | `[x]` | Serves `public/` only if directory exists |
| 23 | Migrate NewApplication page → React | `[x]` | Form + result card with skill badges and score |
| 24 | Migrate History page → React (table, filters, inline edit, status badge) | `[x]` | Expandable rows, inline edit, status dropdown |
| 25 | Migrate Settings page → React | `[x]` | Prompt editor with auto-save feedback |
| 26 | Migrate Editor page → React | `[x]` | Split view: markdown editor + iframe preview, tab for resume/CL |
| 27 | `lib/api.ts` — typed API client wrapping all fetch calls | `[x]` | Full TypeScript types for all endpoints |
| 28 | Integration test: dev mode (proxy) + prod build (express.static) | `[ ]` | |
| 28a | Localize frontend UI to Simplified Chinese | `[x]` | Direct string translation (no i18n lib); `frontend/src/lib/labels.ts` maps status/source/theme/eval labels |

---

## Phase 6 — Open Source User-Data Separation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 29 | Create `user/` folder: base.md, config.json, cover-letter/template.md | `[x]` | Copied from resumes/ and cover-letter/ |
| 30 | Create `themes/` folder with 5 CSS themes (classic/modern/minimal/compact/bold) | `[x]` | modern/minimal/compact/bold are copies of classic for now |
| 31 | Create root `user.config.js` (theme + geminiModel) | `[x]` | |
| 32 | Update backend path references to user/ and themes/ | `[x]` | tailor.js, coverletter.js, renderer.js, exporter.js, server.js |
| 33 | Add `theme` column to SQLite applications table | `[x]` | Migration in db.js |
| 34 | Frontend theme dropdown on Generate form | `[x]` | 4-column row: Job Title / Company / Source / Theme |
| 35 | Frontend theme switcher in Editor header | `[x]` | PATCH application.theme on change, re-renders preview |
| 36 | PDF export uses stored per-application theme | `[x]` | Passed from DB record to exportResumePDF(markdown, theme) |
| 36a | Center resume contact as one `email \| phone \| GitHub` line | `[x]` | CSS was two-column flex (`50%` + left/right); now `.resume-contact { text-align: center }`; labels/portfolio omitted at render |
| 37 | Update .gitignore to exclude user/ | `[x]` | |
| 38 | Update README with Getting Started for New Users | `[x]` | |

---

## Component Reference

### tailor.js logic (v2)
1. Reads `prompts/tailor.md` (fixed system prompt) + `user/profile.md` + `user/cv.md` (or `baseMd` from DB template)
2. `POST /api/analyze` uses `generateApplication`: one LLM call (Gemini or Ollama) for analysis + tailored resume + optional cover-letter fills + job metadata. Gemini: 503/5xx use 2s/4s/8s backoff (max 3); 429 waits `RetryInfo.retryDelay` at most once (≤ 60s) then `formatLlmError`; 400/401/403/404 fail immediately.
3. Returns `{ markdown, fit_score, detected_skills, job_title, company, location, archetype, cover_md, cover_letter_available }`
4. Validates response shape; clamps `fit_score` to 0–100
5. **Never touches** bullet text, dates, metrics, YAML front matter — only rewrites Summary and reorders

### coverletter.js placeholders
`{{company}}` `{{job_title}}` `{{why_company}}` `{{matching_skills}}` `{{specific_project}}` `{{why_company_culture}}`
Prompt loaded from `user/prompts.json` (`coverletter` key).

### evaluator.js logic
Reads `prompts/_shared.md` + `user/profile.md` + `prompts/evaluate.md` → single LLM call.
Returns `{ eval_score, eval_recommendation, eval_archetype, eval_review }`.

### API endpoints (see SPEC.md for full reference)
```
POST /api/analyze        → { id, fit_score, job_title, detected_skills, cover_letter_available, theme }
POST /api/applications   → { id }  (create without AI)
GET  /api/applications   → all records
GET  /api/applications/:id → single record
PATCH /api/applications/:id → partial update
DELETE /api/applications/:id
GET  /api/applications/:id/pdf?type=resume|coverletter → PDF stream
POST /api/applications/:id/rescore → { fit_score }
POST /api/applications/:id/evaluate → { eval_score, eval_recommendation, eval_archetype, eval_review }
POST /api/preview        → { html }
GET/PUT /api/profile     — user/profile.md
GET/PUT /api/cv          — user/cv.md
GET/PUT /api/cover-letter/template
GET/PUT /api/style · GET /api/style/themes · POST /api/style/preview
GET/POST/PUT/DELETE /api/resume-templates(/:id)
PATCH /api/resume-templates/:id/default
POST /api/resume-templates/build · POST /api/resume-templates/build-preview
GET  /api/health
```

### SQLite table: `applications`
`id, created_at, company, job_title, url, source, jd_text, stack_used, fit_score, resume_md, cover_md, status, theme, status_log, follow_up, resume_template_id, eval_score, eval_recommendation, eval_archetype, eval_review`

Status values: `not_started` | `applied` | `followed_up` | `interviewed` | `rejected`

### SQLite table: `resume_templates`
`id, name, markdown, is_default, created_at, updated_at`
Empty table on startup → import `user/cv.md` as "Master Resume" (`is_default = 1`). Never overwrites existing rows. Missing `user/cv.md` logs a warning and continues.

### renderer.js
- `renderResume(markdown, theme)` — parses `~` syntax + YAML front matter → full HTML; contact line is centered `email | phone | github` (no labels, no portfolio)
- `renderResumeWithCss(markdown, css, theme)` — injects CSS string directly (live style editor)
- `renderCoverLetter(markdown)` — simple HTML wrapper
- Two-column themes detected via `TWO_COLUMN_THEMES` set; emits `.resume-left` / `.resume-right`

### exporter.js
- `exportResumePDF(markdown, theme)` → Buffer
- `exportCoverLetterPDF(markdown)` → Buffer
- Both use `page.setContent()` + `page.pdf({ printBackground: true })`

### backend/package.json dependencies
`express`, `axios`, `dotenv`, `puppeteer`

### .env keys
```
GEMINI_API_KEY       — Gemini API key
GEMINI_MODEL         — Gemini model name (default: gemini-3.6-flash)
LLM_PROVIDER         — "gemini" (default) or "ollama"
OLLAMA_BASE_URL      — Ollama base URL (default: http://localhost:11434)
OLLAMA_MODEL         — Ollama model name (default: gemma3:12b)
LLM_TIMEOUT_MS       — LLM request timeout in ms (default: 120000)
PORT                 — backend port (default 3000); Vite /api proxy reads this
```

### user.config.js keys
```
theme  — default theme name (must match a file in themes/); fallback when no theme is specified per-application
```

---

---

## Phase 7 — Bug Fixes & Robustness

> Full design in `UX_FIX_PLAN.md` Phase A + B + D

| # | Task | Status | Notes |
|---|------|--------|-------|
| 39 | A1: Editor autosave failure — add error banner + manual save (Ctrl+S / Save button) | `[x]` | Red banner on save failure; Ctrl+S + Save button trigger immediate save |
| 40 | A2: Cover letter silently skipped when template missing — show warning banner | `[x]` | `cover_letter_available` in `/analyze` response; yellow banners in result card + Editor |
| 41 | A3: Validate Gemini response shape before using it | `[x]` | `tailor.js` — throws on invalid `stack`, `detected_skills`, `fit_score` |
| 42 | A4: PDF download button has no loading state — disable + show "Generating PDF…" | `[x]` | Fetch-based download with loading state; both buttons disabled during generation |
| 43 | A5: Soft skill injection no-op is silent — return `soft_skills_injected: boolean` | `[x]` | Yellow hint in result card if false |
| 44 | B1: Missing `GEMINI_API_KEY` shows "Unknown error" — check on startup, return clear message | `[x]` | Early return 500 with descriptive message in `/api/analyze` |
| 45 | B2: Gemini 429 quota error shows "Unknown error" — detect HTTP 429 in axios catch | `[x]` | `formatLlmError` returns Chinese quota text with RetryInfo seconds; frontend `api.ts` shows `data.error` |
| 45a | Surface original Gemini 429/503 instead of generic retry-exhausted 500 | `[x]` | 429 respects RetryInfo (no 2/4/8s); 503 keeps backoff; never replace with "temporarily unavailable after 3 retries" |
| 46 | B3: Missing `user/base.md` or `config.json` shows path crash — throw descriptive error | `[x]` | `tailorResume` checks file existence before reading |
| 47 | B4: PDF 404 message is misleading — replace with "Resume markdown not saved — try re-generating" | `[x]` | Separate messages for resume vs cover letter |
| 48 | B5: Settings shows "Saved" even on failure — move badge to `then()`, show red "Save failed" in `catch()` | `[x]` | Already correct in React version |
| 49 | D1: Puppeteer has no timeout — add 60s timeout to `page.setContent` / `page.pdf` | `[x]` | `timeout: 60000` on both calls in `exporter.js` |
| 50 | D2: `fit_score` has no bounds check — clamp to 0–100 | `[x]` | `Math.max(0, Math.min(100, fit_score))` in `tailor.js` |
| 51 | D3: `PUT /prompts` does not validate required tokens — check `{{JD}}` and `{{TEMPLATE}}` present | `[x]` | Returns 400 if missing |
| 52 | D4: `theme` parameter has no validation — whitelist `/^[a-z0-9-]+$/` | `[x]` | `isValidTheme()` applied in analyze, preview, style PUT, style/preview |
| 53 | D5: `status_log` JSON.parse has no error handling — wrap in try/catch, default to `[]` | `[x]` | try/catch in `updateApplication` in `db.js` |
| 54 | D6: Gemini has no timeout — backend `Promise.race` 60s, frontend `AbortController` 65s | `[x]` | `Promise.race` in both `geminiJSON`; `AbortController` in NewApplication submit |

---

## Phase 8 — Onboarding & Open Source Prep

> Full design in `UX_FIX_PLAN.md` Phase C

| # | Task | Status | Notes |
|---|------|--------|-------|
| 55 | Add `user/base.example.md` — format demo with no personal data | `[x]` | Generic structure with all 16 placeholders and fictional data |
| 56 | Add `user/config.example.json` — stack structure demo | `[x]` | One "typescript" stack + one job role + soft_skills pool |
| 57 | Add `user/cover-letter/template.example.md` | `[x]` | Generic template with all 6 placeholders |
| 58 | Add `user/base.md`, `user/config.json`, `user/cover-letter/template.md` to `.gitignore` | `[x]` | Changed from `user/` whole-dir to specific personal files only |
| 59 | C2: Rename "Stack" label to "Resume variant" | `[x]` | Updated in result card in NewApplication.tsx |
| 60 | C3: Show available AI variants near the AI toggle on New Application form | `[x]` | `GET /api/stacks` endpoint; shown inline above JD textarea |
| 61 | C4: Add placeholder hint text to JD textarea | `[x]` | "Paste the full job description. Leave blank to skip AI analysis." |
| 62 | C5: Add "Available tokens" docs to Settings prompt textareas | `[x]` | Collapsible `<details>` under each textarea with token descriptions |

---

## Phase 9 — Multi-Resume Templates

> Full design in `UX_FIX_PLAN.md` Phase E

| # | Task | Status | Notes |
|---|------|--------|-------|
| 63 | DB: add `resume_templates` table + migration | `[x]` | Seeds `user/cv.md` as "Master Resume" (default) when table is empty |
| 63a | Fix seed: `user/base.md` was removed so fresh installs had zero templates | `[x]` | Import `user/cv.md` only when empty; warn and continue if file missing |
| 64 | DB: add `resume_template_id` column to `applications` | `[x]` | Nullable; old records unaffected |
| 65 | API: `GET/POST/PUT/DELETE /api/resume-templates` | `[x]` | List excludes markdown; GET single includes it; DELETE blocks last template |
| 66 | API: `PATCH /api/resume-templates/:id/default` | `[x]` | Clears all others, sets one default |
| 67 | API: `/api/analyze` — add optional `resume_template_id` + `generate_cover_letter` params | `[x]` | Also passes baseMd to tailor.js; skips AI if template has no `{{placeholders}}` |
| 68 | API: `POST /api/applications` — Persona A direct save (no AI); takes `resume_template_id`, copies template markdown to `resume_md`, status = `not_started` | `[x]` | Separate from `/api/analyze`; frontend redirects to Editor |
| 69 | Backend: detect `{{placeholder}}` presence in template → auto-disable AI if none found | `[x]` | Returns 400 in /api/analyze if no placeholders found |
| 70 | New Application form redesign — template selector + optional JD + AI checkboxes | `[x]` | JD optional; AI checkboxes appear when JD has content; single smart button |
| 71 | Resumes management page — list, create, set default | `[x]` | `/resumes` page + sidebar nav; "···" dropdown with Set default / Duplicate / Delete |
| 72 | Resume template edit page — split view, reuse Editor layout | `[x]` | `/resumes/:id` — full-screen split view, name input, Set as default button, autosave |
| 73 | Editor: add "Save as template" button | `[x]` | Modal with name input (pre-filled with company+title) → `POST /api/resume-templates` |
| 74 | New Application form: add "Preview template" panel | `[x]` | "Preview →" link → modal overlay with rendered iframe |

---

## Phase 10 — Resume Builder (Form → Markdown)

> Full design in `UX_FIX_PLAN.md` Phase G

| # | Task | Status | Notes |
|---|------|--------|-------|
| 75 | API: `POST /api/resume-templates/build` — accept structured data, return generated markdown | `[x]` | Also `POST /api/resume-templates/build-preview` (markdown only, no DB save) |
| 76 | New Resume entry point: two options — "Build with form" / "Edit as markdown" | `[x]` | Modal on Resumes page with two option cards |
| 77 | Resume Builder form — Personal info, Summary, Skills, Experience, Education sections | `[x]` | `ResumeBuilderPage.tsx` at `/resumes/build` |
| 78 | Experience + Education: support multiple entries | `[x]` | Add/remove entries and bullets; "Current" checkbox |
| 79 | Builder: live preview panel (right side) | `[x]` | Debounced 800ms; calls `/build-preview` then `POST /api/preview` |

---

## Phase 11 — UX Polish

> Full design in `UX_FIX_PLAN.md` Phase F

| # | Task | Status | Notes |
|---|------|--------|-------|
| 80 | F1: Show warning when JD is under 100 characters (non-blocking) | `[x]` | Yellow banner below JD textarea showing char count |
| 81 | F2: Delete confirmation — describe consequences clearly | `[x]` | Added "permanently remove all saved data including markdown and status history" |
| 82 | F3: Status badge — add icon per status (not colour-only) | `[x]` | Hourglass/Send/Bell/Users/XCircle icons in badge + dropdown |
| 83 | F4: Dashboard — show error message on data load failure | `[x]` | Already implemented in previous phase |
| 84 | F5: Theme selector — add "Preview →" link next to dropdown | `[x]` | Preview link in New Application form opens template preview modal with selected theme |

---

## Future Plans

### Scoring System (to be designed)

Current state: single `fit_score: 0–100` returned by Gemini, displayed as one number.

Planned direction:
- Multi-dimension breakdown: technical match, seniority match, keyword coverage rate
- Rule-based scoring layer on top of Gemini analysis
- UI shows score breakdown (not just one number)

> Design deferred — research other resume scoring systems before implementing.
