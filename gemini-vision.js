const fetch = require('node-fetch');

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const prompts = require('./data/vision_prompts.json');

const STANDARD_MODE = 'ai-detection';
const VALID_MODES = new Set(Object.keys(prompts));

function parseGeminiJson(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    return JSON.parse(rawText.replace(/```json|```/g, '').trim());
  }
}

async function requestImageAnalysis(file, apiKey, prompt) {
  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: file.mimetype, data: file.buffer.toString('base64') } },
          { text: prompt }
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

  return parseGeminiJson(rawText);
}

async function analyzeImageWithGemini(file, apiKey, mode = STANDARD_MODE, caption = '') {
  const requestedMode = VALID_MODES.has(mode) ? mode : STANDARD_MODE;
  let prompt = prompts[requestedMode];
  if (requestedMode === 'context-check' && caption.trim()) {
    prompt += `\n\nThe user supplied this claimed caption or context: "${caption.trim()}"`;
  }

  try {
    return { mode: requestedMode, result: await requestImageAnalysis(file, apiKey, prompt) };
  } catch (error) {
    if (requestedMode !== 'explain') throw error;
    return { mode: STANDARD_MODE, result: await requestImageAnalysis(file, apiKey, prompts[STANDARD_MODE]) };
  }
}

module.exports = { analyzeImageWithGemini, VALID_MODES };
