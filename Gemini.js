const fetch = require('node-fetch');

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Builds the analysis prompt. We ask Gemini to reason like a linguistic
 * forensics expert, not just gut-check "does this sound like AI". We force
 * strict JSON output so the backend can parse it reliably.
 */
function buildPrompt(resumeText) {
  return `You are a linguistic forensics expert specializing in detecting AI-generated
or AI-heavily-edited text in professional documents like resumes.

Analyze the resume text below and evaluate it across these dimensions:
1. Genericness: Are achievements described in vague, inflated corporate-buzzword
   language rather than specific, verifiable detail?
2. Uniformity: Is sentence/bullet structure suspiciously repetitive in rhythm
   and construction (e.g., every bullet starts "Verb + object + quantifiable %")?
3. Tone consistency: Does phrasing sound like natural human self-description,
   including minor awkwardness/inconsistency, or overly polished and uniform?
4. Specificity of detail: Real resumes usually contain oddly specific,
   non-generic details (tool names, exact numbers, proper nouns, quirks).
   Absence of any such specificity is a mild AI signal.
5. Known LLM tics: overuse of words like "leverage", "spearheaded", "seamless",
   "robust", "dynamic", "delve", "moreover/furthermore" as connectors, or
   resume summaries that read like marketing copy.

Be calibrated and conservative: many humans genuinely write in polished,
buzzword-heavy corporate style, especially non-native English speakers or
people who used templates. Do not assume AI just because writing is
grammatically perfect. Reserve high scores (>70) for text with multiple
strong, compounding signals across the dimensions above.

Return ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{
  "ai_probability_percent": <integer 0-100>,
  "confidence": "<low|medium|high>",
  "reasoning": "<2-4 sentence explanation citing specific phrases or patterns from the text>",
  "flagged_snippets": ["<short exact quotes from the text that most influenced the score, max 5>"]
}

Resume text to analyze:
"""
${resumeText}
"""`;
}

/*
   Calls Gemini and returns the parsed verdict object.
 */
async function analyzeWithGemini(resumeText, apiKey) {
  const prompt = buildPrompt(resumeText);

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini returned no usable content.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    // Fallback: strip stray fences just in case, then retry parse once.
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  }

  return parsed;
}

module.exports = { analyzeWithGemini };