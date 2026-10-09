-- B の便 12a：ページ作成（2026-10-09 Naoki「進めて」）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある行は上書きしない。
-- 足すもの：
--   1. b_pages         … ページ 1 枚（住所の名前 slug・外の名前・目的・状態・公開中の版）
--   2. b_page_versions … 版ごとの HTML（Claude が下書きを置くたびに 1 つ増える）
--   3. b_page_requests … Lab OS で書いた依頼と、そこから作った依頼文
--   4. b_page_hits     … ページを見た・ボタンを押した（まだ台帳にいない人も数える）
--   5. コネクタのきっかけに「ページを見た（page_viewed）」「ページのボタンを押した（page_clicked）」を足す
-- 道具の権限の行は入れない（src/guard.js の最初の値で、最初に使うときに入る）。
-- 戻し方：drop table public.b_page_hits, public.b_page_versions, public.b_page_requests, public.b_pages;
--         alter table public.b_steps drop constraint b_steps_trigger_check;
--         alter table public.b_steps add constraint b_steps_trigger_check
--           check (trigger in ('registered','purchase','clicked','lesson_viewed','correction_submitted','login','label_added','form_submitted'));
--         （先に trigger が page_viewed・page_clicked の行を消しておく）

-- 1. ページ
create table if not exists public.b_pages (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  title             text not null check (char_length(title) between 1 and 80),
  purpose           text not null default 'signup' check (purpose in ('signup','seminar','sale','news')),
  status            text not null default 'draft' check (status in ('draft','published','stopped')),
  latest_version    integer not null default 0 check (latest_version >= 0),
  published_version integer check (published_version > 0),
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text not null default 'seed'
);
alter table public.b_pages enable row level security;
revoke all on public.b_pages from anon, authenticated;

-- 2. 版ごとの HTML
create table if not exists public.b_page_versions (
  page_id    uuid not null references public.b_pages(id) on delete cascade,
  version    integer not null check (version > 0),
  html       text not null check (char_length(html) between 1 and 400000),
  parts      jsonb not null default '{}'::jsonb,
  note       text not null default '' check (char_length(note) <= 500),
  request_id bigint,
  made_by    text not null default 'mcp',
  created_at timestamptz not null default now(),
  primary key (page_id, version)
);
alter table public.b_page_versions enable row level security;
revoke all on public.b_page_versions from anon, authenticated;

-- 3. 依頼
create table if not exists public.b_page_requests (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('new','fix')),
  page_id      uuid references public.b_pages(id) on delete cascade,
  purpose      text check (purpose in ('signup','seminar','sale','news')),
  title        text not null default '' check (char_length(title) <= 80),
  reference    text not null default '' check (char_length(reference) <= 2000),
  materials    text not null default '' check (char_length(materials) <= 2000),
  comment      text not null default '' check (char_length(comment) <= 2000),
  base_version integer,
  campaign_id  uuid,
  prompt       text not null default '',
  done_version integer,
  done_page_id uuid references public.b_pages(id) on delete set null,
  created_by   text not null default 'admin',
  created_at   timestamptz not null default now(),
  check ((kind = 'fix') = (page_id is not null))
);
create index if not exists b_page_requests_page on public.b_page_requests (page_id, id desc);
alter table public.b_page_requests enable row level security;
revoke all on public.b_page_requests from anon, authenticated;

-- 4. 見た・押した
create table if not exists public.b_page_hits (
  id          bigint generated always as identity primary key,
  page_id     uuid not null references public.b_pages(id) on delete cascade,
  version     integer,
  kind        text not null check (kind in ('view','click')),
  button      text check (char_length(button) <= 50),
  vid         text not null check (vid ~ '^[a-z0-9]{8,40}$'),
  customer_id uuid,
  route       text check (char_length(route) <= 40),
  at          timestamptz not null default now()
);
create index if not exists b_page_hits_page_at on public.b_page_hits (page_id, at desc);
create index if not exists b_page_hits_at on public.b_page_hits (at desc);
alter table public.b_page_hits enable row level security;
revoke all on public.b_page_hits from anon, authenticated;

-- 5. コネクタのきっかけ
alter table public.b_steps drop constraint if exists b_steps_trigger_check;
alter table public.b_steps add constraint b_steps_trigger_check
  check (trigger in ('registered','purchase','clicked','lesson_viewed','correction_submitted','login','label_added','form_submitted','page_viewed','page_clicked'));

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name in ('b_pages','b_page_versions','b_page_requests','b_page_hits'))   as new_tables,
  (select pg_get_constraintdef(oid) like '%page_clicked%' from pg_constraint
     where conname = 'b_steps_trigger_check' and conrelid = 'public.b_steps'::regclass)                            as page_triggers,
  has_table_privilege('anon', 'public.b_page_versions', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_page_versions', 'SELECT')
    or has_table_privilege('anon', 'public.b_page_hits', 'SELECT')                                                     as browser_can_read;
