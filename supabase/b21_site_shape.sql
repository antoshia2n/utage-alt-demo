-- B の便 21：会員サイトの表を「サイト › カリキュラム › プログラム › コース › コンテンツ」の形にする（2026-10-29 10:40 Naoki「OK」・会員サイトとマイページの 2 回目）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に、上から 1 文ずつ流す。何回流しても同じ結果になる。
-- 学ぶくんの表（mn_）には書かない。読むだけ。マーケくんのコードは変えない（読む見る表 b_site_rows・b_site_member_access の名前と欄はそのまま）。
-- 名前を学ぶくんにそろえる：b_site_courses → b_site_programs、b_site_chapters → b_site_courses、b_site_lessons → b_site_contents、
--   b_site_lesson_chapters → b_site_content_courses。番号（id）は変えない。
-- 足す表：b_site_sites（サイト）・b_site_curricula（カリキュラム）・b_site_curriculum_programs（カリキュラムに並ぶプログラム）・
--   b_site_curriculum_rights（カリキュラムを開ける権利）。権利は「権利 × プログラム」（b_site_access）から「権利 × カリキュラム」へ移す。
-- コンテンツに足す欄：公開のしかた status（published すぐ公開／draft 下書き／scheduled 日時を決めて公開／drip 入会から日数で開く）・
--   publish_at・drip_days・minutes（見る時間のめやす）・video_url・toc（目次）・files（資料）・can_complete（見終わったボタン）・can_ask（質問）。
--   この便では生徒の画面の出し方は変えない（公開のしかたで出し分けるのは管理画面の便で入れる）。
-- 戻し方（文 29 を流す前なら）：
--   1 見る表を便 20 の形（supabase/b20_site.sql の 3.）に戻す。表の名前は付け替えたあとのもので書き直す
--   2 drop table public.b_site_curriculum_rights, public.b_site_curriculum_programs, public.b_site_curricula;
--     alter table public.b_site_programs drop column site_id; drop table public.b_site_sites;
--   3 名前を逆に付け替える（b_site_content_courses → b_site_lesson_chapters など）。足した欄は残しても害はない

-- 1. 今の生徒の画面を控える（最後に比べるため。文 29 で消す）
create table if not exists public.b21_snap_rows as select * from public.b_site_rows;

create table if not exists public.b21_snap_access as select * from public.b_site_member_access;

-- 2. 名前を学ぶくんにそろえる（もう付け替えてあれば何もしない）
do $$
begin
  if to_regclass('public.b_site_lessons') is not null then
    alter table public.b_site_courses rename to b_site_programs;
    alter table public.b_site_chapters rename to b_site_courses;
    alter table public.b_site_courses rename column course_id to program_id;
    alter table public.b_site_lessons rename to b_site_contents;
    alter table public.b_site_lesson_chapters rename to b_site_content_courses;
    alter table public.b_site_content_courses rename column lesson_id to content_id;
    alter table public.b_site_content_courses rename column chapter_id to course_id;
    alter table public.b_site_access rename column course_id to program_id;
  end if;
end $$;

