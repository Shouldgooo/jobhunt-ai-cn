## 2026-10-02 — Gemini structured output via responseFormat

- Send generateContent `generationConfig.responseFormat.text` with `mimeType: APPLICATION_JSON` (REST MimeType enum, not the IANA string `application/json`) and the current generation JSON Schema; keep `thinkingLevel: low`
- Do not send deprecated `response_schema` / `responseSchema` / `response_mime_type`
- Keep collectGeminiText, parseLlmJson, normalizeGenerationResult, evidence/hallucination checks, and one logical Gemini call; do not repair JSON

## 2026-10-02 — JSON.parse SyntaxError diagnostics

- On Gemini JSON parse failure, log a redacted `SyntaxError.message`, parse `position`, and candidate length
- Do not log the full candidate, JD/CV/profile, API keys, or request config; still refuse to save malformed JSON

## 2026-10-02 — Gemini HTTP 403 diagnostics

- Parse Google `error.response.data` on Gemini non-2xx (object or JSON string) and log HTTP status, `error.code`, `error.status`, redacted `error.message`, details `@type` / `reason` / `domain`, and RetryInfo
- Map 403 user copy from the Google body only (PERMISSION_DENIED / API disabled / model permission); generic 403 Chinese if unclassified — never axios `Request failed with status code 403`
- Do not retry 403; leave 429/503 retry unchanged; redact API keys and `key=` query params; do not log request config or personal content

## 2026-10-01 — Safer Gemini JSON extraction

- Extract JSON from thought-part payloads, fenced blocks, BOM/whitespace, and short surrounding text without a second Gemini call
- Distinguish truncated/incomplete JSON from schema validation; do not save applications on either failure
- Keep malformed JSON as a hard fail; never invent missing fields

## 2026-09-30 — Editor 分析 tab concise Chinese summary

- Replace the verbose original/adjusted resume blocks on 分析 with a compact Morandi summary: 匹配度, 综合分析, 本次简历调整, 主要优势, 需要注意, 建议
- Derive copy locally from persisted `fit_score` and verified `change_summary` (optional evidence matrix if present); never invent missing skills as experience
- Hide the duplicate 尚未评估 / 评估 Gemini CTA on this tab; keep `POST /api/applications/:id/evaluate` unused here

## 2026-09-30 — New Application defaults and post-generation downloads

- Default AI options on New Application: 简历 on, 求职信 off; cover letter remains optional and uses the existing generate path when selected
- Stay on New Application after successful generation; compact 生成完成 actions download the saved PDFs (`GET /api/applications/:id/pdf`) without extra Gemini calls
- Show 下载求职信 only when a cover letter was generated; 查看分析结果 → still opens `/editor/:id`

## 2026-09-30 — Morandi dusty-rose visual refresh

- Centralize warm Morandi tokens (`--bg`, `--surface`, `--primary`, status colors) and drop heavy black borders/offset shadows
- Redesign Dashboard: five compact stats, 申请状态 + 待跟进, 最近申请 + 本周动态; add + 新建申请
- Soft selected sidebar, muted status badges, and restyled charts without changing data logic

## 2026-09-30 — Black-and-white UI and job follow-up Q&A

- Switch app chrome to black / white / gray (buttons, badges, alerts, dashboard); resume PDF themes stay as-is
- Soften page and card backgrounds to warm paper gray (`#D6D3CB` / `#E5E2DA`) so large white areas are less harsh
- Add Editor 追问 tab and History entry so you can ask employer follow-ups after generating a resume
- `POST /api/applications/:id/ask` answers from the saved JD, resume, cover letter, and profile; persist `qa_thread` only

## 2026-09-30 — History download button always visible

- Keep History row actions (download / edit / delete) visible instead of hover-only, so the PDF download control no longer disappears

## 2026-09-25 — History bulk mark as applied

- Add 全部标记为已申请 on History with a confirm dialog before any write
- `PATCH /api/applications/status/all` runs one SQL `UPDATE applications SET status = ?` and returns `{ success, updated, status }`
- Do not touch resume, cover letter, JD, analysis, change summary, or other columns; no Gemini/LLM calls

## 2026-09-25 — Real generation progress and cancel

- Stream real pipeline stages over NDJSON from `POST /api/analyze` (no timer-based fake %)
- Keep the Gemini wait at 35% with an in-bar activity indicator; 429/503 retries update status text only
- Wire AbortController from 取消生成 through Express `req.close` to axios `signal`, skip DB insert, and release the generation lock
- Log generation/Gemini attempt timings without CV/JD/key content; do not treat elapsed wait time as an error
- Send Gemini `thinkingConfig.thinkingLevel=low`; clean job-board chrome for the prompt only; store the original pasted JD
- Show local elapsed wait time at 35% without inventing percentage progress or auto-aborting
- Remove application-level generation deadlines; only 取消生成 aborts a long-running request
- Stop treating `req.on('close')` as user cancel after the POST body is read; abort Gemini only on `res.close` / `req.aborted`
- Show 生成已取消 only after an explicit 取消生成 click; unexpected disconnects show 连接已中断，生成未完成。
- Fall back to `~/.cache/puppeteer` and pass an explicit Chrome `executablePath` so resume/cover PDF export works when Cursor sets an empty sandbox `PUPPETEER_CACHE_DIR`
- Persist a local verified resume/cover-letter change summary; never show an unverified Gemini-written changelog
- Tailor WORK EXPERIENCE from real CV/profile evidence; keep employer/dates/official title truthful; flag unsupported experience additions

## 2026-09-25 — One Gemini call per application + local JD extraction

