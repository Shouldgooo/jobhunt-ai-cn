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
│       ├── components/            # AppSidebar + shadcn/ui components
│       └── lib/api.ts             # Typed fetch wrapper for all /api calls
├── backend/
│   ├── server.js                  # Express (port 3000) — all routes under /api
│   ├── tailor.js                  # Resume tailoring + LLM call (Gemini or Ollama)
│   ├── coverletter.js             # Cover letter generation
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
  JD + user/profile.md + user/cv.md
    → tailor.js assembles prompt from prompts/tailor.md
    → LLM (Gemini or Ollama): detects archetype, rewrites summary, reorders skills/bullets
    → coverletter.js fills template.md placeholders
    → markdown saved to SQLite
    → returns: fit_score, job_title, detected_skills, archetype

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
| POST | `/api/analyze` | Stage 1: AI tailor → save markdown to DB |
| GET | `/api/applications` | All application records |
| POST | `/api/applications` | Create application without AI |
| GET | `/api/applications/:id` | Single application record |
| PATCH | `/api/applications/:id` | Update any allowed field |
| DELETE | `/api/applications/:id` | Delete record |
| GET | `/api/applications/:id/pdf?type=resume\|coverletter` | On-demand PDF stream |
| POST | `/api/applications/:id/rescore` | Re-score fit against JD via LLM |
| POST | `/api/applications/:id/evaluate` | Run full job fit evaluation |
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

Sends a single LLM call in JSON mode. Returns:

```json
{
  "tailored_resume_md": "...",
  "detected_skills": ["Python", "React", "AWS"],
  "fit_score": 82,
  "job_title": "Senior Backend Engineer",
  "archetype": "Backend / Platform Engineer"
}
```

Tailoring rules (enforced via `prompts/tailor.md`):
- **Rewrite:** Summary (inject JD keywords + apply archetype framing); Skills (bold + reorder)
- **Reorder only:** Experience bullets within each role; Projects section order
- **Never change:** Bullet text content, company names, dates, metrics, education, YAML front matter
- **Never invent:** Skills or experience not in the CV

Supports Gemini (default) and Ollama — switched via `LLM_PROVIDER` env var.

Gemini `generateContent` retries HTTP 429/500/502/503/504 up to 3 times with exponential backoff (2s, 4s, 8s). Permanent errors (400/401/403/404) are not retried. After retries are exhausted the API returns: `Gemini is temporarily unavailable after 3 retries. Please try again later.`

---

### coverletter.js

Fill-in-the-blank only. LLM fills placeholders in `user/cover-letter/template.md` without rewriting any other text.

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
| url | TEXT | |
| source | TEXT | `linkedin` / `seek` / `other` |
| jd_text | TEXT | full JD |
| stack_used | TEXT | detected job title |
| fit_score | INTEGER | 0–100 |
| resume_md | TEXT | tailored resume markdown |
| cover_md | TEXT | generated cover letter markdown |
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

**UI language:** Simplified Chinese. API routes, DB field values (`status`, `source`, `theme`), and JSON keys stay in English. Display labels are mapped in `frontend/src/lib/labels.ts`.

**Pages:**
- `NewApplication` — paste JD, run AI analysis; Resume Template dropdown auto-selects the default template
- `History` — table of all past applications with inline status editing
- `Editor` — split markdown editor + live preview, PDF download
- `Dashboard` — KPIs, status pipeline chart, activity heatmap, follow-up list
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
LLM_TIMEOUT_MS=120000            # LLM request timeout in ms
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
