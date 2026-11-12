-- 契約の便 1（2026-11-12 Naoki OK 12:14）：契約の台帳と書類。DocuSign を解約しても契約を回すため（ShiaSign）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。読み書きは Worker が秘密の鍵で行う。
--  ・b_contracts：契約 1 件 1 行。顧客（member）と売上管理の契約（sm_contracts の番号）は「どちらも空でよい」結び。
--    名前でしか結べない売上管理の契約を、Naoki が確かめた番号で持つ（salesmark.js と同じ考え方）
--  ・b_contract_files：書類 1 つ 1 行（下書き・署名済み・締結完了証明書・そのほか）。中身は R2（IMAGES の箱の contracts/）。
--    入れたときの SHA-256（ハッシュ値）を持ち、あとで R2 の中身と比べて書き換えを見つける
--  ・誤削除の対策：書類の行は直す・消すを表の仕掛け（trigger）で断る。契約の行も消すのは断る（「しまう」で隠すだけ）。
--    電子帳簿保存法の保存期間（法人は原則 7 年・欠損金の年は 10 年）を、消せない作りで満たす
-- 戻し方：drop table public.b_contract_files; drop table public.b_contracts; drop function public.b_contract_no_change();
--   （R2 の contracts/ は残るので、要らなければ別に消す）
create table if not exists public.b_contracts (
  id                uuid primary key default gen_random_uuid(),
  person_id         uuid references public.member(id) on delete set null,
  sales_contract_id bigint,
  title             text not null check (char_length(title) between 1 and 200),
  kind              text not null default '' check (char_length(kind) <= 40),
  company           text not null default '' check (char_length(company) <= 120),
  signer_name       text not null default '' check (char_length(signer_name) <= 80),
  signer_email      text not null default '' check (char_length(signer_email) <= 200),
  amount            bigint check (amount is null or amount >= 0),
  start_date        date,
  end_date          date,
  signed_on         date,
  auto_renew        boolean not null default false,
  status            text not null default 'draft' check (status in ('draft','ready','waiting','signed','ended')),
  requested_at      timestamptz,
  requested_to      text not null default '' check (char_length(requested_to) <= 200),
  note              text not null default '' check (char_length(note) <= 2000),
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text not null default ''
);
create index if not exists b_contracts_person on public.b_contracts (person_id);
create index if not exists b_contracts_end on public.b_contracts (end_date);

create table if not exists public.b_contract_files (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.b_contracts(id) on delete restrict,
  role         text not null check (role in ('draft','signed','certificate','other')),
  name         text not null check (char_length(name) between 1 and 200),
  r2_key       text unique,
  url          text check (url is null or char_length(url) <= 500),
  size         bigint not null default 0,
  sha256       text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null default '' check (char_length(content_type) <= 100),
  source       text not null default 'upload' check (source in ('upload','docusign','google_docs','other')),
  created_at   timestamptz not null default now(),
  created_by   text not null default '',
  check (r2_key is not null or url is not null),
  check (r2_key is null or sha256 is not null)
);
create index if not exists b_contract_files_contract on public.b_contract_files (contract_id);

-- 直す・消すを断る仕掛け（書類は全部・契約は消すだけ）
create or replace function public.b_contract_no_change() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'b_contracts: % on % is not allowed (archive instead)', tg_op, tg_table_name;
end $$;
drop trigger if exists b_contract_files_lock on public.b_contract_files;
create trigger b_contract_files_lock before update or delete on public.b_contract_files
  for each row execute function public.b_contract_no_change();
drop trigger if exists b_contracts_no_delete on public.b_contracts;
create trigger b_contracts_no_delete before delete on public.b_contracts
  for each row execute function public.b_contract_no_change();

alter table public.b_contracts enable row level security;
alter table public.b_contract_files enable row level security;
revoke all on public.b_contracts from anon, authenticated;
revoke all on public.b_contract_files from anon, authenticated;
