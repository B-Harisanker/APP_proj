const fetch = require('node-fetch');

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function buildImagePrompt() {
  return `You are an image forensics analyst. Estimate whether this image was generated or materially created by an AI image generator.

Inspect the image systematically for these artifact categories:
1. Lighting and shadows: check whether light direction, reflections, contact shadows, and cast shadows agree.
2. Textures and patterns: check for unnaturally regular repetition, melted detail, inconsistent materials, or overly smooth microtexture.
3. Anatomy and objects: check hands, fingers, faces, eyes, teeth, limbs, object geometry, and physical intersections for inconsistencies.
4. Background text and symbols: check signs, labels, logos, and writing for distorted, invented, or inconsistent characters.
5. Global rendering: check edges, depth of field, perspective, fine detail, and whether the image has suspiciously uniform polish.

Be conservative. A polished photograph is not automatically AI-generated, and compression or editing artifacts are not proof. Reserve high scores for multiple compounding signals. No vision model is reliable against the newest AI image generators, so state uncertainty when evidence is weak.

Return ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "ai_likelihood_percent": <integer 0-100>,
  "verdict_label": "Likely AI-generated" or "Likely real" or "Inconclusive",
  "reasoning": "<2-4 sentence explanation citing visible evidence>",
  "flagged_artifacts": ["<short artifact finding>", "<short artifact finding>"]
}`;
}

async function analyzeImageWithGemini(file, apiKey) {
  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: file.mimetype, data: file.buffer.toString('base64') } },
          { text: buildImagePrompt() }
        ]
      }],
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
  if (!rawText) throw new Error('Gemini returned no usable content.');

  try {
    return JSON.parse(rawText);
  } catch (error) {
    return JSON.parse(rawText.replace(/```json|```/g, '').trim());
  }
}

module.exports = { analyzeImageWithGemini };
