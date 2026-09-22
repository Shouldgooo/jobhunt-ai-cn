# Mode: evaluate-json — Condensed Job Fit Evaluation

Given the candidate profile above and the job description below, return a JSON evaluation.

## Instructions

1. Detect the role archetype (use archetypes defined in the system context above)
2. Score fit 0–100 using the scoring dimensions defined above
3. List 2–3 strengths: specific CV skills/experience that directly match JD requirements
4. List 1–3 gaps: JD requirements not well covered by the CV (hard blockers vs nice-to-haves)
5. List 2–3 concrete actions the candidate should take before applying
6. Write a 1-sentence summary recommendation

## Output Format

Return ONLY valid JSON (no markdown, no extra keys):

{
  "archetype": "Backend / Platform Engineer",
  "eval_score": 78,
  "recommendation": "Apply",
  "strengths": ["Strong Django/FastAPI backend match", "AWS ECS and Lambda production experience directly relevant"],
  "gaps": ["No explicit Kubernetes mentioned — worth surfacing from Phygitalker role", "Seniority may be questioned — frame independent projects as production proof"],
  "actions": ["Rewrite summary to lead with AWS + Django production credentials", "Add Kubernetes explicitly to skills section"],
  "summary": "Strong backend match — apply and lead with AWS production experience to offset junior title concern."
}

- recommendation: exactly one of "Apply" | "Apply with caveats" | "Skip"
- eval_score: integer 0–100
- All arrays: 2–3 items max, plain English, no bullet symbols

## Candidate CV

{{CV}}

## Job Description

{{JD}}
