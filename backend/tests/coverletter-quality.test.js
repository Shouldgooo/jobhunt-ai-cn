'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCoverLetterPrompt,
  generateCoverLetterDocument,
  COVER_LETTER_CLICHE_PHRASES,
  COVER_LETTER_TARGET_WORDS,
  COVER_LETTER_RESPONSE_JSON_SCHEMA,
} = require('../coverletter');
const { parseFrontMatter } = require('../renderer');

const QUALITY_CV = `---
name: Jordan Avery
header:
  - text: "email: jordan@example.com"
  - text: "mobile: 0400 000 000"
  - text: "location: Melbourne VIC"
---

## Summary
IT support and junior software experience across helpdesk, TypeScript services, and Excel reporting.

## Work Experience

### Service Desk Analyst — Harbor Civic
- Resolved 20–30 tickets a day for Windows 11, Microsoft 365, and Active Directory password resets
- Guided staff through VPN and printer issues by phone and remote desktop
- Logged incidents in a service desk queue and followed ITIL-style priorities

### Junior Software Developer — Northwind Labs
- Built TypeScript APIs for an internal request tracker
- Wrote React forms for ticket intake
- Covered unit tests for the most common request paths

### Reporting Assistant — Harbor Civic
- Prepared weekly Excel workbooks of ticket volumes for the operations lead
- Used SQL SELECT queries on an existing reporting database to list open incidents
`;

const FABRICATED = [
  'Kubernetes',
  'Salesforce',
  'PhD',
  'increased revenue by 40%',
  'led a team of 12',
  'AWS Solutions Architect',
];

const SCENARIOS = [
  {
    id: 'it-support',
    company: 'Lakeside Health',
    jobTitle: 'IT Support Officer',
    jd: `IT Support Officer — Lakeside Health, Melbourne

Essential
- Frontline helpdesk for hospital staff
- Microsoft 365, Windows 11, and Active Directory account resets
- Log and resolve incidents in a service desk queue

Desirable
- ITIL familiarity
- Patient-facing communication

Do not mention software product development as the core of this role.`,
    mustAppearInPrompt: ['Active Directory', 'Microsoft 365', 'ITIL', 'helpdesk'],
    letterFocus: ['tickets', 'Active Directory', 'Harbor Civic', 'Microsoft 365'],
    avoidFocus: ['React forms', 'unit tests', 'SQL SELECT'],
  },
  {
    id: 'junior-dev',
    company: 'Cedar Apps',
    jobTitle: 'Junior Software Developer',
    jd: `Junior Software Developer — Cedar Apps

Essential
- Build and maintain TypeScript APIs
- React UI work for internal tools
- Automated unit tests for common paths

Desirable
- Experience with request-tracker style products

This is a software engineering role, not a service desk role.`,
    mustAppearInPrompt: ['TypeScript', 'React', 'unit tests', 'software engineering'],
    letterFocus: ['TypeScript', 'React', 'Northwind Labs', 'unit tests'],
    avoidFocus: ['Active Directory password resets', 'Excel workbooks', 'hospital staff'],
  },
  {
    id: 'data-analyst',
    company: 'Riverbank Insights',
    jobTitle: 'Data Analyst',
    jd: `Data Analyst — Riverbank Insights

Essential
- Weekly Excel reporting for operations
- SQL SELECT queries against an existing reporting database
- Clear written summaries of open-incident volumes

Desirable
- Comfort explaining numbers to non-technical leads

This is an analysis role. Do not treat it as a helpdesk or product-engineering job.`,
    mustAppearInPrompt: ['Excel', 'SQL SELECT', 'reporting database', 'analysis role'],
    letterFocus: ['Excel', 'SQL', 'Harbor Civic', 'ticket volumes'],
    avoidFocus: ['React forms', 'Active Directory password resets', 'unit tests'],
  },
];

