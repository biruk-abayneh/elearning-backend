-- ============================================================================
-- Nerd Out — full database schema (rebuild)
--
-- Run this ONCE in a fresh Supabase project: Dashboard -> SQL Editor -> New
-- query -> paste -> Run. It recreates every table, relationship, index, RPC
-- function, and the auth trigger the app expects, INCLUDING the AI tutor tables
-- (so you do NOT also need to run ai_rag_migration.sql — this file supersedes it).
--
-- It only builds STRUCTURE. Your content (subjects, chapters, questions,
-- flashcards, textbooks) is re-added afterward via the admin panel / bulk upload
-- / the textbook ingestion script.
--
-- Reconstructed by auditing every supabase.from()/.rpc() call in the codebase.
-- The RPC function bodies (get_user_rankings, get_flashcard_chapter_stats,
-- handle_question_like) could NOT be recovered from the old database, so they are
-- re-implemented here from how the app uses them — verify they behave as you
-- expect after a first run.
--
-- SECURITY NOTE: Row Level Security (RLS) is left DISABLED to match how the app
-- was working before (the frontend queries several tables directly with the anon
-- key). This means any logged-in user could read/modify rows via the API. This is
-- fine to get running again, but you should add RLS policies before a real launch
-- — see the "SECURITY / RLS" section at the bottom. I can write those policies for
-- you when you're ready.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists vector;     -- pgvector, for the AI tutor embeddings

