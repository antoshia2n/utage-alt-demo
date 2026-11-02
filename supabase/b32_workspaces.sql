-- 場所（ワークスペース）（2026-11-02・Naoki「OK」13:32）
-- データを「人」ではなく「場所」に付ける。人は 1 人 1 アカウントのまま、複数の場所に入れる。
-- 自分の場所はこれまでどおり（表の持ち主の列に本人の番号）。みんなの場所は持ち主の列に場所の番号（ws_＋32 字）が入る。
-- 入っているかは shia2n-core の server/workspace.js が ws_members を秘密の鍵で読んで決める。
-- 何回流しても同じ結果になる。既にある行には触らない（b_invites は列を 1 つ足すだけ）。ブラウザ（anon・authenticated）からは読めない。
-- 戻し方：alter table public.b_invites drop column if exists workspace_id; drop table public.ws_members; drop table public.ws_workspaces;

create table if not exists public.ws_workspaces (
  id          text primary key default ('ws_' || replace(gen_random_uuid()::text, '-', '')) check (id ~ '^ws_[0-9a-f]{32}$'),
  name        text not null check (char_length(name) between 1 and 40),
  created_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.ws_members (
  workspace_id  text not null references public.ws_workspaces(id) on delete cascade,
  firebase_uid  text not null check (char_length(firebase_uid) between 1 and 128),
  member_id     uuid references public.member(id) on delete set null,
  role          text not null default 'editor' check (role in ('owner', 'editor')),
  via_invite    uuid references public.b_invites(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, firebase_uid)
);
create index if not exists ws_members_uid_idx on public.ws_members (firebase_uid);

alter table public.b_invites add column if not exists workspace_id text references public.ws_workspaces(id) on delete set null;

alter table public.ws_workspaces enable row level security;
alter table public.ws_members enable row level security;
revoke all on public.ws_workspaces, public.ws_members from anon, authenticated;