function padToTarget(paragraphs) {
  const extra = [
    'I kept the examples close to the work already on my CV rather than stretching into tools I have not used.',
    'That habit matters when a team needs someone who can start from real tickets, code, or reports instead of a generic pitch.',
    'I am happy to walk through those examples in more detail if useful.',
    'The same record-keeping that helped colleagues at Harbor Civic and Northwind Labs is what I would bring to this team.',
    'I prefer to be precise about what I have done and what I would still need to learn on the job.',
  ];
  const parts = [...paragraphs];
  let text = parts.join('\n\n');
  let i = 0;
  while (text.split(/\s+/).filter(Boolean).length < COVER_LETTER_TARGET_WORDS.min && i < 20) {
    parts.push(extra[i % extra.length]);
    text = parts.join('\n\n');
    i += 1;
  }
  return text;
}

function mockLetter(scenario) {
  const { company, jobTitle, id } = scenario;
  const byRole = {
    'it-support': [
      `Dear Hiring Manager,`,
      `I am applying for the ${jobTitle} role at ${company} after working as a Service Desk Analyst at Harbor Civic, where the daily work was frontline support rather than product delivery.`,
      `At Harbor Civic I resolved 20–30 tickets a day for Windows 11, Microsoft 365, and Active Directory password resets, and I guided staff through VPN and printer issues by phone and remote desktop. I logged incidents in a service desk queue and followed ITIL-style priorities, which matches the essential helpdesk work in this description.`,
      `For a hospital team that needs calm account and device support, I can take ownership of the queue, keep notes accurate, and explain fixes without overstating tools I have not used.`,
      `I would welcome the chance to discuss how that support work maps to Lakeside Health. Kind regards,`,
    ],
    'junior-dev': [
      `Dear Hiring Manager,`,
      `I am applying for the ${jobTitle} role at ${company} because my recent work at Northwind Labs was building software, not answering a service desk queue.`,
      `At Northwind Labs I built TypeScript APIs for an internal request tracker, wrote React forms for ticket intake, and covered unit tests for the most common request paths. Those are the 2–3 pieces of evidence that match this JD, and I am not claiming a broader engineering stack than that.`,
      `I can help a small product team ship internal tools by staying close to TypeScript, React, and tests, and by being honest about the edges of that experience.`,
      `I would like to talk about how that request-tracker work could help Cedar Apps. Kind regards,`,
    ],
    'data-analyst': [
      `Dear Hiring Manager,`,
      `I am applying for the ${jobTitle} role at ${company} after preparing operations reports at Harbor Civic, which is the closest match on my CV to this analysis brief.`,
      `As a Reporting Assistant I prepared weekly Excel workbooks of ticket volumes for the operations lead and used SQL SELECT queries on an existing reporting database to list open incidents. I have not built dashboards or statistical models, so I am not claiming those skills here.`,
      `I can help Riverbank Insights keep weekly numbers reliable and explain open-incident volumes in plain language, using only the Excel and SQL work I have already done.`,
      `I would welcome a conversation about that reporting work. Kind regards,`,
    ],
  };
  return padToTarget(byRole[id]);
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

test('cover letter prompt asks for JD analysis, matching, and non-template style', () => {
  const prompt = buildCoverLetterPrompt({
    cvMd: QUALITY_CV,
    jd: SCENARIOS[0].jd,
    company: SCENARIOS[0].company,
    jobTitle: SCENARIOS[0].jobTitle,
  });
  assert.match(prompt, /JD Requirement → CV Evidence → Cover Letter Content/);
  assert.match(prompt, /Essential versus desirable/);
  assert.match(prompt, /Never invent metrics/);
  assert.match(prompt, /Do not emit Markdown headings/);
  assert.match(prompt, /If the JD gives only a company name, do not invent praise/);
  assert.match(prompt, /250–350 English words/);
  assert.match(prompt, /Do not pad to hit the word count/);
  assert.match(prompt, /Level A — Professional Experience/);
  assert.match(prompt, /Level D — Transferable Skill/);
  assert.match(prompt, /Level E — Unsupported/);
  for (const phrase of COVER_LETTER_CLICHE_PHRASES) {
    assert.match(prompt, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('three different JDs keep distinct requirements in one cover-letter prompt each', () => {
  const prompts = SCENARIOS.map((scenario) => buildCoverLetterPrompt({
    cvMd: QUALITY_CV,
    jd: scenario.jd,
    company: scenario.company,
    jobTitle: scenario.jobTitle,
  }));

  for (const [index, scenario] of SCENARIOS.entries()) {
    const prompt = prompts[index];
    assert.match(prompt, new RegExp(scenario.company));
    assert.match(prompt, new RegExp(scenario.jobTitle));
    for (const term of scenario.mustAppearInPrompt) {
      assert.match(prompt, new RegExp(term));
    }
  }

  assert.notEqual(prompts[0], prompts[1]);
  assert.notEqual(prompts[1], prompts[2]);
  assert.match(prompts[0], /Lakeside Health/);
  assert.doesNotMatch(prompts[0], /Cedar Apps/);
  assert.doesNotMatch(prompts[0], /Riverbank Insights/);
  assert.match(prompts[1], /TypeScript APIs/);
  assert.doesNotMatch(prompts[1], /Lakeside Health/);
  assert.doesNotMatch(prompts[1], /Riverbank Insights/);
  assert.match(prompts[2], /analysis role/);
  assert.doesNotMatch(prompts[2], /Lakeside Health/);
  assert.doesNotMatch(prompts[2], /Cedar Apps/);
});

test('mock cover letters for three roles stay evidence-safe and differently focused', async () => {
  const letters = [];

  for (const scenario of SCENARIOS) {
    let calls = 0;
    const result = await generateCoverLetterDocument({
      jd: scenario.jd,
      company: scenario.company,
      jobTitle: scenario.jobTitle,
      cvMd: QUALITY_CV,
      profileMd: '',
    }, {
      callLLM: async (prompt, opts = {}) => {
        calls += 1;
        assert.equal(opts.responseSchema, COVER_LETTER_RESPONSE_JSON_SCHEMA);
        assert.match(prompt, /JD Requirement → CV Evidence → Cover Letter Content/);
        assert.match(prompt, new RegExp(scenario.company));
        assert.match(prompt, new RegExp(scenario.jobTitle));
        assert.match(prompt, /Harbor Civic/);
        assert.match(prompt, /Northwind Labs/);
        return { body: mockLetter(scenario) };
      },
    });

    assert.equal(calls, 1);
    assert.equal(parseFrontMatter(result.markdown).name, 'Jordan Avery');
    assert.match(result.body, new RegExp(scenario.company));
    assert.match(result.body, new RegExp(scenario.jobTitle));
    assert.doesNotMatch(result.body, /## Opening|## Experience|## Closing/);

    const words = countWords(result.body);
    assert.ok(words >= COVER_LETTER_TARGET_WORDS.min, `${scenario.id} should reach ${COVER_LETTER_TARGET_WORDS.min} words, got ${words}`);
    assert.ok(words <= COVER_LETTER_TARGET_WORDS.max + 40, `${scenario.id} should stay near one page, got ${words}`);

    for (const phrase of COVER_LETTER_CLICHE_PHRASES) {
      assert.doesNotMatch(result.body, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
    for (const term of scenario.letterFocus) {
      assert.match(result.body, new RegExp(term));
    }
    for (const term of scenario.avoidFocus) {
      assert.doesNotMatch(result.body, new RegExp(term));
    }
    for (const term of FABRICATED) {
      assert.doesNotMatch(result.body, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }

    letters.push(result.body);
  }

  assert.notEqual(letters[0], letters[1]);
  assert.notEqual(letters[1], letters[2]);
  assert.match(letters[0], /Service Desk Analyst/);
  assert.match(letters[1], /Northwind Labs/);
  assert.match(letters[2], /Reporting Assistant/);
});
