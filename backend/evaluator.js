'use strict';

const fs   = require('fs');
const path = require('path');
const { callLLM } = require('./tailor');

const PROMPTS_DIR  = path.join(__dirname, '../prompts');
const CV_MD        = path.join(__dirname, '../user/cv.md');
const PROFILE_MD   = path.join(__dirname, '../user/profile.md');

async function evaluateApplication({ jd }) {
  const shared   = fs.readFileSync(path.join(PROMPTS_DIR, '_shared.md'), 'utf8');
  const profile  = fs.existsSync(PROFILE_MD) ? fs.readFileSync(PROFILE_MD, 'utf8') : '';
  const evaluate = fs.readFileSync(path.join(PROMPTS_DIR, 'evaluate.md'), 'utf8');
  const cvMd     = fs.existsSync(CV_MD) ? fs.readFileSync(CV_MD, 'utf8') : '';

  const prompt = [shared, profile, evaluate]
    .join('\n\n---\n\n')
    .replace('{{CV}}', cvMd)
    .replace('{{JD}}', jd);

  const result = await callLLM(prompt);

  if (typeof result.eval_score !== 'number')      throw new Error('Invalid response: expected number for eval_score');
  if (typeof result.recommendation !== 'string')  throw new Error('Invalid response: expected string for recommendation');
  if (typeof result.archetype !== 'string')       throw new Error('Invalid response: expected string for archetype');

  return {
    eval_score:          Math.max(0, Math.min(100, result.eval_score)),
    eval_recommendation: result.recommendation,
    eval_archetype:      result.archetype,
    eval_review:         JSON.stringify({
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      gaps:      Array.isArray(result.gaps)      ? result.gaps      : [],
      actions:   Array.isArray(result.actions)   ? result.actions   : [],
      summary:   typeof result.summary === 'string' ? result.summary : '',
    }),
  };
}

module.exports = { evaluateApplication };
