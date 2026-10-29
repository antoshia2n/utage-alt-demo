-- B の便 22：会員サイトの「公開のしかた」を生徒の画面で効かせる（2026-10-29 10:59 Naoki「OK」・会員サイトの管理画面のプルリク 1）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に流す。何回流しても同じ結果になる。表は変えない。見る表 2 本の中身と欄の足しだけ。
--  ・b_site_rows：下書き（draft）は出さない。日時を決めたもの（scheduled）は publish_at を過ぎてから出す。入会から日数で開くもの（drip）は出し、
--    人ごとに開くかはマーケくんのコード（src/learn.js）が b_site_member_access の opened_at と drip_days で決める。
--    欄を後ろに足す：minutes・toc・files・can_ask・status・publish_at・drip_days（生徒の画面で目次・資料・見る時間を出すため）
--  ・b_site_member_access：欄 opened_at（その人がそのプログラムを開けるようになった日＝権利を付けた日のいちばん早いもの）を後ろに足す
-- いまの 284 本は、学ぶくんで止めていたもの（active が false）だけが draft で、ほかは published。なので生徒の画面に出る行は変わらない（文 3 で確かめる）。
-- 戻し方：supabase/b21_site_shape.sql の 6. の 2 文を流し直す（足した欄は消せないので、見る表を drop してから作り直す）

-- 1. 生徒が読む教材の見る表
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
  p.owner,
  t.minutes,
  t.toc,
  t.files,
  t.can_ask,
  t.status,
  t.publish_at,
  t.drip_days
from public.b_site_content_courses cc
join public.b_site_contents t on t.id = cc.content_id and t.active
join public.b_site_courses c  on c.id = cc.course_id and c.active
join public.b_site_programs p on p.id = c.program_id and p.active
join public.b_site_sites s    on s.id = p.site_id and s.active
where (t.status = 'published' or t.status = 'drip' or (t.status = 'scheduled' and t.publish_at <= now()))
  and exists (
    select 1
    from public.b_site_curriculum_programs kp
    join public.b_site_curricula k on k.id = kp.curriculum_id and k.active
    join public.b_site_curriculum_rights r on r.curriculum_id = k.id
    where kp.program_id = p.id
  );

-- 2. 誰がどのプログラムを見られるか（opened_at を足す）
create or replace view public.b_site_member_access with (security_invoker = true) as
select me.member_id, kp.program_id as curriculum_id, min(me.granted_at) as opened_at
from public.member_entitlement me
join public.b_site_curriculum_rights r on r.entitlement_key = me.key
join public.b_site_curricula k on k.id = r.curriculum_id and k.active
join public.b_site_curriculum_programs kp on kp.curriculum_id = k.id
where me.expires_at is null or me.expires_at > now()
group by me.member_id, kp.program_id;

revoke all on public.b_site_rows, public.b_site_member_access from anon, authenticated;

-- 3. 確かめ（期待：rows 561・access 264・drafts_shown 0）
select
  (select count(*) from public.b_site_rows) as rows,
  (select count(*) from public.b_site_member_access) as access,
  (select count(*) from public.b_site_rows where status = 'draft') as drafts_shown;
