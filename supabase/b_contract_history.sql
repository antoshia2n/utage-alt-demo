-- 契約の便 3（2026-11-12・ShiaSign）：更新・解約・期限の通知の履歴。1 件 1 行・直さない・消さない。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。
--  kind：renewed（更新・終了日を延ばした）／cancelled（解約）／ended（期間満了で終了）／notice（更新の 30 日前の通知を送った）
--  notice は契約と終了日ごとに 1 回だけ（同じ終了日に 2 回送らない）
-- 戻し方：drop table public.b_contract_history;
create table if not exists public.b_contract_history (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.b_contracts(id) on delete restrict,
  kind        text not null check (kind in ('renewed','cancelled','ended','notice')),
  from_end    date,
  to_end      date,
  note        text not null default '' check (char_length(note) <= 1000),
  at          timestamptz not null default now(),
  by_who      text not null default ''
);
create index if not exists b_contract_history_contract on public.b_contract_history (contract_id, at desc);
create unique index if not exists b_contract_history_notice on public.b_contract_history (contract_id, to_end) where kind = 'notice';
drop trigger if exists b_contract_history_lock on public.b_contract_history;
create trigger b_contract_history_lock before update or delete on public.b_contract_history
  for each row execute function public.b_contract_no_change();
alter table public.b_contract_history enable row level security;
revoke all on public.b_contract_history from anon, authenticated;