- Merge resume tailoring and cover-letter fills into a single `generateApplication` LLM request (`generate_cover_letter` no longer starts a second call)
- Parse job title / company / location locally from pasted JD; Gemini only corrects missing fields in that same request
- Recognize markdown-bold labels (`**Location:**`, `**Company: **`) on paste; fill empty/auto fields immediately without a Gemini call
- General job-ad parser for whole-page pastes (labels, header heuristics, AU location scoring); not SEEK-specific; still 0 Gemini calls on paste
- Add optional `location` column via backward-compatible ALTER TABLE; existing rows keep working
- New Application: select master resume → paste JD → editable 职位名称 / 公司 / 地点 → 分析并生成; disable double-submit
- Log logical vs HTTP Gemini attempts; map 429/503/404 to matching API statuses; 409 on concurrent duplicate generation

---

## 2026-09-23 — Improve Gemini 429/503 retry and error messages

- Stop treating 429 quota errors as short 2s/4s/8s retries; wait Gemini `RetryInfo.retryDelay` at most once (cap 60s) or return immediately
- Always pass the last Gemini error through `formatLlmError` — 429/503/404 stay distinguishable; drop the generic "temporarily unavailable after 3 retries" message
- Show Chinese user-facing messages (`额度已达到限制` / `服务暂时繁忙`); `api.ts` displays the backend `error` string as-is
- Log HTTP status, Gemini error status/code, retry delay, and attempt without the API key

---

## 2026-09-22 — Keep personal job-search files out of the public repo

- Ignore `user/cv.md`, `user/profile.md`, `user/prompts.json`, and `user/cover-letter/*` (keep `*.example.md` templates)
- Replace personal name/email/phone fixtures in renderer tests with generic example data
- Seed the default resume template as "Master Resume" instead of a personal name

## 2026-09-22 — Center resume contact line as email | phone | GitHub

- Render header contacts as one centered line: email (mailto) | phone (plain text) | GitHub (link)
- Strip `email:` / `mobile:` / `github:` labels and omit portfolio from the header display
- Parse YAML header items with `*` or `-` list markers; keep markdown schema and resume content unchanged
- Replace the two-column `.resume-contact` flex layout with a centered single row (preview and PDF)

---

## 2026-09-22 — Localize frontend UI to Simplified Chinese

- Translate all user-facing frontend strings (nav, pages, buttons, labels, placeholders, tooltips, dialogs, status labels) to Simplified Chinese
- Add `frontend/src/lib/labels.ts` to map English API/DB values (`status`, `source`, `theme`, eval recommendation) to Chinese display text
- Keep identifiers, routes, DB keys, Gemini prompts, and generated resume/cover-letter content in English
- Set `index.html` `lang="zh-CN"` and page title to 求职申请跟踪系统

---

## 2026-09-22 — Retry transient Gemini 429/5xx with exponential backoff

- Retry Gemini HTTP 429, 500, 502, 503, 504 up to 3 times (2s, 4s, 8s) and log status, attempt, and delay
- Do not retry permanent 400/401/403/404; exhausted retries return a clear "temporarily unavailable after 3 retries" error
- Add tailor.js tests for 503→success, repeated 503, 429 retry, and 404 no-retry

---

## 2026-09-22 — Fix Gemini 404 on New Application analyze

- Default Gemini model is now `gemini-3.6-flash` — `gemini-2.5-flash` returns 404 for new API keys
- Surface Gemini's real error message (model + status) instead of axios's "Request failed with status code 404"
- Frontend API errors now include HTTP method, `/api/...` path, status, and backend message
- Send the Gemini API key via `x-goog-api-key` header so failed requests do not log the key in the URL

---

## 2026-09-22 — Seed default resume template from user/cv.md

- Import `user/cv.md` into `resume_templates` on first run when the table is empty, named "Master Resume" with `is_default = 1`
- Skip seeding when templates already exist; if `user/cv.md` is missing, log a warning and keep running
- Auto-select the default template on the New Application dropdown
- Add db tests for empty-db seed, no-duplicate, missing cv.md, and default lookup

---

## 2026-09-22 — Fix frontend JSON parse error when port 3000 is occupied

- Load `backend/.env` from `__dirname` so `GEMINI_API_KEY` and `PORT` are picked up regardless of cwd
- Make Vite `/api` proxy read `PORT` from `backend/.env` (default 3000) so a local port override reaches the real Express API instead of another app's HTML
- Surface a clear error when an API response is not JSON, instead of `Unexpected token '<'`
- Print a clear `EADDRINUSE` message telling the user to set `PORT` in `backend/.env`

---

## 2026-04-23 — Remove v1 leftover files from frontend

- Delete `frontend/app.js`, `frontend/editor.html`, `frontend/editor.js` — v1 vanilla JS files superseded by React/TypeScript in `frontend/src/`

---

## 2026-04-23 — Contributor tooling: ESLint, Prettier, editorconfig, CODE_OF_CONDUCT, CI lint

