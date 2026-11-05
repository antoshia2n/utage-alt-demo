-- 目標達成くん 3 便目（2026-11-05 12:40 Naoki「OK」）：生徒が出した週報（その週の控え）と、シアニンの承認
-- 生徒は自分の分を出し直せる（出し直すと承認は外れる）。承認とひとことはしあらぼ管理から入れる（3 便目の後半）。何回流しても同じ結果になる。
-- 戻し方：drop table public.b_goal_reviews;
create table if not exists public.b_goal_reviews (
  id            bigint generated always as identity primary key,
  member_id     uuid not null references public.member(id) on delete cascade,
  week_start    date not null,
  week_no       int not null check (week_no between 1 and 13),
  report        jsonb not null default '{}'::jsonb,
  submitted_at  timestamptz not null default now(),
  approved_at   timestamptz,
  comment       text not null default '' check (char_length(comment) <= 500),
  unique (member_id, week_start)
);
create index if not exists b_goal_reviews_member_week on public.b_goal_reviews (member_id, week_start desc);
alter table public.b_goal_reviews enable row level security;
revoke all on public.b_goal_reviews from anon, authenticated;
