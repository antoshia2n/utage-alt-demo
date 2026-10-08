-- B の便 2：デモの表を、いまの本番のプロジェクト（htzadzpckcpdrmpjvaut）へ b_ の頭文字で写す。
-- 顧客の台帳は作らない。member（門番の表）を 1 人 1 行の台帳として使い、B だけが使う欄は b_profile に置く。
-- 何回流しても同じ結果になる。既にある表（member を含む）の列・行・方針は 1 つも変えない。
-- 表はすべて RLS を有効にし、ブラウザ（anon・authenticated）からは読めない。読み書きは Worker が秘密の鍵で行う。

-- B だけが使う欄（member 1 行につき 0〜1 行）
create table if not exists public.b_profile (
  member_id    uuid primary key references public.member(id) on delete cascade,
  name         text not null default '',
  source       text not null default 'direct' check (source in ('x','note','youtube','direct','other')),
  note_member  boolean not null default false,
  consent_at   timestamptz,
  sb_auth_uid  uuid unique,
  created_at   timestamptz not null default now()
);

-- 出来事の記録（customer_id は member の番号）
create table if not exists public.b_events (
  id           bigint generated always as identity primary key,
  customer_id  uuid not null references public.member(id) on delete cascade,
  type         text not null,
  payload      jsonb not null default '{}'::jsonb,
  actor        text not null default 'site' check (actor in ('site','admin','mcp','webhook','seed')),
  occurred_at  timestamptz not null default now()
);
create index if not exists b_events_customer_time on public.b_events (customer_id, occurred_at desc);
create index if not exists b_events_type_time on public.b_events (type, occurred_at desc);

create table if not exists public.b_lessons (
  id          text primary key,
  sort        int not null default 0,
  title       text not null,
  summary     text not null default '',
  minutes     int not null default 0,
  youtube_id  text,
  published   boolean not null default true
);

create table if not exists public.b_announcements (
  id            bigint generated always as identity primary key,
  title         text not null,
  body          text not null default '',
  published_at  timestamptz not null default now()
);

create table if not exists public.b_admins (
  email  text primary key check (email = lower(email))
);

create table if not exists public.b_inbound_log (
  id        bigint generated always as identity primary key,
  channel   text not null,
  request   jsonb not null default '{}'::jsonb,
  response  jsonb not null default '{}'::jsonb,
  status    int not null,
  at        timestamptz not null default now()
);
create index if not exists b_inbound_log_at on public.b_inbound_log (at desc);

-- 顧客の台帳の見え方（デモの customers と同じ列）。member の全行が出る
create or replace view public.b_customers with (security_invoker = true) as
select
  m.id,
  lower(m.email)                     as email,
  coalesce(p.name, '')               as name,
  coalesce(p.source, 'other')        as source,
  coalesce(p.note_member, false)     as note_member,
  p.consent_at,
  p.sb_auth_uid                      as auth_user_id,
  p.created_at
from public.member m
left join public.b_profile p on p.member_id = m.id;

create or replace view public.b_customer_summary with (security_invoker = true) as
select
  c.id, c.email, c.name, c.source, c.note_member, c.created_at, c.auth_user_id,
  count(e.id)                                                as event_count,
  count(e.id) filter (where e.type = 'login')                as login_count,
  count(e.id) filter (where e.type = 'lesson_viewed')        as lesson_view_count,
  max(e.occurred_at)                                         as last_event_at,
  case
    when count(e.id) filter (where e.type = 'lesson_viewed') > 0 then '受講中'
    when count(e.id) filter (where e.type = 'login') > 0         then 'ログイン済'
    else '登録のみ'
  end                                                        as stage
from public.b_customers c
left join public.b_events e on e.customer_id = c.id
group by c.id, c.email, c.name, c.source, c.note_member, c.created_at, c.auth_user_id;

-- 登録：メールで member を探し、無ければ 1 行作る。同じメールが 2 行以上あれば止まる
create or replace function public.b_register(p_email text, p_name text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text := lower(trim(p_email));
  v_ids   uuid[];
  v_id    uuid;
  v_new   boolean := false;
begin
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'b_register: bad email';
  end if;
  select array_agg(m.id) into v_ids from public.member m where lower(m.email) = v_email;
  if coalesce(array_length(v_ids, 1), 0) > 1 then
    raise exception 'b_register: two or more member rows share this email';
  end if;
  if v_ids is null then
    insert into public.member (email) values (v_email) returning public.member.id into v_id;
    v_new := true;
  else
    v_id := v_ids[1];
  end if;
  insert into public.b_profile as bp (member_id, name, source, consent_at)
  values (v_id, coalesce(p_name, ''),
          case when p_source in ('x','note','youtube','direct','other') then p_source else 'direct' end,
          now())
  on conflict (member_id) do update
    set consent_at = coalesce(bp.consent_at, excluded.consent_at),
        name       = case when bp.name = '' then excluded.name else bp.name end;
  return jsonb_build_object('id', v_id, 'is_new', v_new);
end;
$fn$;

alter table public.b_profile       enable row level security;
alter table public.b_events        enable row level security;
alter table public.b_lessons       enable row level security;
alter table public.b_announcements enable row level security;
alter table public.b_admins        enable row level security;
alter table public.b_inbound_log   enable row level security;

revoke all on public.b_profile, public.b_events, public.b_lessons, public.b_announcements,
              public.b_admins, public.b_inbound_log, public.b_customers, public.b_customer_summary
  from anon, authenticated;
revoke all on function public.b_register(text, text, text) from public, anon, authenticated;
grant execute on function public.b_register(text, text, text) to service_role;

-- 仮の教材とお知らせ（便 6a で学ぶくんの本物に置き換える）。シアニン用の画面に入れるメール
insert into public.b_lessons (id, sort, title, summary, minutes) values
  ('l01', 1, '第1回　言語化の入口：思ったことを 1 行にする', '頭の中のもやもやを 1 行に落とす練習。仮の教材です。', 12),
  ('l02', 2, '第2回　具体と抽象を往復する', '例を 3 つ出してから共通点を言う型。仮の教材です。', 15),
  ('l03', 3, '第3回　図にしてから書く', '箱と矢印で先に骨組みを作る。仮の教材です。', 18),
  ('l04', 4, '第4回　添削の受け方', '原文・添削後・コメントの 3 欄の読み方。仮の教材です。', 9)
on conflict (id) do nothing;

insert into public.b_announcements (title, body)
select '準備中です', 'このサイトは準備中です。教材は順に入れ替わります。'
where not exists (select 1 from public.b_announcements);

insert into public.b_admins (email) values ('gameister1@gmail.com') on conflict (email) do nothing;