- Add `backend/eslint.config.js` (ESLint 9 flat config, CJS); install `@eslint/js` + `globals` as backend devDeps — `npm run lint --prefix backend` now works
- Fix `server.js`: replace undefined `BASE_MD_PATH` with `CV_MD_PATH` in style preview endpoint (caught by ESLint `no-undef`)
- Add `frontend-lint` and `backend-lint` jobs to `.github/workflows/test.yml` — ESLint now runs in CI on every PR
- Add `.editorconfig` (LF, 2-space indent, UTF-8, trim trailing whitespace)
- Add `.prettierrc`; install `prettier` as root devDep; add `format` and `format:check` scripts to root `package.json`
- Add `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1)
- Fix `.gitignore` typo: `coverl-letter` → `cover-letter`
- Fix `README.md`: add `cp .env.example .env` to Getting Started step 4; fix theme options comment (`minimal|compact|bold` → `executive|sidebar`); fix "Five built-in themes" → "Four"; remove broken `style.png` screenshot reference; remove duplicate gitignore note
- Fix `CONTRIBUTING.md`: add branch naming convention section; add `npm run lint` to pre-submit checklist; fix architecture comment (`minimal/compact/bold` → `classic/modern/executive/sidebar`)

## 2026-04-23 — Fix evaluator.js to read user/profile.md; clean up legacy files

- Fix `evaluator.js`: replace hardcoded `prompts/_profile.md` path with `user/profile.md` — evaluator now reads the same profile file as tailor.js; `_profile.md` was a legacy path that was already deleted
- Remove v1 leftover files: `user/base.md`, `user/config.json` (superseded by `user/cv.md` in Phase 6), `prompts/_profile.md`, `prompts/auto-pipeline.md`, `prompts/oferta.md`, `prompts/pdf.md` (unused), `REPO_ONBOARDING_PLAN.md`, `docs/prompt-integration-plan.md`
- Add `user/cover-letter/static.example.md`; add `static.md` and `prompts.json` entries to `scripts/setup.js`
- Fix `.gitignore`: add `user/profile.md` and `user/cover-letter/static.md`; untrack personal files that were accidentally committed
- Remove dead `geminiModel` key from `user.config.js` — never read by backend; Gemini model always comes from `GEMINI_MODEL` env var

## 2026-04-23 — Remove v1 leftover directories

- Delete `resumes/` (resume.css + templates/classic.css + templates/two-column.css) — v1 CSS files superseded by `themes/` in Phase 6; nothing in backend or frontend reads from this path
- Delete `cover-letter/template.md` from repo root — v1 leftover; backend reads from `user/cover-letter/template.md` exclusively

## 2026-04-23 — Add frontend typecheck to CI and local scripts

- Delete `cover-letter/template.md` from repo root — v1 leftover; backend reads from `user/cover-letter/template.md` exclusively; files were identical

## 2026-04-23 — Add frontend typecheck to CI and local scripts

- Add `typecheck` script to `frontend/package.json` (`tsc --noEmit`) and root `package.json` (delegates to frontend) — previously TypeScript errors were only caught during `npm run build:demo`, not during local development or the test workflow
- Split `test.yml` into two parallel jobs: `backend-test` (existing) and `frontend-typecheck` (new) — TypeScript errors now fail CI at the test stage before reaching the deploy workflow
- Update `CONTRIBUTING.md` pre-submit checklist to include `npm run typecheck`

## 2026-04-23 — Slim down CLAUDE.md to rules-only; move facts to SPEC.md

- Remove Key directories, API Endpoints table, and Environment Variables sections from CLAUDE.md — all three already exist in SPEC.md; keeping them in both caused the drift problems seen today
- CLAUDE.md now contains only: commands, automatic rules, and coding conventions (how to work in this repo, not what the repo contains)
- Add Fetch/API, SQLite access, and Demo mode convention blocks — these were previously missing and caused issues

## 2026-04-23 — Sync CLAUDE.md and PLAN.md to v2 architecture

- Rewrite CLAUDE.md key directories section: add evaluator.js, prompts/ dir, user/profile.md, scripts/setup.js; fix tailor.js description (v2: LLM call returning tailored_resume_md/archetype, not stack detection + placeholder fill); fix themes (classic/modern/executive/sidebar); fix prompts.json keys (rescore/coverletter only); fix status values; add Ollama env vars; remove reference to deleted REFACTOR_PLAN.md; replace stale API table (add all v2 endpoints, remove deleted /api/prompts)
- Rewrite PLAN.md Component Reference: replace v1 tailor.js logic (stack/placeholder) with v2 (prompts/tailor.md assembly); update /analyze response shape; add all v2 endpoints; add missing DB columns (status_log, follow_up, resume_template_id, eval_*); add resume_templates table; update .env keys (add LLM_PROVIDER/Ollama vars, remove OUTPUT_DIR)

## 2026-04-23 — Correct README and SPEC to match live codebase

- SPEC.md: remove deleted `/api/prompts` GET/PUT endpoints; add missing `POST /api/resume-templates/build-preview`; fix themes list in project structure (minimal/compact/bold → executive/sidebar)
- README.md: fix Themes table (was listing non-existent minimal/compact/bold, now shows actual classic/modern/executive/sidebar); update Tech Stack AI row to mention Ollama alongside Gemini; update Getting Started `.env` step to include Ollama setup option
- CONTRIBUTING.md: update themes list in Welcome Contributions section

## 2026-04-23 — Fix demo build TypeScript errors (CI failure)

- Delete `frontend/src/pages/ProfileTab.tsx` — dead file never imported anywhere; Settings.tsx replaced it with inline `ProfilePanel`, `CvPanel`, `CoverLetterPanel` components
- Fix `demo-data.ts`: remove stale v1 imports (`AppConfig`, `ExperienceBlock`) and deleted v1-only constants (`DEMO_EXPERIENCES`, `DEMO_CONFIG`); add missing `eval_score/recommendation/archetype/review` fields to all three `DEMO_APPLICATIONS` entries; fix `DEMO_ANALYZE_RESULT` (remove `stack`, `bolded_skills`, `soft_skills_injected`; add `job_title`)
- Fix `Editor.tsx`: remove unused `EvalResult` import; guard `refreshPreview` from being called when `tab === 'analysis'` (prevented type error passing `Tab` to `api.preview()` which only accepts `'resume' | 'coverletter'`)

## 2026-04-23 — Remove dead prompt code

- Remove unused `PROMPTS_PATH` constant from `server.js` (left over after `/api/prompts` endpoints were deleted in April 2026)
- Remove dead `tailor` key from `user/prompts.json` and `user/prompts.example.json` — tailor prompt now lives in `prompts/tailor.md` (fixed file read by `tailor.js` directly); the JSON key was never read

## 2026-04-22 — Add contributor documentation for open source

- Add `CONTRIBUTING.md` — prerequisites (Node v22+ + node:sqlite rationale), full local setup steps, architecture overview, development rules (api.ts / db.js / LLM boundaries), demo mode update requirements, DB migration pattern, PR guidelines, welcome contributions, and off-limits list
- Add `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md` with environment fields (OS, Node, LLM provider/model) and `config.yml` to disable blank issues
- Add `SECURITY.md` directing reporters to GitHub Private Vulnerability Reporting
- Add `.github/pull_request_template.md` with checklist covering tests, Gemini/Ollama verification, demo mode mocks, schema migrations, and UI screenshots

## 2026-04-22 — Rewrite SPEC.md to match current v2 architecture; update README

- Rewrite SPEC.md from scratch — removes all v1 references (Oh My CV, vanilla JS frontend, /process endpoint, base.md + config.json)
- Project structure, API endpoints, component details, DB schema, and tech stack now accurately reflect the live codebase
- README: add user/profile.md to setup instructions and personalisation table

## 2026-04-22 — Clean up legacy example files; update setup script

- Delete `user/base.example.md` and `user/config.example.json` — superseded by `cv.md`/`profile.md` workflow
- Update `scripts/setup.js` to copy `cv.example.md` → `cv.md` and `profile.example.md` → `profile.md` for new users instead of the old base/config files

## 2026-04-22 — Separate user data layer from prompt logic in tailor pipeline

- Add `user/profile.md` — user-owned file for target roles, adaptive framing, and professional narrative (replaces personal data that was in `prompts/_profile.md`)
- Add `user/profile.example.md` — blank template for new users to fill in
- Add `prompts/tailor.md` — fixed one-shot prompt template integrating archetype detection, writing rules, and ATS rules from `_shared.md`; replaces the `tailor` string in `prompts.json`
- Update `tailor.js` to assemble prompt from `prompts/tailor.md` + `user/profile.md` + `user/cv.md`; now returns `archetype` field alongside existing fields
- Add `GET/PUT /api/profile` endpoints to `server.js`
- Add `getProfile`/`saveProfile` to `api.ts`
- Add Profile tab to Settings page for editing `user/profile.md` in-browser

## 2026-04-21 — Fix coverletter.js to respect LLM_PROVIDER

- Replace hardcoded `geminiJSON()` in `coverletter.js` with shared `callLLM()` from `tailor.js`
- Cover letter generation now uses Ollama when `LLM_PROVIDER=ollama`, same as resume tailoring

## 2026-04-21 — Add Analysis tab with AI job evaluation

- New `POST /api/applications/:id/evaluate` endpoint — runs condensed oferta.md-style evaluation via Gemini/Ollama
- New `evaluator.js` reads `prompts/_shared.md` + `_profile.md` + `evaluate.md` for modular prompt construction
- DB migration adds `eval_score`, `eval_recommendation`, `eval_archetype`, `eval_review` columns
- Editor gains third "Analysis" tab: Evaluate button, score/archetype/recommendation display, strengths/gaps/actions breakdown

## 2026-04-21 — Fix frontend timeout for slow local LLMs

- Remove hardcoded 65s `AbortController` timeout in `NewApplication.tsx` — replace with `VITE_ANALYZE_TIMEOUT_MS` env var (default 300s)
- Set `timeout: 0` and `proxyTimeout: 0` on Vite's `/api` proxy so slow Ollama models don't get cut off

## 2026-04-20 — Add Ollama support as alternative LLM provider

- Replace `geminiJSON()` in `tailor.js` with `callLLM()` that branches on `LLM_PROVIDER` env var
- `LLM_PROVIDER=ollama` calls `POST {OLLAMA_BASE_URL}/api/generate` with `format: "json"` for structured output
- `LLM_PROVIDER=gemini` (default) retains existing Gemini behaviour; 503 error message now suggests switching to Ollama
- Add `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `LLM_TIMEOUT_MS` env vars; update `.env.example` with both provider sections
- No changes to prompt logic or response validation — both providers use identical prompts and return same shape

