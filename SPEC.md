# Job Application Automation — SPEC

## Overview

Semi-automatic job application pipeline. The user pastes a job description into a local web UI; AI tailors the resume and cover letter; the user reviews and edits in a markdown editor; PDFs are exported on demand.

No browser extension. No scraping. No external services beyond the AI API. Runs entirely on your local machine.

---

## Project Structure

```
Job-Apply-Bot/
├── user/                          # ← EDIT THIS to personalise your instance (gitignored)
│   ├── cv.md                      # Your complete resume (Oh My CV markdown, no placeholders)
│   ├── cv.example.md              # Filled example for reference
│   ├── profile.md                 # Your target roles, adaptive framing, and narrative
│   ├── profile.example.md         # Filled example for reference
│   ├── prompts.json               # AI prompt strings (rescore / coverletter)
│   └── cover-letter/
│       └── template.md            # Your cover letter template with {{placeholders}}
├── prompts/                       # Fixed AI prompt templates (system logic — not user data)
│   ├── tailor.md                  # One-shot resume tailor prompt (archetype detection + rules)
│   ├── evaluate.md                # Job fit evaluation prompt
│   ├── _shared.md                 # Shared scoring rules and archetype table
│   └── _profile.md                # (legacy — replaced by user/profile.md)
├── themes/                        # Resume CSS themes
│   ├── classic.css
│   ├── modern.css
│   ├── executive.css
│   └── sidebar.css
├── user.config.js                 # Active theme name (not cached — live reload)
├── frontend/
│   └── src/
│       ├── pages/                 # React pages
│       │   ├── NewApplication.tsx
│       │   ├── History.tsx
│       │   ├── Editor.tsx
│       │   ├── Dashboard.tsx
│       │   ├── Style.tsx
│       │   ├── Settings.tsx
│       │   ├── Resumes.tsx
│       │   ├── ResumeEditorPage.tsx
│       │   └── ResumeBuilderPage.tsx
│       ├── components/            # AppSidebar, GenerationProgress, AnalysisPanel, JobQaPanel + shadcn/ui components
│       └── lib/
│           ├── api.ts             # Typed fetch wrapper for all /api calls (NDJSON analyze stream)
│           ├── new-application.ts # New Application defaults + post-success PDF download helpers
│           ├── analysis-summary.ts # Editor 分析 tab: local Chinese summary from verified data
│           ├── bulk-status.ts     # History bulk “已申请” confirm/loading helpers (no LLM)
│           ├── job-qa.ts          # Editor follow-up Q&A helpers
│           ├── analyze-stream.ts  # Analyze progress events + AbortError helpers
│           └── change-summary.ts  # Parse stored verified change summary JSON
├── backend/
│   ├── server.js                  # Express (port 3000) — all routes under /api
│   ├── analyze-flow.js            # Analyze pipeline: real-stage progress + AbortSignal + save
│   ├── tailor.js                  # Resume tailoring + one-shot generateApplication (Gemini or Ollama)
│   ├── jd-parser.js               # Local JD title/company/location extraction (no LLM; strips **bold** labels)
│   ├── jd-clean.js                # Conservative AI-only JD chrome cleaner (raw JD still stored)
│   ├── generation-lock.js         # In-flight duplicate generation guard
│   ├── generation-abort.js        # Abort Gemini only on real client disconnect (not req close)
│   ├── change-summary.js          # Local original→generated resume/cover diff (no LLM)
│   ├── job-qa.js                  # Employer follow-up answers from saved JD/resume/cover (one LLM call)
│   ├── coverletter.js             # Cover letter template fill (used after the single LLM call)
│   ├── evaluator.js               # Job fit evaluation
│   ├── renderer.js                # Oh My CV markdown → HTML
│   ├── exporter.js                # HTML → PDF via Puppeteer
│   ├── db.js                      # All SQLite CRUD via node:sqlite
│   ├── package.json
│   └── .env                       # GEMINI_API_KEY, GEMINI_MODEL, LLM_PROVIDER
├── scripts/
│   └── setup.js                   # First-time setup: copies example files into place
├── SPEC.md
├── PLAN.md
├── CHANGELOG.md
└── README.md
```

---

## Two-Stage Pipeline

