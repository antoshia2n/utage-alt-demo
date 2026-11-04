-- 生徒のホームと図書館の 3 本目（2026-11-04 Naoki OK）：コンテンツの種類と、版ごとのホームの段の並び。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に、上から 1 文ずつ流す。何回流しても同じ結果になる。
-- プルリクを結合する「前」に流す（新しいコードが kind と home_rows を読むため）。
-- 戻し方：見る表は b22_site_publish.sql の形に戻す（kind の列を外す）。足した 2 つの列は残しても害はない。

-- 1. コンテンツの種類（空なら、生徒の画面がプログラムとコースから決める）
alter table public.b_site_contents add column if not exists kind text;
alter table public.b_site_contents drop constraint if exists b_site_contents_kind_check;
alter table public.b_site_contents add constraint b_site_contents_kind_check
  check (kind is null or kind in ('セミナー', 'アーカイブ', '動画講座', '記事', 'note記事', 'メンシプ限定'));

-- 2. 版ごとのホームの段の並び（空なら、生徒の画面の決まった並び）
alter table public.b_site_sites add column if not exists home_rows jsonb;

-- 3. 生徒が読む見る表に種類を足す（今の定義 2026-11-04 の pg_get_viewdef をそのまま写し、最後に t.kind を 1 列足しただけ）
create or replace view public.b_site_rows with (security_invoker = true) as
select
  p.id AS curriculum_id, p.id AS program_id, p.title AS program_title, p.sort AS program_sort,
  c.id AS course_id, c.title AS course_title, c.sort AS course_sort, t.id AS lesson_id, cc.sort, t.title,
  COALESCE(t.summary, ''::text) AS summary,
  COALESCE(substring(t.video_url, 'v=([A-Za-z0-9_-]{11})'::text), substring(t.body, '\{\{youtube:([A-Za-z0-9_-]{11})\}\}'::text), substring(t.body, 'youtube\.com/watch\?(?:[^\s)]*&)?v=([A-Za-z0-9_-]{11})'::text), substring(t.body, 'youtu\.be/([A-Za-z0-9_-]{11})'::text), substring(t.body, 'youtube\.com/(?:embed|live|shorts)/([A-Za-z0-9_-]{11})'::text)) AS youtube_id,
  TRIM(BOTH FROM substring(t.body, '\[マインドマップ\]\(([^)]+)\)'::text)) AS mindmap_url,
  p.owner, t.minutes, t.toc, t.files, t.can_ask, t.status, t.publish_at, t.drip_days,
  t.kind
from public.b_site_content_courses cc
  join public.b_site_contents t on t.id = cc.content_id and t.active
  join public.b_site_courses c on c.id = cc.course_id and c.active
  join public.b_site_programs p on p.id = c.program_id and p.active
  join public.b_site_sites s on s.id = p.site_id and s.active
where (t.status = 'published' or t.status = 'drip' or (t.status = 'scheduled' and t.publish_at <= now()))
  and exists (select 1 from public.b_site_curriculum_programs kp
    join public.b_site_curricula k on k.id = kp.curriculum_id and k.active
    join public.b_site_curriculum_rights r on r.curriculum_id = k.id
    where kp.program_id = p.id);

-- 4. 確かめ：生徒の画面に出る行の数が変わっていないこと（流す前は 561）
select count(*) as rows_now from public.b_site_rows;
