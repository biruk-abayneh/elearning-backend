-- ============================================================================
-- Nerd Out — AI Tutor RAG migration
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
--
-- It enables pgvector and creates the textbook store used by the "Ask Nerd"
-- tutor. Embeddings are 768-dimensional (Gemini `gemini-embedding-001` with
-- outputDimensionality: 768). If your `subjects.id` column is NOT uuid, change
-- the `subject_id uuid` lines below to match its type.
-- ============================================================================

-- 1. Enable the vector extension (pgvector)
create extension if not exists vector;

-- 2. One row per ingested textbook
create table if not exists public.textbooks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  subject_id  uuid references public.subjects(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 3. One row per embedded chunk of a textbook
create table if not exists public.textbook_chunks (
  id           uuid primary key default gen_random_uuid(),
  textbook_id  uuid not null references public.textbooks(id) on delete cascade,
  subject_id   uuid references public.subjects(id) on delete set null,
  content      text not null,
  page         int,
  embedding    vector(768),
  created_at   timestamptz not null default now()
);

-- 4. Approximate-nearest-neighbour index for fast cosine similarity search.
--    HNSW gives good recall/speed; build it after the table exists.
create index if not exists textbook_chunks_embedding_idx
  on public.textbook_chunks
  using hnsw (embedding vector_cosine_ops);

-- Helper index for subject-scoped retrieval
create index if not exists textbook_chunks_subject_idx
  on public.textbook_chunks (subject_id);

-- 5. Retrieval function used by the backend tutor endpoint.
--    Pass match_subject_id = null to search across all subjects.
--    Returns the top `match_count` chunks by cosine similarity.
create or replace function public.match_textbook_chunks (
  query_embedding  vector(768),
  match_subject_id uuid default null,
  match_count      int  default 5
)
returns table (
  id           uuid,
  textbook_id  uuid,
  title        text,
  content      text,
  page         int,
  similarity   float
)
language sql stable
as $$
  select
    tc.id,
    tc.textbook_id,
    tb.title,
    tc.content,
    tc.page,
    1 - (tc.embedding <=> query_embedding) as similarity
  from public.textbook_chunks tc
  join public.textbooks tb on tb.id = tc.textbook_id
  where tc.embedding is not null
    and (match_subject_id is null or tc.subject_id = match_subject_id)
  order by tc.embedding <=> query_embedding
  limit match_count;
$$;
