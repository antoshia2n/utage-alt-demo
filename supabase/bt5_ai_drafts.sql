-- 便 T5（2026-11-08 Naoki OK 09:23）：「流れ」の「AI と作る」。1 枚のカード（ステップ配信・友だち追加の案内）に AI の案を 1 つ置く。
--   asked（依頼した）→ ready（AI が案を置いた）→ adopted（Naoki が採用）／dropped（採用しない・新しい依頼で閉じた）
--   採用するまで配信中の本文は変わらない。採用はシアニン用の画面からだけ。
-- 戻し方：drop table if exists public.b_ai_drafts;

create table if not exists public.b_ai_drafts (
  id uuid primary key default gen_random_uuid(),
  part_type text not null check (part_type in ('step', 'line_invite')),
  part_id text not null check (char_length(part_id) between 1 and 40),
  campaign_id uuid null,
  note text not null default '' check (char_length(note) <= 1000),
  base_text text not null default '',
  draft text null check (draft is null or char_length(draft) <= 5000),
  adopted_text text null,
  status text not null default 'asked' check (status in ('asked', 'ready', 'adopted', 'dropped')),
  created_at timestamptz not null default now(),
  created_by text not null default '',
  drafted_at timestamptz null,
  drafted_by text null,
  decided_at timestamptz null,
  decided_by text null
);
create index if not exists b_ai_drafts_part on public.b_ai_drafts (part_type, part_id, status);
alter table public.b_ai_drafts enable row level security;
-- 読み書きは Worker の service_role だけ（ポリシーは作らない＝ほかからは読めない）

-- 確かめ
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'b_ai_drafts') as table_ok,
       (select relrowsecurity from pg_class where relname = 'b_ai_drafts') as rls_on;
