-- B の便 13：セミナーの回と知らせ（2026-10-10 Naoki「進めて」）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある行は上書きしない。
-- 足すもの：
--   1. b_seminars         … セミナーの回（題名・日時・長さ・定員・Zoom の URL・アーカイブの URL・申込のフォーム・サンクスページ）
--   2. b_seminar_notices  … 回ごとの知らせ（名前 key で見分ける・開催の何分前か・件名・本文）。あとから足せる
--   3. ページの目的に「サンクス（thanks）」を足す
--   4. 企画「2026-11 図解セミナー」の開催日を、ページ（版 5）の 2026-11-01 に合わせる（いまは 2026-11-28）
-- 申込と送った知らせは表を増やさず、出来事の記録（b_events の seminar_registered・seminar_notice_sent）に積む。
-- 道具の権限の行は入れない（src/guard.js の最初の値で、最初に使うときに入る）。
-- 戻し方：drop table public.b_seminar_notices, public.b_seminars;
--         ページの目的の決まりは、purpose が thanks の行を先に直してから元の 4 つに戻す

-- 1. セミナーの回
create table if not exists public.b_seminars (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 1 and 80),
  starts_at        timestamptz not null,
  minutes          integer not null default 60 check (minutes between 10 and 600),
  capacity         integer check (capacity > 0),
  zoom_url         text not null default '' check (zoom_url = '' or zoom_url ~ '^https://'),
  archive_url      text not null default '' check (archive_url = '' or archive_url ~ '^https://'),
  form_slug        text check (form_slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  thanks_page_slug text check (thanks_page_slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text not null default 'seed'
);
-- 1 つのフォームは、しまっていない回 1 つだけに結ぶ（どの回の申込かを迷わせない）
create unique index if not exists b_seminars_form_live on public.b_seminars (form_slug) where form_slug is not null and archived_at is null;
alter table public.b_seminars enable row level security;
revoke all on public.b_seminars from anon, authenticated;

-- 2. 回ごとの知らせ
create table if not exists public.b_seminar_notices (
  id             bigint generated always as identity primary key,
  seminar_id     uuid not null references public.b_seminars(id) on delete cascade,
  key            text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,29}$'),
  offset_minutes integer check (offset_minutes between -10080 and 43200),
  subject        text not null check (char_length(subject) between 1 and 200),
  body           text not null check (char_length(body) between 1 and 8000),
  active         boolean not null default true,
  sort           integer not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text not null default 'seed',
  unique (seminar_id, key)
);
alter table public.b_seminar_notices enable row level security;
revoke all on public.b_seminar_notices from anon, authenticated;

-- 3. ページの目的に「サンクス」
alter table public.b_pages drop constraint if exists b_pages_purpose_check;
alter table public.b_pages add constraint b_pages_purpose_check check (purpose in ('signup','seminar','sale','news','thanks'));
alter table public.b_page_requests drop constraint if exists b_page_requests_purpose_check;
alter table public.b_page_requests add constraint b_page_requests_purpose_check check (purpose in ('signup','seminar','sale','news','thanks'));

-- 4. 企画の開催日（2026-11-28 のときだけ直す。手で別の日に直していたら触らない）
update public.b_campaigns set starts_on = '2026-11-01'
 where id = '1e38b53b-848f-4575-9f7b-1578440f016f' and starts_on = '2026-11-28';

-- 確かめ：結果の 1 行が 2 | true | 2026-11-01 | false なら正しい
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name in ('b_seminars','b_seminar_notices'))                         as new_tables,
  (select pg_get_constraintdef(oid) like '%thanks%' from pg_constraint
     where conname = 'b_pages_purpose_check' and conrelid = 'public.b_pages'::regclass)                         as thanks_purpose,
  (select starts_on::text from public.b_campaigns where id = '1e38b53b-848f-4575-9f7b-1578440f016f')             as campaign_starts_on,
  has_table_privilege('anon', 'public.b_seminars', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_seminars', 'SELECT')
    or has_table_privilege('anon', 'public.b_seminar_notices', 'SELECT')                                          as browser_can_read;
