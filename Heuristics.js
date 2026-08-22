const signals = require('./data/ai_signals.json');

/**
 * Splits text into sentences (rough but good enough for resumes/bullets).
 */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Counts buzzword/cliche hits, case-insensitive, whole-phrase matching.
 */
function countPhraseHits(text, phraseList) {
  const lower = text.toLowerCase();
  const found = [];
  let hits = 0;
  for (const phrase of phraseList) {
    const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = lower.match(regex);
    if (matches) {
      hits += matches.length;
      found.push({ phrase, count: matches.length });
    }
  }
  return { hits, found };
}

/**
 * Structural pattern matching (regex-based bullet-opener detection etc.)
 */
function countStructuralHits(text) {
  let hits = 0;
  const matchedPatterns = [];
  for (const pattern of signals.structural_flags.patterns) {
    const regex = new RegExp(pattern, 'gim');
    const matches = text.match(regex);
    if (matches) {
      hits += matches.length;
      matchedPatterns.push({ pattern, count: matches.length });
    }
  }
  return { hits, matchedPatterns };
}

/**
 * Burstiness / sentence-length variance check.
 * Human writing tends to vary sentence length more; AI text is often
 * suspiciously uniform. Low variance => higher AI-likelihood signal.
 * This is a heuristic proxy, not a proven detector on its own.
 */
function sentenceLengthVariance(text) {
  const sentences = splitSentences(text);
  if (sentences.length < 4) return { variance: null, avgLen: null, sentenceCount: sentences.length };
  const lengths = sentences.map(s => s.split(/\s+/).length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length;
  return { variance, avgLen: avg, sentenceCount: sentences.length };
}

/**
 * Master heuristic scorer.
 * Returns a 0-100 score representing heuristic-only AI likelihood,
 * plus the evidence used, so the frontend can display *why*.
 */
function heuristicScore(text) {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const buzz = countPhraseHits(text, signals.buzzwords);
  const cliche = countPhraseHits(text, signals.cliche_openers);
  const structural = countStructuralHits(text);
  const variance = sentenceLengthVariance(text);

  // Normalize buzzword density per 100 words (resumes are short, so we
  // need density, not raw count).
  const density = wordCount > 0 ? (buzz.hits / wordCount) * 100 : 0;

  // Weighted scoring - tuned heuristically, not scientifically derived.
  // Document this honestly in your report: these weights are your own
  // design choice, tunable based on testing against sample resumes.
  let score = 0;
  score += Math.min(density * 12, 45);        // buzzword density, capped
  score += Math.min(cliche.hits * 8, 20);      // cliche opener hits, capped
  score += Math.min(structural.hits * 5, 20);  // structural pattern hits, capped

  // Low sentence-length variance is a mild additional signal.
  if (variance.variance !== null && variance.variance < 3 && variance.sentenceCount >= 6) {
    score += 15;
  }

  score = Math.min(Math.round(score), 100);

  return {
    score,
    evidence: {
      wordCount,
      buzzwordHits: buzz.found,
      clicheHits: cliche.found,
      structuralHits: structural.matchedPatterns,
      sentenceLengthVariance: variance
    }
  };
}

module.exports = { heuristicScore, splitSentences };