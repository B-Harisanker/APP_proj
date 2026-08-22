require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const { heuristicScore } = require('./heuristics');
const { analyzeWithGemini } = require('./gemini');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB cap
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PASS_THRESHOLD = 30; // % - below this, resume "passes" (per your spec)

/**
 * Extracts plain text from an uploaded resume file buffer based on mimetype.
 */
async function extractText(file) {
  const { mimetype, buffer, originalname } = file;

  if (mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf')) {
    const result = await pdfParse(buffer);
    return result.text;
  }

  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    originalname.toLowerCase().endsWith('.docx')
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimetype === 'text/plain' || originalname.toLowerCase().endsWith('.txt')) {
    return buffer.toString('utf-8');
  }

  throw new Error('Unsupported file type. Please upload a PDF, DOCX, or TXT file.');
}

/**
 * Combines heuristic score and Gemini score into a final weighted percentage.
 * Gemini gets more weight since it reasons over full context; heuristics
 * act as a grounding/sanity-check signal and provide explainability.
 */
function combineScores(heuristic, gemini) {
  const HEURISTIC_WEIGHT = 0.35;
  const GEMINI_WEIGHT = 0.65;
  const final = heuristic.score * HEURISTIC_WEIGHT + gemini.ai_probability_percent * GEMINI_WEIGHT;
  return Math.round(final);
}

app.post('/analyze', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const text = await extractText(req.file);

    if (!text || text.trim().split(/\s+/).length < 30) {
      return res.status(400).json({
        error: 'Could not extract enough readable text from this file. Try a different format or a text-based (not scanned/image) resume.'
      });
    }

    const heuristic = heuristicScore(text);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server misconfigured: GEMINI_API_KEY missing.' });
    }

    const gemini = await analyzeWithGemini(text, apiKey);

    const finalScore = combineScores(heuristic, gemini);
    const passed = finalScore < PASS_THRESHOLD;

    let verdictMessage;
    if (!passed) {
      verdictMessage = 'This resume shows strong indicators of AI-generated or AI-heavily-edited content.';
    } else if (heuristic.evidence.buzzwordHits.length > 0 || gemini.ai_probability_percent >= 15) {
      verdictMessage = 'This resume passes, but shows some signs it may have been enhanced or polished using AI tools.';
    } else {
      verdictMessage = 'This resume shows no significant indicators of AI generation.';
    }

    res.json({
      finalScore,
      passed,
      threshold: PASS_THRESHOLD,
      verdictMessage,
      breakdown: {
        heuristicScore: heuristic.score,
        geminiScore: gemini.ai_probability_percent,
        geminiConfidence: gemini.confidence,
        geminiReasoning: gemini.reasoning,
        flaggedSnippets: gemini.flagged_snippets,
        buzzwordsFound: heuristic.evidence.buzzwordHits,
        clichesFound: heuristic.evidence.clicheHits,
        structuralFlags: heuristic.evidence.structuralHits,
        wordCount: heuristic.evidence.wordCount
      },
      disclaimer: 'AI-text detection is inherently probabilistic. This score reflects pattern-based indicators, not a definitive determination.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Analysis failed.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Resume AI Detector running on http://localhost:${PORT}`));