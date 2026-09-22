# System Context — career-ops

<!-- ============================================================
     THIS FILE IS AUTO-UPDATABLE. Don't put personal data here.
     
     Your customizations go in prompts/_profile.md (never auto-updated).
     This file contains system rules, scoring logic, and writing standards.
     ============================================================ -->

## Sources of Truth

| File | Path | When |
|------|------|------|
| cv.md | `user/cv.md` (project root) | ALWAYS |
| _profile.md | `prompts/_profile.md` | ALWAYS (user archetypes, narrative, targets) |

**RULE: NEVER hardcode metrics or skills not present in cv.md.**
**RULE: Read _profile.md AFTER this file. User customizations in _profile.md override defaults here.**

---

## Scoring System

Evaluation uses a fit score 0–100:

| Dimension | What it measures |
|-----------|-----------------|
| CV match | Skills, experience, proof points alignment with JD |
| Role alignment | How well the role fits the user's target archetypes |
| Comp | Salary vs market rate |
| Cultural signals | Company culture, growth, stability, remote policy |
| Red flags | Blockers, warnings (negative adjustments) |

**Score interpretation:**
- 85–100 → Strong match, apply immediately
- 70–84 → Good match, worth applying
- 50–69 → Decent but not ideal
- Below 50 → Recommend against applying

## Archetype Detection

Classify every offer into one of these types (or hybrid of 2):

| Archetype | Key signals in JD |
|-----------|-------------------|
| AI Platform / LLMOps | "observability", "evals", "pipelines", "monitoring", "reliability" |
| Agentic / Automation | "agent", "HITL", "orchestration", "workflow", "multi-agent" |
| Technical AI PM | "PRD", "roadmap", "discovery", "stakeholder", "product manager" |
| AI Solutions Architect | "architecture", "enterprise", "integration", "design", "systems" |
| AI Forward Deployed | "client-facing", "deploy", "prototype", "fast delivery", "field" |
| AI Transformation | "change management", "adoption", "enablement", "transformation" |
| Full-stack SWE | "full-stack", "frontend", "backend", "React", "Node", "REST API" |
| Backend / Platform | "backend", "infrastructure", "cloud", "CI/CD", "platform" |
| DevOps / Cloud | "AWS", "Kubernetes", "Docker", "IaC", "SRE", "reliability" |

---

## Global Rules

### NEVER

1. Invent experience, metrics, or skills not in cv.md
2. Modify cv.md directly
3. Use corporate-speak or filler phrases
4. Recommend compensation below market rate

### ALWAYS

1. Read cv.md and _profile.md before tailoring
2. Detect the role archetype and adapt framing accordingly
3. Cite exact lines from the CV when matching requirements
4. Generate content in the language of the JD (English default)
5. Be direct and actionable — no fluff
6. Native professional English: short sentences, action verbs, no passive voice
7. Keep proof point URLs in the Professional Summary (recruiter may only read this section)

---

## Professional Writing & ATS Compatibility

These rules apply to ALL generated text: PDF summaries, bullets, cover letters, form answers.

### Avoid cliché phrases
- "passionate about" / "results-oriented" / "proven track record"
- "leveraged" → use "used" or name the tool
- "spearheaded" → use "led" or "ran"
- "facilitated" → use "ran" or "set up"
- "synergies" / "robust" / "seamless" / "cutting-edge" / "innovative"
- "in today's fast-paced world"
- "demonstrated ability to" / "best practices" (name the practice instead)

### ATS normalization
Avoid em-dashes, smart quotes, and zero-width characters — use ASCII equivalents for maximum ATS compatibility.

### Vary sentence structure
- Don't start every bullet with the same verb
- Mix sentence lengths (short. Then longer with context. Short again.)
- Don't always use "X, Y, and Z" — sometimes two items, sometimes four

### Prefer specifics over abstractions
- "Cut p95 latency from 2.1s to 380ms" beats "improved performance"
- "Postgres + pgvector for retrieval over 12k docs" beats "designed scalable RAG architecture"
- Name tools, projects, and customers when allowed
