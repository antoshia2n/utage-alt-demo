-- B の便 11a：人の項目とフォーム（2026-10-09 Naoki「進めて」）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある行は上書きしない。
-- 足すもの：
--   1. b_fields        … 人の項目の決め（key・名前・型・選択肢）
--   2. b_forms         … フォーム（題名・住所の名前 slug・並べる項目・公開中か）
--   3. b_answers       … フォームの回答（毎回 1 行・履歴として残る）
--   4. b_person_values … 人ごとの項目の最新の値（配信の宛先の条件に使う）
--   5. コネクタのきっかけに「フォームに答えた（form_submitted）」を足す
-- 道具の権限の行は入れない（src/guard.js の最初の値で、最初に使うときに入る）。
-- 戻し方：drop table public.b_person_values, public.b_answers, public.b_forms, public.b_fields;
--         alter table public.b_steps drop constraint b_steps_trigger_check;
--         alter table public.b_steps add constraint b_steps_trigger_check
--           check (trigger in ('registered','purchase','clicked','lesson_viewed','correction_submitted','login','label_added'));

-- 1. 人の項目の決め
create table if not exists public.b_fields (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label       text not null check (char_length(label) between 1 and 40),
  type        text not null check (type in ('text','textarea','number','date','select')),
  options     jsonb not null default '[]'::jsonb,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'seed',
  archived_at timestamptz
);
alter table public.b_fields enable row level security;
revoke all on public.b_fields from anon, authenticated;

-- 2. フォーム
create table if not exists public.b_forms (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  title       text not null check (char_length(title) between 1 and 80),
  intro       text not null default '' check (char_length(intro) <= 2000),
  thanks      text not null default '' check (char_length(thanks) <= 2000),
  items       jsonb not null default '[]'::jsonb,
  ask_name    boolean not null default true,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'seed'
);
alter table public.b_forms enable row level security;
revoke all on public.b_forms from anon, authenticated;

-- 3. 回答（人の番号は台帳 b_customers の id ＝ 門番の表 member の id）
create table if not exists public.b_answers (
  id           bigint generated always as identity primary key,
  form_id      uuid not null references public.b_forms(id),
  customer_id  uuid not null,
  answers      jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);
create index if not exists b_answers_form on public.b_answers (form_id, submitted_at desc);
create index if not exists b_answers_person on public.b_answers (customer_id, submitted_at desc);
alter table public.b_answers enable row level security;
revoke all on public.b_answers from anon, authenticated;

-- 4. 人ごとの最新の値
create table if not exists public.b_person_values (
  customer_id uuid not null,
  key         text not null references public.b_fields(key),
  value       text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (customer_id, key)
);
create index if not exists b_person_values_key on public.b_person_values (key);
alter table public.b_person_values enable row level security;
revoke all on public.b_person_values from anon, authenticated;

-- 5. コネクタのきっかけ
alter table public.b_steps drop constraint if exists b_steps_trigger_check;
alter table public.b_steps add constraint b_steps_trigger_check
  check (trigger in ('registered','purchase','clicked','lesson_viewed','correction_submitted','login','label_added','form_submitted'));

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name in ('b_fields','b_forms','b_answers','b_person_values'))           as new_tables,
  (select pg_get_constraintdef(oid) like '%form_submitted%' from pg_constraint
     where conname = 'b_steps_trigger_check' and conrelid = 'public.b_steps'::regclass)                             as form_trigger,
  has_table_privilege('anon', 'public.b_answers', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_answers', 'SELECT')
    or has_table_privilege('anon', 'public.b_person_values', 'SELECT')                                                 as browser_can_read;
