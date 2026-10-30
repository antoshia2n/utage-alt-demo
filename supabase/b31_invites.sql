-- 招待リンク（2026-10-30・マーケくん 0.57.0-binvite）
-- お金を払わずに入る権利（guest・shiarabo_monitor・shiarabo_pilot）を、リンクから自分で登録して受け取る。
-- 何回流しても同じ結果になる。既にある表には触らない。ブラウザ（anon・authenticated）からは読めない。読み書きは Worker が秘密の鍵で行う。
-- 戻し方：drop function public.b_invite_take(text, uuid); drop table public.b_invite_uses; drop table public.b_invites;

create table if not exists public.b_invites (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique check (token ~ '^[A-Za-z0-9_-]{20,40}$'),
  name        text not null check (char_length(name) between 1 and 40),
  key         text not null check (key in ('guest', 'shiarabo_monitor', 'shiarabo_pilot')),
  grant_until timestamptz,
  max_uses    integer not null check (max_uses between 1 and 100),
  used        integer not null default 0 check (used >= 0),
  link_until  timestamptz not null,
  active      boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  stopped_at  timestamptz
);

create table if not exists public.b_invite_uses (
  id         bigint generated always as identity primary key,
  invite_id  uuid not null references public.b_invites(id) on delete cascade,
  member_id  uuid not null references public.member(id) on delete cascade,
  used_at    timestamptz not null default now(),
  unique (invite_id, member_id)
);

alter table public.b_invites enable row level security;
alter table public.b_invite_uses enable row level security;
revoke all on public.b_invites, public.b_invite_uses from anon, authenticated;

-- リンクを 1 人分使う。人数・期限・止めた印をここ 1 か所で見る（行を押さえるので、同時に押しても人数を超えない）
-- 返り：ok（使った）・already（同じ人の 2 回目・数えない）・not_found・stopped・expired・used_up
create or replace function public.b_invite_take(p_token text, p_member uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v public.b_invites;
begin
  select * into v from public.b_invites where token = p_token for update;
  if not found then return 'not_found'; end if;
  if exists (select 1 from public.b_invite_uses where invite_id = v.id and member_id = p_member) then return 'already'; end if;
  if not v.active then return 'stopped'; end if;
  if v.link_until <= now() then return 'expired'; end if;
  if v.used >= v.max_uses then return 'used_up'; end if;
  update public.b_invites set used = used + 1 where id = v.id;
  insert into public.b_invite_uses (invite_id, member_id) values (v.id, p_member);
  return 'ok';
end $$;

revoke all on function public.b_invite_take(text, uuid) from public, anon, authenticated;
grant execute on function public.b_invite_take(text, uuid) to service_role;