## 2026-04-20 — Fix Settings page: replace broken Profile tab with CV editor, enlarge editor panels

- Replace dead `ProfileTab` (called removed `api.getConfig()`/`saveConfig()`) with a new `CvPanel` that reads/writes `user/cv.md` via new `GET/PUT /api/cv` endpoints
- Add `GET /api/cv` and `PUT /api/cv` to `server.js`; add `getCv()`/`saveCv()` to `api.ts`
- Extract shared `EditorPanel` component in `Settings.tsx` to avoid duplication between cover-letter and cv panels
- Increase textarea height from fixed `min-h-[32rem]` to `min-h-[calc(100vh-22rem)]` so both panels use most of the viewport height
- Settings tabs now labeled "Cover Letter Template" and "CV (cv.md)" for clarity

## 2026-04-20 — Simplify pipeline to cv + prompt (remove config.json dependency)

- Replace `user/base.md` (placeholder template) + `user/config.json` (bullet pool / stack config) with `user/cv.md` (complete CV in Oh My CV format)
- Rewrite `backend/tailor.js`: remove `formatSkillList`, `selectBulletsFromPool`, `injectSoftSkillBullets`; now reads `user/cv.md`, sends CV + JD to Gemini, returns `{ markdown, fit_score, detected_skills, job_title }`
- Rewrite `user/prompts.json` tailor key: AI directly rewrites Summary + reorders Skills/bullets/Projects; add separate `rescore` key for lightweight fit scoring
- Remove `/api/stacks`, `/api/config` GET/PUT routes from `server.js`; remove `CONFIG_JSON_PATH` / `BASE_MD_PATH` constants; remove `{{placeholder}}` check
- Update `server.js` analyze response: remove `stack`, `bolded_skills`, `soft_skills_injected`; add `job_title`; store `job_title` in `stack_used` DB column
- Update `frontend/src/lib/api.ts`: remove `AnalyzeResult.stack/bolded_skills/soft_skills_injected`; add `job_title`; remove config-related interfaces and `getStacks`/`getConfig`/`saveConfig` methods
- Update `frontend/src/pages/NewApplication.tsx`: remove stacks fetch, "AI variants" label, stack badge, soft_skills warning; simplify skill badges to single variant
- Add `prompts/` folder with English translations of career-ops modes: `_shared.md`, `_profile.md`, `pdf.md`, `oferta.md`, `auto-pipeline.md`
- Rewrite `backend/tests/tailor.test.js` to test new simplified interface (37/37 pass)
- Add `user/cv.example.md` (complete CV template, no placeholders); update `user/prompts.example.json` to match new tailor/rescore/coverletter format
- Update `.gitignore`: replace `user/base.md` + `user/config.json` with `user/cv.md`
- Update `README.md`, `CLAUDE.md`, `SPEC.md`: remove all references to `base.md`, `config.json`, and placeholder-filling logic; document new `cv.md` approach

