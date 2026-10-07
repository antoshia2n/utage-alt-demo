-- utage-alt-demo 便1：台帳の芯（顧客 1 人 1 件＋出来事の記録）
-- 新しい Supabase プロジェクトの SQL Editor で 1 回流す。何回流しても同じ結果になる。
-- 表はすべて RLS を有効にし、ブラウザ（anon・authenticated）からは読めない。読み書きは Worker が秘密の鍵で行う。


-- 顧客の台帳（1 人 1 件）
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(email)),
  name          text not null default '',
  source        text not null default 'direct' check (source in ('x','note','youtube','direct','other')),
  note_member   boolean not null default false,
  consent_at    timestamptz,
  auth_user_id  uuid unique,
  created_at    timestamptz not null default now()
);

-- 出来事の記録（登録・ログイン・視聴・予約・開封・添削…を時系列で積む）
create table if not exists public.events (
  id           bigint generated always as identity primary key,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  type         text not null,
  payload      jsonb not null default '{}'::jsonb,
  actor        text not null default 'site' check (actor in ('site','admin','mcp','webhook','seed')),
  occurred_at  timestamptz not null default now()
);
create index if not exists events_customer_time on public.events (customer_id, occurred_at desc);
create index if not exists events_type_time on public.events (type, occurred_at desc);

-- 教材とお知らせ（ログインの面）
create table if not exists public.lessons (
  id          text primary key,
  sort        int not null default 0,
  title       text not null,
  summary     text not null default '',
  minutes     int not null default 0,
  youtube_id  text,
  published   boolean not null default true
);

create table if not exists public.announcements (
  id            bigint generated always as identity primary key,
  title         text not null,
  body          text not null default '',
  published_at  timestamptz not null default now()
);

-- シアニン用の画面に入れるメール
create table if not exists public.admins (
  email  text primary key check (email = lower(email))
);

-- 外から来た呼び出しの控え（受け取った中身と返事を 1 件ずつ）
create table if not exists public.inbound_log (
  id        bigint generated always as identity primary key,
  channel   text not null,
  request   jsonb not null default '{}'::jsonb,
  response  jsonb not null default '{}'::jsonb,
  status    int not null,
  at        timestamptz not null default now()
);
create index if not exists inbound_log_at on public.inbound_log (at desc);

-- ラベルと段階は記録から計算する（台帳に段階の列は持たない）
create or replace view public.customer_summary with (security_invoker = true) as
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
from public.customers c
left join public.events e on e.customer_id = c.id
group by c.id;

alter table public.customers     enable row level security;
alter table public.events        enable row level security;
alter table public.lessons       enable row level security;
alter table public.announcements enable row level security;
alter table public.admins        enable row level security;
alter table public.inbound_log   enable row level security;

revoke all on public.customers, public.events, public.lessons, public.announcements,
              public.admins, public.inbound_log, public.customer_summary
  from anon, authenticated;

-- 架空のデータ（何回流しても増えない）
insert into public.lessons (id, sort, title, summary, minutes) values
  ('l01', 1, '第1回　言語化の入口：思ったことを 1 行にする', '頭の中のもやもやを 1 行に落とす練習。デモ用の架空の教材です。', 12),
  ('l02', 2, '第2回　具体と抽象を往復する', '例を 3 つ出してから共通点を言う型。デモ用の架空の教材です。', 15),
  ('l03', 3, '第3回　図にしてから書く', '箱と矢印で先に骨組みを作る。デモ用の架空の教材です。', 18),
  ('l04', 4, '第4回　添削の受け方', '原文・添削後・コメントの 3 欄の読み方。デモ用の架空の教材です。', 9)
on conflict (id) do nothing;

insert into public.announcements (title, body, published_at)
select * from (values
  ('デモへようこそ', 'このサイトは架空のデータだけで動くデモです。登録やログインは自由に試せます。', now() - interval '2 days'),
  ('第4回の教材を追加しました', '添削の受け方の回です。（架空のお知らせ）', now() - interval '6 hours')
) v(title, body, published_at)
where not exists (select 1 from public.announcements);

insert into public.customers (email, name, source, note_member, consent_at, created_at) values
  ('sato.demo@example.com',     '佐藤 架空', 'x',       false, now() - interval '20 days', now() - interval '20 days'),
  ('suzuki.demo@example.com',   '鈴木 架空', 'note',    true,  now() - interval '15 days', now() - interval '15 days'),
  ('takahashi.demo@example.com','高橋 架空', 'youtube', false, now() - interval '12 days', now() - interval '12 days'),
  ('tanaka.demo@example.com',   '田中 架空', 'x',       false, now() - interval '9 days',  now() - interval '9 days'),
  ('ito.demo@example.com',      '伊藤 架空', 'note',    false, now() - interval '5 days',  now() - interval '5 days'),
  ('watanabe.demo@example.com', '渡辺 架空', 'direct',  false, now() - interval '3 days',  now() - interval '3 days'),
  ('yamamoto.demo@example.com', '山本 架空', 'youtube', false, now() - interval '1 days',  now() - interval '1 days'),
  ('nakamura.demo@example.com', '中村 架空', 'x',       false, now() - interval '4 hours', now() - interval '4 hours')
on conflict (email) do nothing;

insert into public.events (customer_id, type, payload, actor, occurred_at)
select c.id, v.type, v.payload::jsonb, 'seed', c.created_at + v.after
from public.customers c
join (values
  ('sato.demo@example.com',      'registered',    '{"source":"x"}',        interval '0'),
  ('sato.demo@example.com',      'login',         '{}',                    interval '10 minutes'),
  ('sato.demo@example.com',      'lesson_viewed', '{"lesson_id":"l01"}',   interval '15 minutes'),
  ('sato.demo@example.com',      'lesson_viewed', '{"lesson_id":"l02"}',   interval '2 days'),
  ('sato.demo@example.com',      'lesson_viewed', '{"lesson_id":"l03"}',   interval '6 days'),
  ('suzuki.demo@example.com',    'registered',    '{"source":"note"}',     interval '0'),
  ('suzuki.demo@example.com',    'note_member_set','{"value":true}',       interval '1 hour'),
  ('suzuki.demo@example.com',    'login',         '{}',                    interval '1 day'),
  ('suzuki.demo@example.com',    'lesson_viewed', '{"lesson_id":"l01"}',   interval '1 day 5 minutes'),
  ('takahashi.demo@example.com', 'registered',    '{"source":"youtube"}',  interval '0'),
  ('takahashi.demo@example.com', 'login',         '{}',                    interval '3 days'),
  ('tanaka.demo@example.com',    'registered',    '{"source":"x"}',        interval '0'),
  ('ito.demo@example.com',       'registered',    '{"source":"note"}',     interval '0'),
  ('ito.demo@example.com',       'login',         '{}',                    interval '30 minutes'),
  ('ito.demo@example.com',       'lesson_viewed', '{"lesson_id":"l01"}',   interval '40 minutes'),
  ('watanabe.demo@example.com',  'registered',    '{"source":"direct"}',   interval '0'),
  ('yamamoto.demo@example.com',  'registered',    '{"source":"youtube"}',  interval '0'),
  ('yamamoto.demo@example.com',  'login',         '{}',                    interval '2 hours'),
  ('nakamura.demo@example.com',  'registered',    '{"source":"x"}',        interval '0')
) v(email, type, payload, after) on v.email = c.email
where not exists (select 1 from public.events where actor = 'seed');

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from public.customers) as customers,
  (select count(*) from public.events)    as events,
  (select count(*) from public.lessons)   as lessons,
  (select count(*) from public.admins)    as admins;