-- ---------------------------------------------------------------------------
-- profiles  (1 row per auth user; id = auth.users.id)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'user',   -- 'user' | 'admin'
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- subjects
-- ---------------------------------------------------------------------------
create table if not exists public.subjects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- chapters  (belongs to a subject; the app uses BOTH name and title)
-- ---------------------------------------------------------------------------
create table if not exists public.chapters (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid references public.subjects(id) on delete cascade,
  name         text,
  title        text,          -- some queries read `title`; kept for compatibility
  is_question  boolean not null default false,
  is_flashcard boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists chapters_subject_idx on public.chapters(subject_id);

-- ---------------------------------------------------------------------------
-- questions
-- ---------------------------------------------------------------------------
create table if not exists public.questions (
  id                uuid primary key default gen_random_uuid(),
  chapter_id        uuid references public.chapters(id) on delete cascade,
  question_text     text,
  options           jsonb,        -- array of option strings, e.g. ["A","B","C","D"]
  correct_answer    text,         -- stores the answer TEXT (compared by equality)
  explanation       text,
  explanation_image text,
  question_image    text,
  is_active         boolean not null default true,
  order_index       int not null default 0,
  likes_count       int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists questions_chapter_idx on public.questions(chapter_id);

-- ---------------------------------------------------------------------------
-- user_likes  (which user liked which question; backs handle_question_like
--              and the questions.user_likes!left join)
-- ---------------------------------------------------------------------------
create table if not exists public.user_likes (
  user_id     uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index if not exists user_likes_question_idx on public.user_likes(question_id);

-- ---------------------------------------------------------------------------
-- progress  (per-question answer log; upsert target is (user_id, question_id))
-- ---------------------------------------------------------------------------
create table if not exists public.progress (
  user_id     uuid not null references auth.users(id) on delete cascade,
  chapter_id  uuid references public.chapters(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  is_correct  boolean,
  created_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index if not exists progress_chapter_idx on public.progress(chapter_id);

-- ---------------------------------------------------------------------------
-- quiz_attempts  (per-quiz-session summary)
-- ---------------------------------------------------------------------------
create table if not exists public.quiz_attempts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid references public.chapters(id) on delete cascade,
  score           int,
  total_questions int,
  percentage      numeric,
  created_at      timestamptz not null default now()
);
create index if not exists quiz_attempts_user_idx on public.quiz_attempts(user_id);

-- ---------------------------------------------------------------------------
-- flashcards
-- ---------------------------------------------------------------------------
create table if not exists public.flashcards (
  id         uuid primary key default gen_random_uuid(),
  chapter_id uuid references public.chapters(id) on delete cascade,
  front_text text,
  back_text  text,
  created_at timestamptz not null default now()
);
create index if not exists flashcards_chapter_idx on public.flashcards(chapter_id);

-- ---------------------------------------------------------------------------
-- user_flashcard_progress  (upsert on (user_id, flashcard_id))
-- ---------------------------------------------------------------------------
create table if not exists public.user_flashcard_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  is_flipped   boolean not null default false,
  liked        boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (user_id, flashcard_id)
);

-- ---------------------------------------------------------------------------
-- subscriptions  (upsert on user_id -> user_id is unique)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  status     text not null default 'active',
  plan_type  text,
  start_date timestamptz,
  end_date   timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- user_sessions  (device-limit enforcement, max 2 devices)
-- ---------------------------------------------------------------------------
create table if not exists public.user_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_id   text,
  device_name text,
  last_active timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists user_sessions_user_idx on public.user_sessions(user_id);

-- ---------------------------------------------------------------------------
-- question_reports  (user-submitted issue reports on questions)
-- ---------------------------------------------------------------------------
create table if not exists public.question_reports (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid references public.questions(id) on delete cascade,
  reasons        jsonb,          -- array of reason strings
  custom_comment text,
  user_id        uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI tutor: textbooks + embedded chunks (RAG)
-- ---------------------------------------------------------------------------
create table if not exists public.textbooks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  subject_id uuid references public.subjects(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.textbook_chunks (
  id          uuid primary key default gen_random_uuid(),
  textbook_id uuid not null references public.textbooks(id) on delete cascade,
  subject_id  uuid references public.subjects(id) on delete set null,
  content     text not null,
  page        int,
  embedding   vector(768),
  created_at  timestamptz not null default now()
);
create index if not exists textbook_chunks_embedding_idx
  on public.textbook_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists textbook_chunks_subject_idx
  on public.textbook_chunks (subject_id);

-- ============================================================================
-- Auth trigger: create a profiles row automatically for every new auth user
-- (full_name comes from the signup metadata set in AuthScreen).
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- RPC: get_user_rankings()
-- Leaderboard by total quiz score. Returns one row per user with attempts.
-- Consumed as data?.rank?.rank and data?.rank?.total_score (DashboardScreen).
-- ============================================================================
create or replace function public.get_user_rankings()
returns table (user_id uuid, total_score bigint, rank bigint)
language sql stable
as $$
  select
    qa.user_id,
    sum(qa.score)::bigint as total_score,
    rank() over (order by sum(qa.score) desc)::bigint as rank
  from public.quiz_attempts qa
  group by qa.user_id;
$$;

-- ============================================================================
-- RPC: get_flashcard_chapter_stats(u_id, s_id)
-- Per-chapter flashcard progress for a user within a subject.
-- Returns (chapter_id, chapter_title, total_cards, cards_worked_on).
-- ============================================================================
create or replace function public.get_flashcard_chapter_stats(u_id uuid, s_id uuid)
returns table (
  chapter_id      uuid,
  chapter_title   text,
  total_cards     int,
  cards_worked_on int
)
language sql stable
as $$
  select
    c.id as chapter_id,
    coalesce(c.title, c.name) as chapter_title,
    count(distinct f.id)::int as total_cards,
    count(distinct ufp.flashcard_id)::int as cards_worked_on
  from public.chapters c
  join public.flashcards f on f.chapter_id = c.id
  left join public.user_flashcard_progress ufp
    on ufp.flashcard_id = f.id and ufp.user_id = u_id
  where c.subject_id = s_id
  group by c.id, coalesce(c.title, c.name)
  order by chapter_title;
$$;

-- ============================================================================
-- RPC: handle_question_like(q_id, u_id)
-- Toggles a like: inserts/deletes user_likes and keeps questions.likes_count.
-- ============================================================================
create or replace function public.handle_question_like(q_id uuid, u_id uuid)
returns void
language plpgsql
as $$
begin
  if exists (select 1 from public.user_likes where question_id = q_id and user_id = u_id) then
    delete from public.user_likes where question_id = q_id and user_id = u_id;
    update public.questions
      set likes_count = greatest(0, coalesce(likes_count, 0) - 1)
      where id = q_id;
  else
    insert into public.user_likes (question_id, user_id) values (q_id, u_id);
    update public.questions
      set likes_count = coalesce(likes_count, 0) + 1
      where id = q_id;
  end if;
end;
$$;

-- ============================================================================
-- RPC: match_textbook_chunks(query_embedding, match_subject_id, match_count)
-- Cosine-similarity retrieval for the AI tutor. subject filter is optional.
-- ============================================================================
create or replace function public.match_textbook_chunks (
  query_embedding  vector(768),
  match_subject_id uuid default null,
  match_count      int  default 5
)
returns table (
  id          uuid,
  textbook_id uuid,
  title       text,
  content     text,
  page        int,
  similarity  float
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

-- ============================================================================
-- GRANTS
-- RLS is DISABLED (see security note at top). These grants let the frontend
-- anon key (logged-in = 'authenticated' role) reach the tables/functions it
-- queries directly, matching the app's prior behavior.
-- ============================================================================

-- Public content: readable by anyone
grant select on public.subjects, public.chapters, public.questions, public.flashcards
  to anon, authenticated;

-- User-scoped tables: full access for logged-in users
grant select, insert, update, delete on
  public.profiles,
  public.subscriptions,
  public.user_sessions,
  public.user_flashcard_progress,
  public.question_reports,
  public.progress,
  public.quiz_attempts,
  public.user_likes
  to authenticated;

-- RPCs the frontend calls directly
grant execute on function public.get_flashcard_chapter_stats(uuid, uuid) to anon, authenticated;
grant execute on function public.handle_question_like(uuid, uuid)        to anon, authenticated;
grant execute on function public.get_user_rankings()                     to anon, authenticated;
grant execute on function public.match_textbook_chunks(vector, uuid, int) to anon, authenticated;

-- ============================================================================
-- SECURITY / RLS (recommended before production, not required to run)
--
-- To lock this down, enable RLS on the user-scoped tables and add policies, e.g.:
--
--   alter table public.subscriptions enable row level security;
--   create policy "own subscription" on public.subscriptions
--     for select using (auth.uid() = user_id);
--   -- ...and similar own-row policies for user_sessions,
--   --    user_flashcard_progress, progress, quiz_attempts, user_likes,
--   --    plus an admin-read policy for profiles (AdminUserScreen lists all users).
--
-- Ask me and I'll generate the complete, tested policy set.
-- ============================================================================