## 2026-04-16 — Replace prompts editor with cover letter template editor in Settings

- Remove `/api/prompts` GET/PUT endpoints from `server.js`; add `/api/cover-letter/template` GET/PUT that reads/writes `user/cover-letter/template.md`
- Remove `getPrompts`/`savePrompts` from `api.ts`; add `getCoverLetterTemplate`/`saveCoverLetterTemplate`
- Rewrite `Settings.tsx`: replace 'prompts' tab (two prompt textareas) with 'cover-letter' tab (single template editor with `{{company}}` / `{{job_title}}` placeholder hints)
- Prompts remain hidden server-side; users only configure their personal cover letter content

## 2026-04-16 — Auto-fill static cover letter on manual application save

- Add `user/cover-letter/static.md` — a pre-written cover letter with only `{{company}}` and `{{job_title}}` as placeholders, no AI required
- `POST /api/applications` now reads `static.md` and fills in company + job_title before saving `cover_md`, so the editor always has a ready-to-use cover letter even without Gemini
- Also remove weak/repetitive hardcoded bullets from `user/base.md` (`"Collaborated across teams"`, `"Managed source control with Git"`, `"Description:"` labels)

## 2026-04-15 — Fix markdown link rendering in resume body

- Add `[text](url)` → `<a href>` conversion to `inlineMd()` in `renderer.js`; previously only `**bold**` was parsed, causing raw link syntax to appear as literal text in PDFs
- Fixes GitHub URLs in Projects section (`~ [github.com/...](https://...)`) not rendering as clickable links

## 2026-04-14 — Generalize experience blocks with content pool

- Replace company-specific `orefox_*`/`phygitalker_*` keys throughout `config.json`, `base.md`, and `tailor.js` with generic `exp1`/`exp2` identifiers — tool is no longer coupled to any individual's work history
- Restructure `config.json` schema: `stacks[x].bullets` flat dict → `stacks[x].experiences[]` array; each experience has `id`, `technologies`, `bullet_pool[]` (with `must_have`, `tags`, optional `stack_variant`)
- Replace `job_roles[x].orefox_bullet_set`/`phygitalker_bullet_set` with `experience_slots: { exp1: N, exp2: M }` — declarative slot counts instead of hardcoded key lists
- Add `selectBulletsFromPool()` in `tailor.js`: selects bullets from pool using must_have priority + JD keyword/tag scoring; handles `stack_variant` filtering for Python Django/FastAPI variants
- Replace hardcoded `~ Taiwan` string detection in `injectSoftSkillBullets` with a `<!-- SOFT_SKILLS_INJECT -->` marker in `base.md`; marker is removed cleanly when no soft skills match
- Update `base.md`, `base.example.md`, `config.example.json`, TypeScript types (`BulletPoolEntry`, `ExperienceBlock`), `demo-data.ts`, and `ProfileTab.tsx` to reflect new schema
- ProfileTab now renders collapsible experience blocks with inline bullet pool editor (must-have checkbox, text, tags) instead of a flat key→value bullet list

## 2026-04-12 — Universal prompt + Profile UI

- Add `{{STACK_KEYS}}` and `{{JOB_ROLE_KEYS}}` injection to `tailor.js` (both `tailorResume` and `rescoreResume`); extract shared `buildTailorPrompt()` helper to avoid drift
- Add `user/prompts.example.json` — ready-to-use universal prompt that works with any config without hardcoded stack names or personal details; existing `prompts.json` is unaffected
- Add `GET /api/config` and `PUT /api/config` endpoints to read/write `user/config.json` with basic shape validation
- Add `AppConfig`, `StackConfig`, `JobRoleConfig`, `SoftSkillEntry` TypeScript interfaces to `api.ts`
- Add `getConfig()` and `saveConfig()` to the `api` object with demo mode support
- Add `DEMO_CONFIG` to `demo-data.ts`
- Add Profile tab to Settings page: skill list editor (tag pills), experience bullet editor, soft skills pool editor; all persisted via PUT /api/config

## 2026-04-12 — Fix double-click required on Download and Analyze buttons

- Fix PDF download in `Editor.tsx`: append anchor to DOM before `.click()` and delay `URL.revokeObjectURL` by 100ms so browser can process the download asynchronously before the blob URL is revoked
- Fix all Button variants in `button.tsx`: add `active:` state (extra 1px translate + brightness dim) distinct from hover state, so users get clear visual feedback that a click was registered

## 2026-04-05 — Static demo mode

- Add `VITE_DEMO_MODE=true` build flag; `npm run build:demo` outputs to `demo-dist/` (separate from production build)
- Add mock layer in `api.ts` — all API calls intercepted in demo mode; writes trigger a "clone repo" modal, reads return hardcoded fake data
- Add `DemoCloneModal` component shown globally via `App.tsx` when any write action is attempted
- Add `frontend/src/lib/demo-data.ts` with fictional candidate (Jordan Avery) + 3 fake applications
- Add `frontend/public/demo/` with pre-generated `resume.pdf`, `coverletter.pdf`, and `preview.html`
- Add `scripts/generate-demo-assets.js` to regenerate static assets from `demo/*.md` files
- Fix pre-existing TS errors: remove unused `Clock` import in `History.tsx`, replace invalid `title` prop with `aria-label` in `Resumes.tsx`

