// scripts/ingestTextbook.js
// One-time / admin ingestion of a text-based PDF textbook into Supabase for the
// "Ask Nerd" RAG tutor. Extracts text page-by-page, chunks it, embeds each chunk
// with Gemini (gemini-embedding-001, 768-dim), and stores it in textbook_chunks.
//
// Usage (run from the elearning-backend folder, with .env populated):
//   node scripts/ingestTextbook.js <path-to.pdf> <subjectId> "<Textbook title>"
//
// Re-running with the same title + subject replaces the previous copy (idempotent).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const supabase = require('../config/supabaseClient');
const { ai, MODELS } = require('../config/geminiClient');

const TARGET_CHARS = 3000; // ~800 tokens per chunk
const OVERLAP_CHARS = 300; // overlap when splitting a long page
const EMBED_BATCH = 100; // contents per embedContent call
const INSERT_BATCH = 200; // rows per Supabase insert

async function extractPages(buffer) {
  const pages = [];
  await pdf(buffer, {
    // Called once per page; capture the page text and preserve order.
    pagerender: (pageData) =>
      pageData.getTextContent().then((tc) => {
        const text = tc.items.map((it) => it.str).join(' ');
        pages.push(text);
        return text;
      }),
  });
  return pages;
}

function chunkPages(pages) {
  const chunks = [];
  pages.forEach((raw, idx) => {
    const pageNum = idx + 1;
    const clean = (raw || '').replace(/\s+/g, ' ').trim();
    if (clean.length < 20) return; // skip near-empty pages
    if (clean.length <= TARGET_CHARS) {
      chunks.push({ content: clean, page: pageNum });
    } else {
      const step = TARGET_CHARS - OVERLAP_CHARS;
      for (let i = 0; i < clean.length; i += step) {
        chunks.push({ content: clean.slice(i, i + TARGET_CHARS), page: pageNum });
      }
    }
  });
  return chunks;
}

async function embedBatch(texts) {
  const result = await ai.models.embedContent({
    model: MODELS.embedding,
    contents: texts,
    config: {
      outputDimensionality: MODELS.embeddingDimensions,
      taskType: 'RETRIEVAL_DOCUMENT',
    },
  });
  return result.embeddings.map((e) => e.values);
}

async function main() {
  const [, , pdfPath, subjectId, ...titleParts] = process.argv;
  const title = titleParts.join(' ').trim();

  if (!pdfPath || !subjectId || !title) {
    console.error('Usage: node scripts/ingestTextbook.js <path-to.pdf> <subjectId> "<Textbook title>"');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set (check your .env).');
    process.exit(1);
  }
  if (!fs.existsSync(pdfPath)) {
    console.error(`File not found: ${path.resolve(pdfPath)}`);
    process.exit(1);
  }

  console.log(`Reading ${pdfPath} ...`);
  const buffer = fs.readFileSync(pdfPath);
  const pages = await extractPages(buffer);
  console.log(`Extracted ${pages.length} pages.`);

  const chunks = chunkPages(pages);
  if (chunks.length === 0) {
    console.error('No extractable text found. Is this a scanned/image PDF? Those need OCR.');
    process.exit(1);
  }
  console.log(`Prepared ${chunks.length} chunks.`);

  // Idempotency: remove a previous copy of this title+subject (cascade drops its chunks).
  const { data: existing } = await supabase
    .from('textbooks')
    .select('id')
    .eq('title', title)
    .eq('subject_id', subjectId);
  if (existing && existing.length) {
    const ids = existing.map((t) => t.id);
    await supabase.from('textbooks').delete().in('id', ids);
    console.log(`Removed ${ids.length} previous copy/copies of "${title}".`);
  }

  // Create the textbook row.
  const { data: book, error: bookErr } = await supabase
    .from('textbooks')
    .insert({ title, subject_id: subjectId })
    .select()
    .single();
  if (bookErr) {
    console.error('Failed to create textbook row:', bookErr.message);
    process.exit(1);
  }

  // Embed + insert in batches.
  let inserted = 0;
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const { error } = await supabase.from('textbook_chunks').insert(pending);
    if (error) {
      console.error('Insert error:', error.message);
      process.exit(1);
    }
    inserted += pending.length;
    console.log(`  inserted ${inserted}/${chunks.length}`);
    pending = [];
  };

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(batch.map((c) => c.content));
    batch.forEach((c, j) => {
      pending.push({
        textbook_id: book.id,
        subject_id: subjectId,
        content: c.content,
        page: c.page,
        embedding: vectors[j],
      });
    });
    if (pending.length >= INSERT_BATCH) await flush();
    // gentle pacing to respect embedding rate limits
    await new Promise((r) => setTimeout(r, 250));
  }
  await flush();

  console.log(`\nDone. Ingested "${title}" -> ${inserted} chunks (textbook_id: ${book.id}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
