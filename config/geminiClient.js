// config/geminiClient.js
// Shared Google Gemini client. Mirrors config/supabaseClient.js.
// The API key lives ONLY on the backend (never in the mobile app).
const { GoogleGenAI } = require('@google/genai');

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  // Don't crash the server — the non-AI routes should still work.
  // The AI controller returns a 503 when the key is missing.
  console.warn(
    '[geminiClient] GEMINI_API_KEY is not set. AI endpoints will return 503 until it is configured.'
  );
}

const ai = new GoogleGenAI({ apiKey });

// Model IDs (override via env without a code change).
// Generation uses Gemma 4 26B served on the Gemini API; embeddings must use a
// dedicated Gemini embedding model (Gemma cannot produce embeddings).
const MODELS = {
  generation: process.env.AI_TUTOR_MODEL || 'gemma-4-26b-a4b-it',
  embedding: process.env.AI_EMBEDDING_MODEL || 'gemini-embedding-001',
  embeddingDimensions: 768,
};

module.exports = { ai, MODELS, hasApiKey: Boolean(apiKey) };