## 2026-04-04 — N/A score display + AI Re-score feature

- Show `N/A` instead of `0` for unscored applications in History (ScoreBar) and Editor header; fix detail panel showing `0 / 100`
- Add `rescoreResume(jd)` to `tailor.js` — lightweight Gemini call returning only `fit_score`, reusing tailor prompt
- Add `POST /api/applications/:id/rescore` — uses stored JD or accepts JD in body (also saves JD to DB if missing); returns `{ fit_score }`
- Add Re-score button to Editor header (resume tab only): if JD exists scores immediately, otherwise opens dialog to paste JD
- Score display added to Editor header left (beside status badge)

## 2026-04-04 — Fix Dashboard Pipeline count double-counting

- Fix `countByStatus` in `Dashboard.tsx` to only count an application's current status, not all historical statuses from `status_log`
- Previously, an application that moved from `not_started` → `applied` would be counted in both buckets

## 2026-04-03 — Phase 10: Resume Builder (Form → Markdown)

- Add `POST /api/resume-templates/build` — accepts structured personal/summary/skills/experience/education/certifications data, generates Oh My CV markdown, saves to `resume_templates` table
- Add `POST /api/resume-templates/build-preview` — same markdown generation but no DB save, for live preview use
- Add `ResumeBuilderPage.tsx` at `/resumes/build` — full-screen split form + live preview; supports multiple skill groups, experience entries with bullets (add/remove), multiple education and certification entries
- Replace "New Resume" direct-create flow with a modal on the Resumes page offering "Build with form" (→ builder) or "Edit as markdown" (→ blank editor)
- Add `api.buildTemplate()` to typed API client

## 2026-03-31 — Fix Skills section layout in all themes

- Fix Skills section layout in all single-column themes (classic, minimal, compact, bold): replace `justify-content: space-between` row with a CSS grid (`grid-template-columns: max-content 1fr`) on the section; `.row` becomes `display: contents` so label and value are grid children — label stays on one line, long values wrap within their own column

## 2026-03-31 — Phase 11: UX polish

- Add yellow warning banner when JD is under 100 characters (non-blocking, shows char count)
- Improve delete confirmation message to describe consequences: "permanently remove all saved data including markdown and status history"
- Add status icons to all status badges and dropdown options (Hourglass/Send/Bell/Users/XCircle) — accessibility fix, no longer colour-only
- Add "Preview →" link next to Theme selector in New Application form — opens template preview modal with selected theme applied

## 2026-03-30 — Phase 9: Multi-resume templates

- Add `resume_templates` DB table with seed migration (imports `user/base.md` as default on first run); add `resume_template_id` to `applications` table
- Add full CRUD API for `/api/resume-templates` (list/create/get/update/delete/set-default); `DELETE` blocks removal of the last template
- Add `POST /api/applications` for Persona A direct save (no AI); copies template markdown to `resume_md`, redirects to Editor
- Extend `/api/analyze` to accept `resume_template_id` and `generate_cover_letter`; rejects AI if template has no `{{placeholders}}`; `tailor.js` accepts optional `baseMd` param
- New Application form redesigned: template selector with Preview modal, optional JD, AI checkboxes (shown only when JD has content), single smart button ("Save & Track" vs "Analyze →")
- New `/resumes` management page in sidebar: list templates with default star, Edit/Duplicate/Delete/Set-as-default actions
- New `/resumes/:id` full-screen template editor: split view (markdown + preview), name input, autosave, Set as default button
- Editor: "Save as template" button opens modal with pre-filled name → creates new template from current resume_md

## 2026-03-30 — Phase 8: Onboarding and open source prep

- Add `user/base.example.md`, `user/config.example.json`, `user/cover-letter/template.example.md` with generic fictional data so new users have a starting point
- Update `.gitignore` from blanket `user/` exclusion to specific personal files (`base.md`, `config.json`, `prompts.json`, `template.md`), allowing example files to be committed
- Add `GET /api/stacks` endpoint that reads stack names from `user/config.json`; show available AI variants above JD textarea in New Application form
- Rename "Stack" label to "Resume variant" in result card; update JD textarea placeholder to clarify AI is optional
- Add collapsible "Available tokens" reference under each Settings prompt textarea, showing token names and descriptions

## 2026-03-30 — Phase 7: Bug fixes, silent failure detection, and robustness

- Add save error banner + Ctrl+S + Save button in Editor; autosave failures now surface visibly instead of silently dropping changes
- Add cover letter unavailable warning in result card and Editor; `cover_letter_available` flag returned from `/api/analyze`; `generateCoverLetter` returns `{ markdown, available }` object
- Validate Gemini response shape in `tailor.js` (stack/detected_skills/fit_score); clamp fit_score to 0–100; return `soft_skills_injected` flag with yellow hint in result card
- Replace anchor-tag PDF download with fetch-based download with loading/disabled state to prevent double-clicks spawning multiple Puppeteer instances
- Add descriptive errors: GEMINI_API_KEY missing (B1), 429 quota exceeded (B2), missing user/base.md or config.json (B3), misleading PDF 404 messages (B4)
- Add 60s Puppeteer timeout (D1); 60s `Promise.race` in both `geminiJSON` functions (D6); 65s `AbortController` in frontend analyze call (D6)
- Add `PUT /prompts` token validation (`{{JD}}` + `{{TEMPLATE}}`); theme name whitelist (`/^[a-z0-9-]+$/`) on all endpoints that accept theme; `status_log` JSON.parse guard in db.js

## 2026-03-24 — Improve frontend spacing, padding, and text legibility

