-- 目標タブ（2026-10-30・マーケくん 0.58.0-bgoals）：しあらぼの生徒の日報・週報。目標の正本はしあらぼ管理（shr_students）
-- 本番へは 2026-10-30 に開発部が SQL エディタから流した。何回流しても同じ結果になる。
-- 戻し方：drop table public.b_reports; alter table public.shr_students drop column track;
create table if not exists public.b_reports (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references public.member(id) on delete cascade,
  kind        text not null check (kind in ('daily', 'weekly')),
  day         date not null,
  numbers     jsonb not null default '{}'::jsonb,
  body        text not null default '' check (char_length(body) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (member_id, kind, day)
);
create index if not exists b_reports_member_day on public.b_reports (member_id, day desc);
alter table public.b_reports enable row level security;
revoke all on public.b_reports from anon, authenticated;
-- 追う数字の名前（文字の配列・最大 3 つ）。面談のあと AI が議事録から案を作り、Naoki が OK したものを入れる
alter table public.shr_students add column if not exists track jsonb not null default '[]'::jsonb;
