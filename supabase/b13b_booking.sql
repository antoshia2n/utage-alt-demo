-- B の便 13b：個別相談の予約の種類（2026-10-10 Naoki「進めて」）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある行は上書きしない。
-- 足すもの：
--   1. b_booking_types … 予約の種類（名前・住所の名前・長さ・受け付ける曜日と時間帯・何日先まで・何時間前まで・Zoom・サンクスページ・受付と前日の知らせの文）
--   2. 架空の「個別相談（30 分）」の箱を企画から外す（本番の置き場では予約の種類ごとの箱に替わるため）
-- 予約そのものは表を増やさず、今までどおり出来事（b_events の consult_booked・consult_reminded）に積む。
-- 道具の権限の行は入れない（src/guard.js の最初の値で、最初に使うときに入る）。
-- 戻し方：drop table public.b_booking_types;

-- 1. 予約の種類
create table if not exists public.b_booking_types (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  title            text not null check (char_length(title) between 1 and 80),
  minutes          integer not null default 30 check (minutes between 10 and 240),
  weekdays         integer[] not null default '{1,2,3,4,5}',
  times            text not null default '10:00-12:00,20:00-22:00' check (char_length(times) between 11 and 200),
  days_ahead       integer not null default 14 check (days_ahead between 1 and 90),
  min_notice_hours integer not null default 12 check (min_notice_hours between 0 and 168),
  zoom_url         text not null default '' check (zoom_url = '' or zoom_url ~ '^https://'),
  thanks_page_slug text check (thanks_page_slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  avoid_calendar   boolean not null default true,
  remind_minutes   integer default 1440 check (remind_minutes between 30 and 10080),
  confirm_subject  text not null check (char_length(confirm_subject) between 1 and 200),
  confirm_body     text not null check (char_length(confirm_body) between 1 and 8000),
  remind_subject   text not null check (char_length(remind_subject) between 1 and 200),
  remind_body      text not null check (char_length(remind_body) between 1 and 8000),
  active           boolean not null default true,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text not null default 'seed',
  check (weekdays <@ '{0,1,2,3,4,5,6}'::integer[] and cardinality(weekdays) between 1 and 7)
);
alter table public.b_booking_types enable row level security;
revoke all on public.b_booking_types from anon, authenticated;

-- 2. 架空の箱を企画から外す
delete from public.b_campaign_parts where part_type = 'booking' and part_id = 'consult';

-- 確かめ：結果の 1 行が 1 | 0 | false なら正しい
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'b_booking_types') as new_tables,
  (select count(*) from public.b_campaign_parts where part_type = 'booking' and part_id = 'consult')                 as fake_booking_parts,
  has_table_privilege('anon', 'public.b_booking_types', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_booking_types', 'SELECT')                                     as browser_can_read;