- Replace hardcoded `padding: '1.5rem 10rem'` in App layout with responsive Tailwind (`px-6 py-6 md:px-10 lg:px-14`) and add `max-w-6xl mx-auto` content wrapper to prevent over-stretching on wide screens
- Unify page heading size: Dashboard `h1` changed from `text-2xl` to `text-3xl` to match History, NewApplication, and Settings
- Increase KPI card padding from `px-4 py-3` to `px-5 py-4` and bump label font from `text-[10px]` to `text-xs` for legibility
- Raise all `text-[9px]` instances in Dashboard (bar chart, heatmap, tooltip) to `text-[10px]` to meet minimum readable size
- Increase History filter tab height from `py-1` to `py-1.5` for better touch targets
- Increase Sidebar nav link row height from `py-2` to `py-2.5` for improved breathing room
- Fix Dashboard mobile layout: change `items-start` to `sm:items-start` so columns stretch to full width on mobile instead of shrinking to content width
- Widen Job Description in History detail panel: change layout from `grid-cols-2 max-w-3xl` to `grid-cols-[3fr_1fr]` (no width cap), giving JD 75% and metadata 25%; increase textarea min-height from `min-h-36` to `min-h-48`
- Add quick-unflag to Dashboard Follow-up panel: hover a row to reveal × button that immediately removes the follow-up flag via API patch and updates local state; status label hides on hover to make room

## 2026-03-23 — Fix heatmap to fill container width

- Rewrite HeatmapChart to use CSS grid (`gridTemplateColumns: auto repeat(N, minmax(8px, 1fr))`) so week columns expand to fill available width
- Replace fixed `w-3 h-3` cells with `aspect-square` so cell height auto-matches dynamic width
- Restructure DOM from column-major flex to row-major flat grid items (corner + month labels in row 0, day label + cells per row 1–7)
- Update title to "Last 52 Weeks" to match actual 52-week range in `buildHeatmapGrid`
- Add React import (needed for `React.Fragment` with key)

## 2026-03-22 — Add two-column layout support to renderer + modern theme

- Add `LEFT_SECTION_SLUGS` (Set) and `TWO_COLUMN_THEMES` (Set) constants to `renderer.js`
- Update `renderBody(body, theme)` to emit `<div class="resume-left">` / `<div class="resume-right">` when theme is in `TWO_COLUMN_THEMES`; single-column output unchanged for all other themes
- Update `renderResume` and `renderResumeWithCss` to thread `theme` through to `renderBody`; all existing call signatures remain backward-compatible
- Replace `themes/modern.css` with flexbox-based white two-column layout targeting `.resume-left` / `.resume-right`; left column 62mm with `border-right: 1px solid #ddd`, right column `flex: 1`
- All 39 existing tests pass

## 2026-03-22 — Apply Swiss International Style (Brutalist) design system

- Rewrite `index.css`: canvas background `#F0F0E8`, black borders, blue-700 primary, zero border-radius, serif headings via CSS
- Rewrite all shadcn primitives (button, badge, card, input, label, textarea, select) with hard shadows, `rounded-none`, mono uppercase, brutalist variants
- Rewrite `AppSidebar`: serif logo, mono nav labels, black active state inversion, `border-r-2 border-black`
- Rewrite all pages (NewApplication, History, Settings, Editor, Style): serif page titles, mono metadata/labels, colored-dot panel headers, retro bracket syntax for empty states
- Status badges redesigned: filled color backgrounds (blue=applied, green=interview, red=rejected)
- Score bar: square `rounded-none` progress bar with black border

## 2026-03-21 — Unify sidebar across all pages

- Extract sidebar into shared `AppSidebar.tsx` with a reusable `SidebarLayout` wrapper
- Style page now uses `SidebarLayout` instead of its own full-screen layout — sidebar is consistent across all pages
- Remove `ArrowLeft` back button and custom black header from Style page; replace toolbar with standard white bar using primary-colored active state
- Style page template selector buttons now use `bg-primary` for active state to match app color theme

## 2026-03-21 — Redesign layout: top nav → sidebar, add blue primary color

- Replace top navigation bar with a left sidebar layout (standard SaaS pattern)
- Add icon + label nav items grouped into main (New Application, History) and bottom (Style, Settings)
- Switch primary color from black to blue (`221 83% 53%`) with matching ring, border, and muted token updates
- Mobile: sidebar becomes a slide-in overlay triggered by hamburger button
- Editor and Style pages remain full-screen (no sidebar)

## 2026-03-20 — Add job_role + stack dual-dimension resume tailoring

- Update `tailor.js` to read `job_role` and `python_framework` from Gemini response alongside `stack`
- Resolve summary, orefox bullets (×5), and phygitalker bullets (×3) from `config.job_roles[job_role]` bullet sets
- Add `resolveBulletKey` helper for Django variant support (`_django` suffix on bullet keys when `stack=python` and `python_framework=django`)
- Fill `{{ai_skills_section}}` from `stackConfig.ai_skills` when `roleConfig.include_ai_skills` is true, empty string otherwise
- Return `job_role` and `python_framework` alongside existing `stack`, `detected_skills`, `bolded_skills`, `fit_score`
- Move `prompts.json` from `resumes/` to `user/`; update path references in `tailor.js`, `coverletter.js`, `server.js`

## 2026-03-19 — Separate user data from tool logic (open source prep)

- Create `user/` (base.md, config.json, cover-letter/template.md) as the single folder new users edit; add to .gitignore so personal data is never committed
- Create `themes/` with five CSS themes (classic/modern/minimal/compact/bold); classic is the existing resume.css, others are placeholders
- Add root `user.config.js` (theme + geminiModel)
- Update backend path references: tailor.js → user/, coverletter.js → user/, renderer.js → themes/${theme}.css, server.js → themes/ for style routes
- Add `theme` column to SQLite applications table (migrated automatically)
- Frontend: theme dropdown on Generate form + theme switcher in Editor header; theme stored per-application and used for PDF export and preview
- Update README with Getting Started for New Users section