```
Stage 1 — POST /api/analyze
  JD is required. Job title / company / location are optional (local parse + same LLM call).
    → jd-parser.js extracts metadata locally from a whole-page paste (normalize → labels → header heuristics → scoring; no LLM)
    → tailor.js `generateApplication` makes ONE LLM call (Gemini or Ollama)
    → same JSON includes analysis, tailored resume, job metadata, optional cover-letter fills
    → coverletter.js fills template.md locally from that JSON (no second LLM call)
    → markdown saved to SQLite
    → Accept: application/x-ndjson streams real-stage progress then `{ type: "complete", application }`
    → 取消生成 aborts the fetch; backend watches res.close / req.aborted (not req.close) and cancels axios; skips DB write
    → returns: fit_score, job_title, company, location, detected_skills, cover_letter_available

Stage 2 — user reviews / edits markdown in browser

Stage 3 — GET /api/applications/:id/pdf?type=resume|coverletter
  markdown from DB
    → renderer.js: Oh My CV markdown → HTML (applies theme CSS)
    → exporter.js: Puppeteer page.setContent() + page.pdf()
    → PDF streamed to browser
```

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/analyze` | Stage 1: one LLM call → NDJSON progress (or JSON) → save analysis + resume + optional cover letter |
| GET | `/api/applications` | All application records |
| POST | `/api/applications` | Create application without AI |
| GET | `/api/applications/:id` | Single application record |
| PATCH | `/api/applications/:id` | Update any allowed field |
| PATCH | `/api/applications/status/all` | One SQL `UPDATE` of `applications.status` only; body `{ status }` must be a valid status; `{ success, updated, status }` |
| DELETE | `/api/applications/:id` | Delete record |
| GET | `/api/applications/:id/pdf?type=resume\|coverletter` | On-demand PDF stream |
| POST | `/api/applications/:id/rescore` | Re-score fit against JD via LLM |
| POST | `/api/applications/:id/evaluate` | Run full job fit evaluation |
| POST | `/api/applications/:id/ask` | Answer an employer follow-up question from the saved JD/resume/cover/profile; persist `qa_thread`; does not rewrite documents |
| POST | `/api/preview` | Render markdown → HTML (live preview) |
| GET | `/api/profile` | Read `user/profile.md` |
| PUT | `/api/profile` | Save `user/profile.md` |
| GET | `/api/cv` | Read `user/cv.md` |
| PUT | `/api/cv` | Save `user/cv.md` |
| GET | `/api/cover-letter/template` | Read cover letter template |
| PUT | `/api/cover-letter/template` | Save cover letter template |
| GET | `/api/style` | Active theme name + CSS |
| PUT | `/api/style` | Save CSS to theme file |
| GET | `/api/style/themes` | All available themes |
| POST | `/api/style/preview` | Render resume with arbitrary CSS |
| GET | `/api/resume-templates` | All saved resume templates |
| POST | `/api/resume-templates` | Create template |
| GET | `/api/resume-templates/:id` | Single template (includes markdown) |
| PUT | `/api/resume-templates/:id` | Update template |
| DELETE | `/api/resume-templates/:id` | Delete template |
| PATCH | `/api/resume-templates/:id/default` | Set as default template |
| POST | `/api/resume-templates/build` | Build template from structured fields, save to DB |
| POST | `/api/resume-templates/build-preview` | Generate markdown from structured fields (no DB save) |
| GET | `/api/health` | `{ status: "ok" }` |

---

## Component Details

### tailor.js

Assembles the LLM prompt by concatenating:

1. `prompts/tailor.md` — fixed system prompt (archetype detection table, tailoring rules, ATS rules, output format)
2. `user/profile.md` — user's target roles, adaptive framing, and narrative
3. `user/cv.md` (or a DB template if one is selected)
4. The JD text

`generateApplication` sends a single LLM call in JSON mode (resume + optional cover letter + job metadata). The prompt uses `cleanJobDescriptionForAI(rawJd)` while SQLite stores the original paste. Gemini `generationConfig` includes `thinkingConfig.thinkingLevel: "low"` and structured output via REST `responseFormat.text` (`mimeType: "APPLICATION_JSON"` plus a JSON Schema for the generation result). Deprecated `response_mime_type` / `response_schema` are not sent. JSON is still read from non-thought candidate parts; fenced/BOM/wrapped JSON is unwrapped locally. Truncated or schema-invalid payloads fail without insert and without a second LLM call. JSON.parse failures also log a redacted SyntaxError message, position, and candidate length — never the full candidate. There is no application-level wall-clock deadline; only the user 取消生成 AbortSignal aborts axios. 429/503 retries are unchanged. Returns:

```json
{
  "markdown": "...",
  "detected_skills": ["Python", "React", "AWS"],
  "fit_score": 82,
  "job_title": "Senior Backend Engineer",
  "company": "Acme Pty Ltd",
  "location": "Melbourne, Victoria",
  "archetype": "Backend / Platform Engineer",
  "cover_md": "...",
  "cover_letter_available": true
}
```

`tailorResume` remains for resume-only callers. `POST /api/analyze` uses `generateApplication` only — never a second cover-letter LLM call.

Gemini call-count logs (no API key / CV / JD / PII):

```
[gemini] application generation started
[gemini] generateContent call #1
[gemini] application generation completed
[gemini] total generateContent calls: 1
```

Retries log `logical generation request: 1` and `HTTP/API attempts: N`.

`POST /api/analyze` returns Gemini 429 / 503 / 404 as those HTTP statuses (not a generic 500) when `formatLlmError` attaches `statusCode`. Concurrent duplicate generation returns 409. Clients that send `Accept: application/x-ndjson` receive newline-delimited events (`progress` / `complete` / `error` / `cancelled`) instead of a single JSON body; HTTP 200 is used for the stream and logical errors arrive as `{ type: "error", status, error }`. Progress percentages map real pipeline stages only (5 accepted → 10 validating → 20 parsing → 30 preparing → 35 sending/generating → 85 received → 90 validating result → 95 saving → 100 complete). While Gemini is in flight the percentage stays at 35. `callLLM` passes `AbortSignal` to axios so the Gemini/Ollama HTTP request is aborted when the response connection dies (`res.close` / `req.aborted`). A finished POST body (`req.close`) does not abort generation. The UI shows 生成已取消 only when the user clicks 取消生成; an unexpected disconnect shows 连接已中断，生成未完成。 Aborted runs do not insert an application and `finishGeneration` always releases the in-memory lock.

After the single Gemini generation, `change-summary.js` locally diffs the original resume (`baseMd` / `user/cv.md`) against the saved markdown. Only verified textual diffs are stored in `applications.change_summary`. JD keywords are attached only when they occur in both the actual diff and the JD. Gemini-claimed blurbs are ignored. Comparison failure never blocks save; the UI then shows 暂时无法生成可靠的改动概要。 Old rows with a null `change_summary` stay valid and are not regenerated.

`POST /api/applications/:id/ask` is a later, optional LLM call. It drafts an answer to an employer follow-up question using the stored JD, tailored resume, cover letter, profile, and prior `qa_thread`. It does not regenerate or rewrite resume/cover/JD/change_summary. Answers must stay factually grounded in those sources.

Tailoring rules (enforced via `prompts/tailor.md`):
- **Priority:** Summary → Work Experience → Skills → Projects → other
- **Rewrite:** Summary; Work Experience bullets (real responsibilities only, JD-relevant first); Skills (bold + reorder); optional project-bullet rewrite
- **Titles:** official title stays unless CV/profile supports `Official Title | Functional Focus`
- **Never change:** employer names, dates, locations, education, existing metrics, YAML front matter
- **Never invent:** employers, titles, technologies, achievements, or convert projects into employment
- Suspicious work-experience additions are stored in `change_summary.unsupported_experience` and shown for review

Supports Gemini (default) and Ollama — switched via `LLM_PROVIDER` env var.

Gemini `generateContent` retry policy:
- **503 / 500 / 502 / 504:** exponential backoff 2s / 4s / 8s, max 3 retries. Exhausted errors return: `Gemini 服务暂时繁忙，请稍后重试。`
- **429 RESOURCE_EXHAUSTED:** do not use the short backoff. If Gemini `RetryInfo.retryDelay` is present and ≤ 60s, wait that delay and retry **once**. Otherwise return immediately. User-facing message: `Gemini API 请求额度已达到限制，请约 N 秒后重试。` (or `请稍后重试` when no delay is provided).
- **400 / 401 / 403 / 404:** not retried. 404 still names the model and Gemini's message. 403 user copy is mapped from the Google error body when possible (`PERMISSION_DENIED` / API disabled / model permission); HTTP 403 alone uses a generic Chinese refusal and never the axios `Request failed with status code 403` text.
- Final errors always go through `formatLlmError` — never a generic "temporarily unavailable after 3 retries" string. For Gemini non-2xx responses the backend logs HTTP status, `error.code`, `error.status`, a redacted `error.message`, details `@type` / `reason` / `domain`, and RetryInfo when present. It never logs the API key, `key=` query params, Authorization, request config, JD/CV/profile/prompt, or candidate text.

---

### coverletter.js

Fill-in-the-blank only. Placeholders in `user/cover-letter/template.md` are filled from the single `generateApplication` JSON (no second LLM call). `generateCoverLetter()` remains as a legacy helper and is not used by `/api/analyze`.

Placeholders:
```
{{company}}             ← company name
{{job_title}}           ← job title
{{why_company}}         ← 1-2 sentences from JD about why this company
{{matching_skills}}     ← top 3 skills from JD matching the resume
{{specific_project}}    ← most relevant experience bullet
{{why_company_culture}} ← 1-2 sentences on culture/mission fit
```

---

### evaluator.js

Runs a condensed job fit evaluation using `prompts/_shared.md` + `user/profile.md` + `prompts/evaluate.md`.
The Editor 分析 tab does **not** call this endpoint; it renders a local Chinese summary from persisted `fit_score` and verified `change_summary`.

Returns and saves to DB:
```json
{
  "eval_score": 78,
  "eval_recommendation": "Apply",
  "eval_archetype": "Backend / Platform Engineer",
  "eval_review": "{\"strengths\": [...], \"gaps\": [...], \"actions\": [...], \"summary\": \"...\"}"
}
```

---

### renderer.js

Converts Oh My CV markdown to HTML for preview and PDF export.

- `renderResume(markdown, theme)` — reads CSS from `themes/<theme>.css`
- `renderResumeWithCss(markdown, css, theme)` — injects a CSS string directly (live style editor)
- `renderCoverLetter(markdown)` — simple HTML wrapper for cover letter

Parses YAML front matter for the header block (`-` or `*` list items). Contact line is rendered as a single centered row: email (mailto) | phone (plain text) | GitHub (link); `email:` / `mobile:` / `github:` labels and portfolio are omitted from display. Handles `  ~ text` syntax for right-side annotations.

---

### exporter.js

Converts HTML to PDF via Puppeteer (`page.setContent()` + `page.pdf()`).

- `exportResumePDF(markdown, theme)` → Buffer
- `exportCoverLetterPDF(markdown)` → Buffer
- If `PUPPETEER_CACHE_DIR` points at an empty cache (e.g. Cursor sandbox), fall back to `~/.cache/puppeteer` when that directory already has Chrome. No Gemini calls.

Both use `printBackground: true`. PDFs are streamed directly to the browser — not saved to disk.

---

### db.js

**Engine:** `node:sqlite` (built into Node.js v22+, no install needed)

**Table: `applications`**

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | autoincrement |
| created_at | TEXT | ISO 8601 |
| company | TEXT | |
| job_title | TEXT | |
| location | TEXT | optional; added via ALTER TABLE, empty on older rows |
| url | TEXT | |
| source | TEXT | `linkedin` / `seek` / `other` |
| jd_text | TEXT | full JD |
| stack_used | TEXT | detected job title |
| fit_score | INTEGER | 0–100 |
| resume_md | TEXT | tailored resume markdown |
| cover_md | TEXT | generated cover letter markdown |
| change_summary | TEXT | JSON of locally verified original→generated diffs; null on older rows |
| qa_thread | TEXT | JSON array of `{role, content, created_at}` follow-up Q&A; default `[]` |
| status | TEXT | see status values below |
| theme | TEXT | e.g. `classic` |
| status_log | TEXT | JSON array of `{status, changed_at}` |
| follow_up | INTEGER | 0 or 1 |
| resume_template_id | INTEGER | FK to resume_templates |
| eval_score | INTEGER | 0–100 from evaluator |
| eval_recommendation | TEXT | `Apply` / `Apply with caveats` / `Skip` |
| eval_archetype | TEXT | detected archetype from evaluation |
| eval_review | TEXT | JSON `{strengths, gaps, actions, summary}` |

**Status values:** `not_started` · `analyzed` · `exported` · `applied` · `interview` · `rejected`

**Table: `resume_templates`**

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | autoincrement |
| name | TEXT | display name |
| markdown | TEXT | Oh My CV markdown content |
| is_default | INTEGER | 0 or 1 |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

On first run (table empty), `db.js` imports `user/cv.md` as `"Master Resume"` with `is_default = 1`. Existing rows are never overwritten. If `user/cv.md` is missing, a warning is logged and the server continues.

---

## Frontend

| Mode | URL | Notes |
|------|-----|-------|
| Dev | http://localhost:5173 | Vite dev server; proxies `/api/*` → backend `PORT` (default :3000) |
| Prod | http://localhost:3000 | Express serves `backend/public/` (built by `npm run build`); override with `PORT` |

**Stack:** React + Vite + TypeScript + Tailwind CSS + shadcn/ui

**UI language:** Simplified Chinese. API routes, DB field values (`status`, `source`, `theme`), and JSON keys stay in English. Display labels are mapped in `frontend/src/lib/labels.ts`. App chrome uses a Morandi dusty-rose token set in `frontend/src/index.css` (`--bg` `#F7F3F2`, `--surface` `#FFFCFB`, `--primary` `#B48C8A`, `--primary-dark` `#8B6D6C`). Resume PDF themes are unchanged.

**Pages:**
- `NewApplication` — paste JD, run AI analysis with a real-stage progress panel, informational elapsed wait time, and 取消生成 (AbortController); no automatic time-based abort; Resume Template dropdown auto-selects the default template. Default AI options: 简历 on, 求职信 off. After successful save, stay on the page with 下载简历 (and 下载求职信 if generated) via existing `GET /api/applications/:id/pdf`, plus 查看分析结果 → `/editor/:id`
- `History` — table of all past applications with inline status editing, always-visible row actions (download/edit/delete), plus 全部标记为已申请 (confirm dialog → one bulk status PATCH, no LLM)
- `Editor` — split markdown editor + live preview, PDF download; 分析 tab is a compact Chinese summary from persisted `fit_score` + verified `change_summary` / optional evidence matrix (no extra Gemini call); resume/cover tabs still show the verified change banner; 追问 tab uses `POST /api/applications/:id/ask`
- `Dashboard` — header + 新建申请; five stat cards; 申请状态 / 待跟进; 最近申请 / 本周动态; 52-week heatmap
- `Style` — live CSS editor with theme switcher
- `Settings` — tabs for CV, Profile, and Cover Letter Template editors
- `Resumes` — manage saved resume templates
- `ResumeEditorPage` — full-screen markdown editor for a template
- `ResumeBuilderPage` — guided form to build a template from structured fields

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React + Vite + TypeScript + Tailwind CSS + shadcn/ui |
| Backend | Node.js v22+, Express (port 3000) |
| AI | Gemini API (default) or Ollama (local) — switched via `LLM_PROVIDER` |
| Database | SQLite via `node:sqlite` (built-in, no install needed) |
| PDF export | Puppeteer — `page.setContent()` + `page.pdf()` |

---

## Environment Variables (`backend/.env`)

```
GEMINI_API_KEY=AIza...           # required for Gemini (default provider)
GEMINI_MODEL=gemini-3.6-flash    # Gemini model name

LLM_PROVIDER=gemini              # "gemini" (default) or "ollama"
OLLAMA_BASE_URL=http://localhost:11434   # Ollama base URL (if using Ollama)
OLLAMA_MODEL=gemma3:12b          # Ollama model (if using Ollama)
LLM_TIMEOUT_MS=120000            # optional Ollama axios timeout; unset = no timeout
PORT=3000                        # backend port; Vite /api proxy reads this from backend/.env
```

---

## Demo Mode

A static build that requires no backend, no API key, and can be hosted on GitHub Pages.

`VITE_DEMO_MODE=true` activates a mock layer in `api.ts`. Every API call is intercepted before any `fetch` is made — reads return hardcoded data from `demo-data.ts`, write operations trigger a `DemoCloneModal`.

Demo assets live in `frontend/public/demo/` (pre-generated PDFs + preview HTML). Regenerate after editing the source markdown:

```bash
npm run gen:demo
```

Build and deploy:
```bash
npm run build:demo        # outputs to demo-dist/
```

GitHub Actions (`.github/workflows/deploy-demo.yml`) auto-deploys to GitHub Pages on every push to `main`.

---

## Known Gotchas

1. `page.pdf()` requires `printBackground: true` to render coloured elements
2. `node:sqlite` does not support WAL mode toggle via pragma in all versions — keep default journal mode
3. `user.config.js` is not cached (`delete require.cache[...]`) so live theme changes take effect without restart
4. `tailor.js` uses `baseMd` if provided (from DB template); falls back to `user/cv.md` otherwise
5. Named params in `node:sqlite` use `:name` syntax; `run()` takes a plain object (no `:` prefix on keys)
