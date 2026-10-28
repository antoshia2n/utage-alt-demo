-- B の便 20：会員サイトの表を作り、学ぶくんの教材を写す（2026-10-29 Naoki「OK」・会員サイトとマイページの 1 回目）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に、上から 1 文ずつ流す。何回流しても同じ結果になる。
-- 学ぶくんの表（mn_）には書かない。読むだけ。学ぶくんの画面はこれまでどおり動く。
-- 表 5 本はすべて「事業者の印」owner を持つ（今は全部 'shia2n'）。今ある顧客や商品の表には印を付けない。
-- 見られる人は「権利 × コース」の表 b_site_access で決める（学ぶくんの受講の結び mn_member_curriculums は使わない）。
-- 学ぶくんの「プログラム → コース → コンテンツ」を、会員サイトでは「コース → 章 → レッスン」と呼ぶ。番号（id）は学ぶくんのものをそのまま使う
-- （見た記録・質問・メモの lesson_id がそのまま当たるようにするため）。
-- 戻し方：コードを前の版へ戻し（B_TABLES の 2 行）、下の 7 つを消す。
--   drop view public.b_site_member_access; drop view public.b_site_rows;
--   drop table public.b_site_access; drop table public.b_site_lesson_chapters; drop table public.b_site_lessons;
--   drop table public.b_site_chapters; drop table public.b_site_courses;

-- 0. 止める確かめ：いま教材を見られる人のうち、shiarabo_basic の生きた権利を持たない人の数（0 でなければ先へ進まない）
select count(distinct a.member_id) as would_lose
from public.b_mn_access a
where not exists (
  select 1 from public.member_entitlement me
  where me.member_id::text = a.member_id::text and me.key = 'shiarabo_basic' and (me.expires_at is null or me.expires_at > now())
);

