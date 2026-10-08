-- B の便 6a：学ぶくんの本物の教材を B から読む（写さない。見る表を 2 本置くだけ）
-- 本番のプロジェクト htzadzpckcpdrmpjvaut の SQL Editor に貼って実行する。何度流しても同じ結果になる。
-- 学ぶくんの表（mn_）には列も方針も足さない。学ぶくんの画面はこれまでどおり動く。

-- 1. 学ぶくんの表がこのプロジェクトにあるかを先に確かめる（無ければここで止まり、何も作らない）
do $$
begin
  if to_regclass('public.mn_contents') is null
     or to_regclass('public.mn_content_courses') is null
     or to_regclass('public.mn_courses') is null
     or to_regclass('public.mn_programs') is null
     or to_regclass('public.mn_curriculums') is null
     or to_regclass('public.mn_curriculum_programs') is null
     or to_regclass('public.mn_member_curriculums') is null then
    raise exception 'mn_tables_missing：学ぶくんの表がこのプロジェクトにありません。開発部へ返してください';
  end if;
end $$;

-- 2. 見る表 b_mn_lessons：公開中のカリキュラム → プログラム → コース → コンテンツを 1 行ずつ
--    所属は mn_content_courses と mn_contents.course_id の両方から引き、同じ組は 1 回だけ（学ぶくんの画面と同じ道すじ）
--    動画の番号は本文の {{youtube:番号}} か YouTube の住所から、マインドマップは本文の [マインドマップ](住所) から取る
create or replace view public.b_mn_lessons with (security_invoker = true) as
with links as (
  select distinct on (content_id, course_id) content_id::text as content_id, course_id::text as course_id, order_index
  from (
    select cc.content_id, cc.course_id, cc.order_index, 0 as pri from public.mn_content_courses cc
    union all
    select c.id, c.course_id, c.order_index, 1 from public.mn_contents c where c.course_id is not null
  ) u
  order by content_id, course_id, pri
)
select
  cur.id::text           as curriculum_id,
  p.id::text             as program_id,
  p.title                as program_title,
  cp.order_index         as program_sort,
  co.id::text            as course_id,
  co.title               as course_title,
  co.order_index         as course_sort,
  c.id::text             as lesson_id,
  coalesce(l.order_index, c.order_index, 0) as sort,
  c.title,
  coalesce(c.description, '') as summary,
  coalesce(
    substring(c.body_markdown from '\{\{youtube:([A-Za-z0-9_-]{11})\}\}'),
    substring(c.body_markdown from 'youtube\.com/watch\?(?:[^\s)]*&)?v=([A-Za-z0-9_-]{11})'),
    substring(c.body_markdown from 'youtu\.be/([A-Za-z0-9_-]{11})'),
    substring(c.body_markdown from 'youtube\.com/(?:embed|live|shorts)/([A-Za-z0-9_-]{11})')
  )                      as youtube_id,
  trim(substring(c.body_markdown from '\[マインドマップ\]\(([^)]+)\)')) as mindmap_url
from links l
join public.mn_contents c             on c.id::text = l.content_id and c.active
join public.mn_courses co             on co.id::text = l.course_id and co.active
join public.mn_programs p             on p.id = co.program_id and p.active
join public.mn_curriculum_programs cp on cp.program_id = p.id
join public.mn_curriculums cur        on cur.id = cp.curriculum_id and cur.active;

-- 3. 見る表 b_mn_access：誰がどのカリキュラムを見られるか（学ぶくんの受講の結びをそのまま使う）
--    結びは新しい番号（member.id）と旧の番号（member.legacy_shr_id）のどちらでも入っているので両方で当てる
create or replace view public.b_mn_access with (security_invoker = true) as
select distinct m.id as member_id, mc.curriculum_id::text as curriculum_id
from public.member m
join public.mn_member_curriculums mc
  on mc.active
 and (mc.member_id::text = m.id::text or (m.legacy_shr_id is not null and mc.member_id::text = m.legacy_shr_id::text));

revoke all on public.b_mn_lessons, public.b_mn_access from anon, authenticated;

-- 4. 仮の教材 4 本（便 2 で入れた l01〜l04）は生徒の画面に出さない（行は消さない）
update public.b_lessons set published = false where id in ('l01', 'l02', 'l03', 'l04');

-- 5. AI の道具を 2 つ足す（どちらも読むだけなので自動）
insert into public.b_permissions (tool, mode, note) values
  ('list_lessons',      'auto', '読む'),
  ('list_corrections',  'auto', '読む')
on conflict (tool) do nothing;

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from public.b_mn_lessons)                                       as rows,
  (select count(distinct lesson_id) from public.b_mn_lessons)                      as lessons,
  (select count(distinct lesson_id) from public.b_mn_lessons where youtube_id is not null)  as with_video,
  (select count(distinct lesson_id) from public.b_mn_lessons where mindmap_url is not null) as with_mindmap,
  (select count(*) from public.b_mn_access)                                        as access,
  (select count(*) from public.b_lessons where published)                          as placeholder_published,
  (select count(*) from public.b_permissions)                                      as permissions,
  has_table_privilege('anon', 'public.b_mn_lessons', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_mn_access', 'SELECT')       as browser_can_read;
