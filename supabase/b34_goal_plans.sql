-- 目標達成くん 1 便目（2026-11-05・Naoki 11:25「OK」）：生徒が自分で書く 13 週の設計（理想・KGI・リソース予算・13 週の目標・戦略・状態）
-- 正本はここ（生徒が書く）。シアニンは読むだけ（5 便目でしあらぼ管理に出す）。何回流しても同じ結果になる。
-- 戻し方：drop table public.b_goal_plans;
create table if not exists public.b_goal_plans (
  member_id   uuid primary key references public.member(id) on delete cascade,
  plan        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.b_goal_plans enable row level security;
revoke all on public.b_goal_plans from anon, authenticated;
