// controllers/aiController.js
// AI features for "Nerd Out":
//   1. askTutor          -> textbook-grounded (RAG) tutor chat  (POST /ai/tutor)
//   2. getRecommendations-> personalized study suggestions       (GET /ai/recommendations)
//
// All Gemini calls happen here on the backend; the API key never leaves it.
const { Type } = require('@google/genai');
const { ai, MODELS, hasApiKey } = require('../config/geminiClient');
const supabase = require('../config/supabaseClient');

const MAX_MESSAGES = 40; // cap conversation length sent to the model
const MAX_CONTENT_CHARS = 4000; // cap each message length
const RETRIEVE_K = 5; // textbook chunks pulled per question

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Map an SDK/network error to an HTTP response. Rate-limit / overload -> 503.
function handleAiError(res, err, label) {
  const status = err?.status || err?.response?.status;
  const msg = String(err?.message || err);
  console.error(`[aiController] ${label} error:`, msg);
  if (status === 429 || status === 503 || /rate|quota|overload/i.test(msg)) {
    res.set('Retry-After', '30');
    return res.status(503).json({ error: 'The AI is busy right now. Please try again in a moment.' });
  }
  return res.status(500).json({ error: 'Something went wrong talking to the AI.' });
}

// Strip ```json fences and parse; returns null on failure.
function safeParseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // last resort: grab the first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

// Embed a single string with the Gemini embedding model.
async function embedText(text, taskType) {
  const result = await ai.models.embedContent({
    model: MODELS.embedding,
    contents: text,
    config: {
      outputDimensionality: MODELS.embeddingDimensions,
      taskType, // 'RETRIEVAL_QUERY' for questions, 'RETRIEVAL_DOCUMENT' for ingestion
    },
  });
  return result.embeddings[0].values;
}

// ---------------------------------------------------------------------------
// 1. AI Tutor — textbook-grounded RAG chat
// ---------------------------------------------------------------------------
exports.askTutor = async (req, res) => {
  if (!hasApiKey) {
    return res.status(503).json({ error: 'AI is not configured on the server.' });
  }

  const { messages, subjectId, context } = req.body || {};

  // ---- validate the conversation ----
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array.' });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: `Conversation too long (max ${MAX_MESSAGES} messages).` });
  }
  const roleOk = (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
  if (!messages.every(roleOk)) {
    return res.status(400).json({ error: "Each message needs a role ('user'|'assistant') and string content." });
  }
  if (messages[0].role !== 'user') {
    return res.status(400).json({ error: 'The first message must be from the user.' });
  }

  try {
    // ---- 1. figure out what to search for ----
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const questionForRetrieval = [
      context?.questionText ? `Question: ${context.questionText}` : '',
      lastUser?.content || '',
    ].filter(Boolean).join('\n').slice(0, MAX_CONTENT_CHARS);

    // Resolve the subject from the chapter when the client didn't send one
    // (the quiz "Explain this" flow only knows the chapterId).
    let effectiveSubjectId = subjectId || null;
    if (!effectiveSubjectId && context?.chapterId) {
      const { data: chapter } = await supabase
        .from('chapters')
        .select('subject_id')
        .eq('id', context.chapterId)
        .single();
      if (chapter?.subject_id) effectiveSubjectId = chapter.subject_id;
    }

    // ---- 2. embed + retrieve relevant textbook chunks ----
    let chunks = [];
    try {
      const queryEmbedding = await embedText(questionForRetrieval, 'RETRIEVAL_QUERY');
      const { data, error } = await supabase.rpc('match_textbook_chunks', {
        query_embedding: queryEmbedding,
        match_subject_id: effectiveSubjectId,
        match_count: RETRIEVE_K,
      });
      if (error) {
        console.error('[aiController] match_textbook_chunks error:', error.message);
      } else {
        chunks = data || [];
      }
    } catch (retrievalErr) {
      // Retrieval failure shouldn't kill the chat — fall back to no context.
      console.error('[aiController] retrieval failed:', retrievalErr.message);
    }

    // ---- 3. build the grounding system instruction ----
    const excerpts = chunks
      .map((c, i) => `[[${i + 1}]] (Source: ${c.title}${c.page != null ? `, p.${c.page}` : ''})\n${c.content}`)
      .join('\n\n');

    const systemInstruction = buildTutorSystem(excerpts, context, Boolean(chunks.length));

    // ---- 4. call Gemma (via the Gemini API) ----
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content.slice(0, MAX_CONTENT_CHARS) }],
    }));

    const response = await ai.models.generateContent({
      model: MODELS.generation,
      contents,
      config: {
        systemInstruction,
        maxOutputTokens: 1024,
        temperature: 0.4,
      },
    });

    const reply = (response.text || '').trim() ||
      "Sorry, I couldn't come up with an answer. Try rephrasing your question.";

    // ---- 5. return reply + de-duplicated sources ----
    const seen = new Set();
    const sources = [];
    for (const c of chunks) {
      const key = `${c.title}::${c.page}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push({ title: c.title, page: c.page });
      }
    }

    return res.status(200).json({ reply, sources });
  } catch (err) {
    return handleAiError(res, err, 'askTutor');
  }
};

function buildTutorSystem(excerpts, context, hasExcerpts) {
  const persona =
    'You are "Ask Nerd", a friendly, encouraging tutor inside an exam-prep app. ' +
    'You help students understand academic and exam topics. Explain step by step, ' +
    'in clear plain language, teaching the concept rather than just giving the answer. ' +
    'Keep replies focused and reasonably short. If a question is not about studying or ' +
    'the subject material, gently steer the student back to their studies.';

  const grounding = hasExcerpts
    ? 'Answer the student USING ONLY the textbook excerpts below. ' +
      'When you use a fact, mention where it comes from (e.g. "According to your textbook..."). ' +
      'If the excerpts do not contain the answer, say the topic is not covered in the ' +
      'available textbook material and suggest what the student could review instead. ' +
      'Do not invent facts that are not in the excerpts.\n\n--- TEXTBOOK EXCERPTS ---\n' + excerpts
    : 'No textbook excerpts were found for this question. Tell the student the topic ' +
      "doesn't appear in the available textbook material, then give a brief, careful, " +
      'general explanation and suggest they double-check with their textbook.';

  const questionCtx = context?.questionText
    ? `\n\n--- QUIZ QUESTION THE STUDENT IS ASKING ABOUT ---\n` +
      `Question: ${context.questionText}\n` +
      (Array.isArray(context.options) ? `Options: ${context.options.join(' | ')}\n` : '') +
      (context.correctAnswer != null ? `Correct answer: ${context.correctAnswer}\n` : '') +
      (context.userAnswer != null ? `Student's answer: ${context.userAnswer}\n` : '') +
      (context.explanation ? `Existing explanation: ${context.explanation}\n` : '')
    : '';

  return `${persona}\n\n${grounding}${questionCtx}`;
}

