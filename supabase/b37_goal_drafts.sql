-- 目標達成くん 6 便目（2026-11-05 Naoki 14:55「OK」）：面談の議事録から Claude が作った設計の下書き
-- Claude の道具 set_goal_draft（承認が要る）で、Naoki が承認したときだけ入る。会員ごとに 1 つ（入れ直すと置き換える）。
-- 生徒が「この設計で始める」を押すと b_goal_plans へ写し applied_at を付ける。prev は始める前の設計（元に戻す用）。
create table if not exists public.b_goal_drafts (
  member_id    uuid primary key references public.member(id) on delete cascade,
  draft        jsonb not null,
  source       text not null default '',
  prev         jsonb,
  created_at   timestamptz not null default now(),
  applied_at   timestamptz,
  dismissed_at timestamptz
);
alter table public.b_goal_drafts enable row level security;
revoke all on public.b_goal_drafts from anon, authenticated;