-- 3. サイト
create table if not exists public.b_site_sites (
  id text primary key,
  owner text not null default 'shia2n',
  name text not null,
  description text,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.b_site_sites (id, name, description, sort, updated_by)
values ('shiarabo', 'しあらぼ', 'しあらぼの生徒が学ぶ場所', 0, 'b21')
on conflict (id) do nothing;

alter table public.b_site_programs add column if not exists site_id text references public.b_site_sites(id);

update public.b_site_programs set site_id = 'shiarabo' where site_id is null;

alter table public.b_site_programs alter column site_id set not null;

-- 4. カリキュラム（学ぶくんの 2 本を写す。番号はそのまま）
create table if not exists public.b_site_curricula (
  id text primary key,
  owner text not null default 'shia2n',
  site_id text not null references public.b_site_sites(id),
  title text not null,
  description text,
  thumbnail_url text,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.b_site_curricula (id, site_id, title, description, thumbnail_url, sort, active, created_at, updated_at, updated_by)
select k.id::text, 'shiarabo', k.title, k.description, k.thumbnail_url, coalesce(k.order_index, 0), k.active, k.created_at, k.updated_at, 'b21'
from public.mn_curriculums k
on conflict (id) do nothing;

create table if not exists public.b_site_curriculum_programs (
  owner text not null default 'shia2n',
  curriculum_id text not null references public.b_site_curricula(id),
  program_id text not null references public.b_site_programs(id),
  sort integer not null default 0,
  primary key (curriculum_id, program_id)
);

insert into public.b_site_curriculum_programs (curriculum_id, program_id, sort)
select cp.curriculum_id::text, cp.program_id::text, coalesce(cp.order_index, 0)
from public.mn_curriculum_programs cp
join public.b_site_curricula k on k.id = cp.curriculum_id::text
join public.b_site_programs p on p.id = cp.program_id::text
on conflict (curriculum_id, program_id) do nothing;

create table if not exists public.b_site_curriculum_rights (
  owner text not null default 'shia2n',
  curriculum_id text not null references public.b_site_curricula(id),
  entitlement_key text not null,
  created_at timestamptz not null default now(),
  primary key (curriculum_id, entitlement_key)
);

--    しあらぼのカリキュラムは shiarabo_basic で開く（便 20 の b_site_access と同じ権利）
insert into public.b_site_curriculum_rights (curriculum_id, entitlement_key)
values ('8c169817-2b7d-4f57-b644-80ad6471214a', 'shiarabo_basic')
on conflict (curriculum_id, entitlement_key) do nothing;

alter table public.b_site_sites enable row level security;

alter table public.b_site_curricula enable row level security;

alter table public.b_site_curriculum_programs enable row level security;

alter table public.b_site_curriculum_rights enable row level security;

revoke all on public.b_site_sites, public.b_site_curricula, public.b_site_curriculum_programs, public.b_site_curriculum_rights from anon, authenticated;

-- 5. コンテンツに欄を足す
alter table public.b_site_contents
  add column if not exists status text not null default 'published' check (status in ('published', 'draft', 'scheduled', 'drip')),
  add column if not exists publish_at timestamptz,
  add column if not exists drip_days integer check (drip_days is null or drip_days >= 0),
  add column if not exists minutes integer check (minutes is null or minutes >= 0),
  add column if not exists video_url text,
  add column if not exists toc jsonb not null default '[]'::jsonb,
  add column if not exists files jsonb not null default '[]'::jsonb,
  add column if not exists can_complete boolean not null default true,
  add column if not exists can_ask boolean not null default true;

--    学ぶくんで止めていたものは「下書き」にそろえる
update public.b_site_contents set status = 'draft' where not active and status = 'published';

--    動画の住所を本文から取り出して欄へ入れる（本文はそのまま）
update public.b_site_contents
set video_url = 'https://www.youtube.com/watch?v=' || coalesce(
    substring(body from '\{\{youtube:([A-Za-z0-9_-]{11})\}\}'),
    substring(body from 'youtube\.com/watch\?(?:[^\s)]*&)?v=([A-Za-z0-9_-]{11})'),
    substring(body from 'youtu\.be/([A-Za-z0-9_-]{11})'),
    substring(body from 'youtube\.com/(?:embed|live|shorts)/([A-Za-z0-9_-]{11})'))
where video_url is null
  and coalesce(
    substring(body from '\{\{youtube:([A-Za-z0-9_-]{11})\}\}'),
    substring(body from 'youtube\.com/watch\?(?:[^\s)]*&)?v=([A-Za-z0-9_-]{11})'),
    substring(body from 'youtu\.be/([A-Za-z0-9_-]{11})'),
    substring(body from 'youtube\.com/(?:embed|live|shorts)/([A-Za-z0-9_-]{11})')) is not null;

-- 6. 生徒が読む見る表 2 本を、権利 × カリキュラムから引く形に替える（名前と欄はそのまま。curriculum_id の欄にはプログラムの番号が入る）
create or replace view public.b_site_rows with (security_invoker = true) as
select
  p.id                   as curriculum_id,
  p.id                   as program_id,
  p.title                as program_title,
  p.sort                 as program_sort,
  c.id                   as course_id,
  c.title                as course_title,
  c.sort                 as course_sort,
  t.id                   as lesson_id,
  cc.sort                as sort,
  t.title,
  coalesce(t.summary, '') as summary,
  coalesce(
    substring(t.video_url from 'v=([A-Za-z0-9_-]{11})'),
    substring(t.body from '\{\{youtube:([A-Za-z0-9_-]{11})\}\}'),
    substring(t.body from 'youtube\.com/watch\?(?:[^\s)]*&)?v=([A-Za-z0-9_-]{11})'),
    substring(t.body from 'youtu\.be/([A-Za-z0-9_-]{11})'),
    substring(t.body from 'youtube\.com/(?:embed|live|shorts)/([A-Za-z0-9_-]{11})')
  )                      as youtube_id,
  trim(substring(t.body from '\[マインドマップ\]\(([^)]+)\)')) as mindmap_url,
  p.owner
from public.b_site_content_courses cc
join public.b_site_contents t on t.id = cc.content_id and t.active
join public.b_site_courses c  on c.id = cc.course_id and c.active
join public.b_site_programs p on p.id = c.program_id and p.active
join public.b_site_sites s    on s.id = p.site_id and s.active
where exists (
  select 1
  from public.b_site_curriculum_programs kp
  join public.b_site_curricula k on k.id = kp.curriculum_id and k.active
  join public.b_site_curriculum_rights r on r.curriculum_id = k.id
  where kp.program_id = p.id
);

create or replace view public.b_site_member_access with (security_invoker = true) as
select distinct me.member_id, kp.program_id as curriculum_id
from public.member_entitlement me
join public.b_site_curriculum_rights r on r.entitlement_key = me.key
join public.b_site_curricula k on k.id = r.curriculum_id and k.active
join public.b_site_curriculum_programs kp on kp.curriculum_id = k.id
where me.expires_at is null or me.expires_at > now();

revoke all on public.b_site_rows, public.b_site_member_access from anon, authenticated;

-- 7. 確かめ
--    件数（期待：sites 1・curricula 2・curriculum_programs 11・rights 1・programs 12・contents 284・programs_without_site 0）
select
  (select count(*) from public.b_site_sites) as sites,
  (select count(*) from public.b_site_curricula) as curricula,
  (select count(*) from public.b_site_curriculum_programs) as curriculum_programs,
  (select count(*) from public.b_site_curriculum_rights) as rights,
  (select count(*) from public.b_site_programs) as programs,
  (select count(*) from public.b_site_contents) as contents,
  (select count(*) from public.b_site_programs where site_id is null) as programs_without_site,
  (select count(*) from public.b_site_contents where video_url is not null) as with_video;

--    生徒の画面に出る行：控えと今の差（期待：両向きとも 0）
select
  (select count(*) from (select * from public.b21_snap_rows except select * from public.b_site_rows) x) as only_before,
  (select count(*) from (select * from public.b_site_rows except select * from public.b21_snap_rows) y) as only_after;

--    見られる人：控えと今の差（期待：両向きとも 0）
select
  (select count(*) from (select * from public.b21_snap_access except select * from public.b_site_member_access) x) as lose,
  (select count(*) from (select * from public.b_site_member_access except select * from public.b21_snap_access) y) as gain;

-- 8. 片づけ（文 27・28 が両向きとも 0 のときだけ流す）：控えの表 2 本と、使わなくなった権利 × プログラムの表を消す
drop table if exists public.b21_snap_rows, public.b21_snap_access, public.b_site_access;
