-- チャットの便 C2b（2026-11-07 Naoki OK 12:48）：グループチャットの表 3 つ。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。
--   b_chat_groups         … グループ（名前・閉じた日・シアニンがどこまで読んだか admin_read_upto）
--   b_chat_group_members  … 入っている人（抜けた日・どこまで読んだか read_upto）
--   b_chat_group_messages … メッセージとスタンプ（kind=msg はメッセージ、kind=react はスタンプ 1 つ）。
--                            thread_of が入っていればスレッドの返信。from_customer が空ならシアニン
-- 生徒の画面からは直接読めない（Worker が秘密の鍵で読み、入っている人の分だけ返す）
-- 戻し方：drop table public.b_chat_group_messages; drop table public.b_chat_group_members; drop table public.b_chat_groups;

create table if not exists public.b_chat_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  sort        integer not null default 0,
  closed_at   timestamptz,
  admin_read_upto bigint not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text not null default ''
);

create table if not exists public.b_chat_group_members (
  group_id     uuid not null references public.b_chat_groups(id) on delete cascade,
  customer_id  uuid not null references public.member(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  read_upto    bigint not null default 0,
  primary key (group_id, customer_id)
);
create index if not exists b_chat_group_members_customer on public.b_chat_group_members (customer_id);

create table if not exists public.b_chat_group_messages (
  id             bigserial primary key,
  group_id       uuid not null references public.b_chat_groups(id) on delete cascade,
  kind           text not null default 'msg' check (kind in ('msg', 'react')),
  from_customer  uuid references public.member(id) on delete set null,
  text           text not null default '' check (char_length(text) <= 8000),
  images         jsonb not null default '[]'::jsonb,
  thread_of      bigint references public.b_chat_group_messages(id) on delete cascade,
  target         bigint references public.b_chat_group_messages(id) on delete cascade,
  emoji          text check (emoji is null or char_length(emoji) <= 8),
  actor          text not null default '',
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists b_chat_group_messages_group on public.b_chat_group_messages (group_id, id);
create index if not exists b_chat_group_messages_thread on public.b_chat_group_messages (thread_of);

alter table public.b_chat_groups         enable row level security;
alter table public.b_chat_group_members  enable row level security;
alter table public.b_chat_group_messages enable row level security;
revoke all on public.b_chat_groups, public.b_chat_group_members, public.b_chat_group_messages from anon, authenticated;

-- 確かめ（この 1 行だけが結果に出る）。3 つが true・browser_can_read が false なら正しい
select
  to_regclass('public.b_chat_groups') is not null          as groups,
  to_regclass('public.b_chat_group_members') is not null   as members,
  to_regclass('public.b_chat_group_messages') is not null  as messages,
  has_table_privilege('anon', 'public.b_chat_groups', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_chat_group_messages', 'SELECT') as browser_can_read;