// ---------------------------------------------------------------------------
// 2. Study recommendations — weak-area analysis from existing progress data
// ---------------------------------------------------------------------------
exports.getRecommendations = async (req, res) => {
  if (!hasApiKey) {
    return res.status(503).json({ error: 'AI is not configured on the server.' });
  }

  try {
    const userId = req.user.id;

    // Pull the student's per-question progress with chapter + subject names.
    const { data: rows, error } = await supabase
      .from('progress')
      .select('is_correct, chapter_id, chapters(name, subjects(name))')
      .eq('user_id', userId);

    if (error) throw error;

    // Aggregate accuracy per chapter.
    const byChapter = new Map();
    for (const r of rows || []) {
      const key = r.chapter_id;
      if (!byChapter.has(key)) {
        byChapter.set(key, {
          chapter: r.chapters?.name || 'Unknown chapter',
          subject: r.chapters?.subjects?.name || 'General',
          attempted: 0,
          correct: 0,
        });
      }
      const agg = byChapter.get(key);
      agg.attempted += 1;
      if (r.is_correct) agg.correct += 1;
    }

    const weak = [...byChapter.values()]
      .filter((c) => c.attempted >= 3)
      .map((c) => ({ ...c, accuracyPct: Math.round((c.correct / c.attempted) * 100) }))
      .sort((a, b) => a.accuracyPct - b.accuracyPct)
      .slice(0, 5);

    // Not enough data yet -> friendly default, no model call.
    if (weak.length === 0) {
      return res.status(200).json({
        summary: 'Keep practicing! Once you\'ve answered a few more quizzes, I\'ll point you to the topics worth reviewing.',
        recommendations: [],
      });
    }

    const summaryLines = weak
      .map((c) => `- ${c.subject} / ${c.chapter}: ${c.accuracyPct}% correct (${c.correct}/${c.attempted})`)
      .join('\n');

    const prompt =
      'A student has these weakest exam-prep chapters (lowest accuracy first):\n\n' +
      summaryLines +
      '\n\nWrite a short, encouraging study plan. Return JSON with a one-sentence ' +
      '"summary" and a "recommendations" array (one item per chapter above) where each ' +
      'item has: chapter, subject, a short "reason" (why to review it), and a concrete ' +
      '"action" (what to do). Keep it motivating and specific.';

    const recSchema = {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        recommendations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              chapter: { type: Type.STRING },
              subject: { type: Type.STRING },
              reason: { type: Type.STRING },
              action: { type: Type.STRING },
            },
            required: ['chapter', 'subject', 'reason', 'action'],
          },
        },
      },
      required: ['summary', 'recommendations'],
    };

    const response = await ai.models.generateContent({
      model: MODELS.generation,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: recSchema,
        maxOutputTokens: 1024,
        temperature: 0.5,
      },
    });

    const parsed = safeParseJson(response.text);
    if (parsed && Array.isArray(parsed.recommendations)) {
      return res.status(200).json(parsed);
    }

    // Model returned something unparseable -> fall back to the computed data.
    return res.status(200).json({
      summary: 'Here are the topics where you have the most room to improve.',
      recommendations: weak.map((c) => ({
        chapter: c.chapter,
        subject: c.subject,
        reason: `You're at ${c.accuracyPct}% on this chapter.`,
        action: 'Review this chapter and retake its quiz.',
      })),
    });
  } catch (err) {
    return handleAiError(res, err, 'getRecommendations');
  }
};
