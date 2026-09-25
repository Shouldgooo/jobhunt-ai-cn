'use strict';

/**
 * Prevent concurrent generation for the same JD + template + cover-letter flag.
 * In-memory only (single backend process).
 */
const inFlight = new Set();

function generationKey({ jd, resume_template_id, generate_cover_letter }) {
  const jdNorm = String(jd || '').trim();
  return `${resume_template_id || 0}::${generate_cover_letter ? 1 : 0}::${jdNorm}`;
}

function tryStartGeneration(key) {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

function finishGeneration(key) {
  inFlight.delete(key);
}

function isGenerating(key) {
  return inFlight.has(key);
}

/** Frontend-equivalent single-flight latch (also used in tests). */
function createGenerationLock() {
  let busy = false;
  return {
    tryStart() {
      if (busy) return false;
      busy = true;
      return true;
    },
    finish() { busy = false; },
    isBusy() { return busy; },
  };
}

module.exports = {
  generationKey,
  tryStartGeneration,
  finishGeneration,
  isGenerating,
  createGenerationLock,
};