---

## 2026-03-19 — Fix Style preview scroll and two-column layout gap

- Fix ScaledPreview: measure iframe content height after load (`scrollHeight`) instead of using fixed A4_H — multi-page resumes now scroll to the bottom correctly
- Fix two-column template: replace CSS Grid (shared row heights caused a gap below Certification before Education) with CSS `column-count: 2` + `break-before: column` on `.section-skills` — each column now fills independently

---

## 2026-03-19 — Redesign Style page layout

- Replace big template cards with a compact top toolbar button group
- Style page is now full-height split view (CSS editor left, preview right), same pattern as Editor page
- Template selector shows as small pill buttons; "Custom" label appears when CSS is manually edited
- Mobile: editor/preview toggle tabs below toolbar

---

## 2026-03-19 — Style page: template switcher + live CSS editor

- Add `renderer.js` export `renderResumeWithCss(markdown, css)` for style preview without touching active CSS file
- Add backend routes: `GET/PUT /api/style`, `GET /api/style/templates`, `POST /api/style/preview`
- Preview uses most recent application's resume_md; falls back to base.md if no applications exist
- Add `Style` nav item and page with: template card picker (wireframe thumbnails), CSS editor, live preview iframe
- Template active state detected by CSS content comparison
- Mobile: editor/preview toggle tabs; desktop: side-by-side

---

## 2026-03-19 — Add two-column CSS template, section wrappers in renderer

- Refactor `renderer.js` `renderBody`: group blocks by `## heading` and wrap each section in `<section class="resume-section section-[slug]">` — enables CSS to target individual sections by name
- Add `resumes/templates/classic.css` — copy of current single-column layout
- Add `resumes/templates/two-column.css` — new layout: left col (Summary/Certification/Education), right col (Skills/Experience); header switches to name-left + contact-right
- Update `resumes/resume.css` with `.resume-section` rule for compatibility
- All 39 tests pass after renderer change

---

## 2026-03-19 — Fix Editor preview stale state bug

- Fix: switching tabs (resume ↔ cover letter) showed wrong preview due to React stale closure
- Root cause: `setMarkdown` and `refreshPreview` were in separate useEffects; preview fired before state updated
- Fix: merge into one useEffect, pass `newMd` and `tab` directly to `refreshPreview` instead of reading from state
- Fix: manual refresh button and mobile panel toggle also updated to pass explicit values

---

## 2026-03-19 — UI redesign: Figma-style black/white, fully responsive

- Switch to Inter font for clean, professional typography
- Redesign color system: pure black header, white background, neutral-200 borders (no heavy shadows)
- NewApplication: score displayed as large number with color + label, skills section cleaner
- History: desktop table with hover-reveal action buttons; mobile shows card layout instead of table
- Settings: cleaner single-column layout with descriptive helper text
- Editor: mobile adds editor/preview panel toggle tabs; download buttons adapt to mobile; use `h-dvh` for correct mobile viewport height
- Header: hamburger menu on mobile with slide-down nav drawer

---

## 2026-03-19 — Complete React frontend migration (Phase 5)

- Add shadcn/ui component set: Button, Card, Badge, Input, Textarea, Label, Select (manual setup)
- Implement NewApplication page: form with validation, score display, skill badges, navigate to editor on success
- Implement History page: sortable/filterable table, expandable detail rows, inline-editable cells, status dropdown, download/edit/delete actions
- Implement Settings page: prompt editor for tailor + cover letter prompts, save feedback
- Implement Editor page: full-screen split view with markdown editor (left) + iframe preview (right), tab switching between resume and cover letter, auto-save with debounce, PDF download buttons
- All pages use typed `lib/api.ts` — no raw fetch calls in components

---

## 2026-03-19 — Frontend modernization scaffold (Phase 5)

- Add root `package.json` with `concurrently` — `npm run dev` starts backend + frontend together
- Rewrite `backend/server.js`: mount all routes under `/api` prefix via Express Router; serve `backend/public/` as production frontend (only if directory exists)
- Scaffold `frontend/` as Vite + React + TypeScript + Tailwind CSS project
- Add `vite.config.ts`: proxy `/api/*` → `localhost:3000` in dev; build output → `backend/public/`
- Add `src/lib/api.ts`: typed API client for all backend endpoints
- Add page stubs: `NewApplication`, `History`, `Settings`, `Editor`
- Add `App.tsx` with React Router layout and nav

---

## 2026-03-19 — Add .gitignore, untrack sensitive files

- Add `.gitignore`: exclude `backend/.env`, `backend/applications.db`, `output/*/`, `node_modules/`, OS/editor junk
- Untrack `backend/.env` and `backend/applications.db` via `git rm --cached` (files kept locally)

---

## 2026-03-19 — Name per stack, settings error fix, remove Oh My CV

- Add `{{name}}` placeholder to `base.md` so the resume name is driven by config instead of hardcoded
- Add `name` field to each stack in `config.json`: `python` → "Trista Chou", `csharp`/`java` → "Hsin-Yu Chou"
- Wire `{{name}}` replacement into `tailor.js` replacements map
- Update CLAUDE.md placeholder count from 15 → 16
- Improve `loadPrompts()` error message: detect non-JSON response and tell user to check backend port instead of showing cryptic JSON parse error
- Delete `oh-my-cv-main/` directory (v2 refactor complete — no longer needed)
- Remove `OHMYCV_PATH` and `OHMYCV_PORT` from `.env`
- Update `PLAN.md`: clean up stale Oh My CV references in Component Reference, add scoring system as future plan
- Move Phase 3 scoring system from `REFACTOR_PLAN.md` to `PLAN.md` Future Plans section