-- 1. 表を作る
create table if not exists public.b_site_courses (
  id text primary key,
  owner text not null default 'shia2n',
  title text not null,
  description text,
  thumbnail_url text,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists public.b_site_chapters (
  id text primary key,
  owner text not null default 'shia2n',
  course_id text not null references public.b_site_courses(id),
  title text not null,
  description text,
  thumbnail_url text,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists public.b_site_lessons (
  id text primary key,
  owner text not null default 'shia2n',
  title text not null,
  summary text,
  body text,
  content_type text,
  thumbnail_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists public.b_site_lesson_chapters (
  owner text not null default 'shia2n',
  lesson_id text not null references public.b_site_lessons(id),
  chapter_id text not null references public.b_site_chapters(id),
  sort integer not null default 0,
  primary key (lesson_id, chapter_id)
);
create table if not exists public.b_site_access (
  owner text not null default 'shia2n',
  entitlement_key text not null,
  course_id text not null references public.b_site_courses(id),
  created_at timestamptz not null default now(),
  primary key (entitlement_key, course_id)
);
alter table public.b_site_courses enable row level security;
alter table public.b_site_chapters enable row level security;
alter table public.b_site_lessons enable row level security;
alter table public.b_site_lesson_chapters enable row level security;
alter table public.b_site_access enable row level security;
revoke all on public.b_site_courses, public.b_site_chapters, public.b_site_lessons, public.b_site_lesson_chapters, public.b_site_access from anon, authenticated;

-- 2. 写す（学ぶくんの行は全部。止めている行も active のまま写す）
--    コースの並び：しあらぼのカリキュラムでの並び（0〜10）。カリキュラムに無いもの（言語化ライティングカレッジ）は 100＋元の並び
insert into public.b_site_courses (id, title, description, thumbnail_url, sort, active, created_at, updated_at, updated_by)
select p.id::text, p.title, p.description, p.thumbnail_url, coalesce(cp.order_index, 100 + coalesce(p.order_index, 0)), p.active, p.created_at, p.updated_at, 'b20'
from public.mn_programs p
left join public.mn_curriculum_programs cp on cp.program_id = p.id and cp.curriculum_id = '8c169817-2b7d-4f57-b644-80ad6471214a'
on conflict (id) do nothing;

insert into public.b_site_chapters (id, course_id, title, description, thumbnail_url, sort, active, created_at, updated_at, updated_by)
select c.id::text, c.program_id::text, c.title, c.description, c.thumbnail_url, coalesce(c.order_index, 0), c.active, c.created_at, c.updated_at, 'b20'
from public.mn_courses c
where c.program_id is not null
on conflict (id) do nothing;

insert into public.b_site_lessons (id, title, summary, body, content_type, thumbnail_url, active, created_at, updated_at, updated_by)
select c.id::text, c.title, c.description, c.body_markdown, c.content_type, c.thumbnail_url, c.active, c.created_at, c.updated_at, 'b20'
from public.mn_contents c
on conflict (id) do nothing;

--    レッスンと章の結び：学ぶくんの見る表 b_mn_lessons と同じ道すじ（mn_content_courses と mn_contents.course_id の両方・同じ組は 1 回）
insert into public.b_site_lesson_chapters (lesson_id, chapter_id, sort)
select l.content_id, l.course_id, coalesce(l.order_index, c.order_index, 0)
from (
  select distinct on (content_id, course_id) content_id::text as content_id, course_id::text as course_id, order_index
  from (
    select cc.content_id, cc.course_id, cc.order_index, 0 as pri from public.mn_content_courses cc
    union all
    select c.id, c.course_id, c.order_index, 1 from public.mn_contents c where c.course_id is not null
  ) u
  order by content_id, course_id, pri
) l
join public.mn_contents c on c.id::text = l.content_id
join public.b_site_chapters ch on ch.id = l.course_id
on conflict (lesson_id, chapter_id) do nothing;

--    開ける権利：しあらぼのカリキュラムに入っているコース 11 本を shiarabo_basic で開ける
insert into public.b_site_access (entitlement_key, course_id)
select 'shiarabo_basic', cp.program_id::text
from public.mn_curriculum_programs cp
where cp.curriculum_id = '8c169817-2b7d-4f57-b644-80ad6471214a'
on conflict (entitlement_key, course_id) do nothing;

-- 3. マーケくんが読む見る表 2 本（いまの b_mn_lessons・b_mn_access と同じ形。curriculum_id の欄にはコースの番号が入る）
--    b_site_rows：開ける権利が 1 つ以上あるコースだけを出す（いまの生徒の画面と同じ範囲）
create or replace view public.b_site_rows with (security_invoker = true) as
select
  co.id                  as curriculum_id,
  co.id                  as program_id,
  co.title               as program_title,
  co.sort                as program_sort,
  ch.id                  as course_id,
  ch.title               as course_title,
  ch.sort                as course_sort,
  l.id                   as lesson_id,
  lc.sort                as sort,
  l.title,
  coalesce(l.summary, '') as summary,
  coalesce(
    substring(l.body from '\{\{youtube:([A-Za-z0-9_-]{11})\}\}'),
    substring(l.body from 'youtube\.com/watch\?(?:[^\s)]*&)?v=([A-Za-z0-9_-]{11})'),
    substring(l.body from 'youtu\.be/([A-Za-z0-9_-]{11})'),
    substring(l.body from 'youtube\.com/(?:embed|live|shorts)/([A-Za-z0-9_-]{11})')
  )                      as youtube_id,
  trim(substring(l.body from '\[マインドマップ\]\(([^)]+)\)')) as mindmap_url,
  co.owner
from public.b_site_lesson_chapters lc
join public.b_site_lessons l  on l.id = lc.lesson_id and l.active
join public.b_site_chapters ch on ch.id = lc.chapter_id and ch.active
join public.b_site_courses co  on co.id = ch.course_id and co.active
where exists (select 1 from public.b_site_access a where a.course_id = co.id);

--    b_site_member_access：誰がどのコースを見られるか（門番の表の生きた権利 × b_site_access）
create or replace view public.b_site_member_access with (security_invoker = true) as
select distinct me.member_id, a.course_id as curriculum_id
from public.member_entitlement me
join public.b_site_access a on a.entitlement_key = me.key
where me.expires_at is null or me.expires_at > now();

revoke all on public.b_site_rows, public.b_site_member_access from anon, authenticated;

-- 4. 確かめ
--    件数：写す前と後（左が学ぶくん、右が会員サイト）
select
  (select count(*) from public.mn_programs)  as programs,  (select count(*) from public.b_site_courses)  as courses,
  (select count(*) from public.mn_courses)   as mn_courses, (select count(*) from public.b_site_chapters) as chapters,
  (select count(*) from public.mn_contents)  as contents,  (select count(*) from public.b_site_lessons)  as lessons,
  (select count(*) from public.b_site_lesson_chapters) as links,
  (select count(*) from public.b_site_access) as access;

--    生徒の画面に出る行：いまの見る表と新しい見る表の差（両向きとも 0 なら同じ）
select
  (select count(*) from (
     select program_id, course_id, lesson_id, title, summary, youtube_id, mindmap_url from public.b_mn_lessons
     except
     select program_id, course_id, lesson_id, title, summary, youtube_id, mindmap_url from public.b_site_rows) x) as only_old,
  (select count(*) from (
     select program_id, course_id, lesson_id, title, summary, youtube_id, mindmap_url from public.b_site_rows
     except
     select program_id, course_id, lesson_id, title, summary, youtube_id, mindmap_url from public.b_mn_lessons) y) as only_new;

--    見られる人：いまの見る表と新しい見る表の差（両向きとも 0 なら同じ人）
select
  (select count(*) from (select member_id::text from public.b_mn_access except select member_id::text from public.b_site_member_access) x) as lose,
  (select count(*) from (select member_id::text from public.b_site_member_access except select member_id::text from public.b_mn_access) y) as gain;
