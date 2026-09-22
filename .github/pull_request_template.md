## What does this PR do?

<!-- One paragraph: what changed and why. -->

## How was it tested?

<!-- Describe the scenarios you exercised manually. "I ran the tests" alone is not enough — also describe what you clicked or typed to verify the feature works end to end. -->

## Checklist

### General
- [ ] `cd backend && npm test` passes
- [ ] No new calls to external services (no analytics, telemetry, outbound HTTP beyond the LLM API)

### LLM changes (tailor.js / coverletter.js / evaluator.js)
- [ ] Tested with Gemini against at least one real job description (or N/A)
- [ ] Tested with Ollama against at least one real job description (or N/A — skip if you don't have Ollama set up, but note it)

### API / data changes
- [ ] New endpoint documented in `SPEC.md` API table (or N/A)
- [ ] Demo mode mock updated in `api.ts` + `demo-data.ts` for any new read path (or N/A)
- [ ] DB schema migration added to `db.js` migration block and `SPEC.md` schema table (or N/A)

### UI changes
- [ ] Screenshot or screen recording attached below (or N/A)

---

<!-- Screenshots / recordings go here -->
