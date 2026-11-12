-- 契約の便 2（2026-11-12 Naoki OK 12:33・ShiaSign）：署名ページ。署名の依頼 1 件 1 行。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。読み書きは Worker が秘密の鍵で行う。
--  ・署名のリンク・確認コード・署名後の画面の鍵は、そのままでは持たず SHA-256 だけを持つ（表を見られてもなりすませない）
--  ・署名した記録（日時・IP・端末・PDF の指紋・入力した氏名）は「署名の記録」として b_contract_files に JSON で入れ、
--    その指紋を外の時刻の証明（FreeTSA・RFC 3161）に送り、返ってきた証明も b_contract_files に入れる
-- 戻し方：drop table public.b_contract_signs;（b_contract_files の source の決まりは戻さなくてよい）
create table if not exists public.b_contract_signs (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references public.b_contracts(id) on delete restrict,
  file_id          uuid not null references public.b_contract_files(id) on delete restrict,
  email            text not null check (char_length(email) between 3 and 200),
  token_hash       text not null unique,
  expires_at       timestamptz not null,
  status           text not null default 'open' check (status in ('open','signed','cancelled')),
  code_hash        text,
  code_expires_at  timestamptz,
  code_channel     text check (code_channel is null or code_channel in ('line','email')),
  code_sends       integer not null default 0,
  code_last_at     timestamptz,
  code_tries       integer not null default 0,
  verified_at      timestamptz,
  session_hash     text,
  session_until    timestamptz,
  signed_at        timestamptz,
  signer_name      text,
  ip               text,
  user_agent       text,
  signed_file_id   uuid references public.b_contract_files(id),
  evidence_file_id uuid references public.b_contract_files(id),
  tsa_file_id      uuid references public.b_contract_files(id),
  tsa_error        text,
  receipt_hash     text unique,
  created_at       timestamptz not null default now(),
  created_by       text not null default ''
);
create index if not exists b_contract_signs_contract on public.b_contract_signs (contract_id);
alter table public.b_contract_signs enable row level security;
revoke all on public.b_contract_signs from anon, authenticated;
-- 署名ページが入れる書類の出どころ（shiasign）を足す
alter table public.b_contract_files drop constraint if exists b_contract_files_source_check;
alter table public.b_contract_files add constraint b_contract_files_source_check check (source in ('upload','docusign','google_docs','shiasign','other'));
