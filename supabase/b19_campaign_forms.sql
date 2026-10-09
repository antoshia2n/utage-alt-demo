-- B の便 19：フォームも企画に入れられるようにする（2026-10-09 Naoki「進めて」）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。新しい表は無い。
-- 変えるもの：b_campaign_parts の part_type の決まりに 'form' を足す（いまある 9 種類はそのまま）
-- 戻し方：alter table public.b_campaign_parts drop constraint b_campaign_parts_part_type_check;
--         alter table public.b_campaign_parts add constraint b_campaign_parts_part_type_check
--           check (part_type in ('page','step','broadcast','seminar','booking','product','course','room','community'));
--         （先に part_type = 'form' の行を消しておく）

alter table public.b_campaign_parts drop constraint if exists b_campaign_parts_part_type_check;
alter table public.b_campaign_parts add constraint b_campaign_parts_part_type_check
  check (part_type in ('page','step','broadcast','seminar','booking','product','course','room','community','form'));

-- 確かめ（この 1 行だけが結果に出る）。part_type の決まりがすべて form を含んでいれば true
select bool_and(pg_get_constraintdef(oid) like '%''form''%') as form_ok
from pg_constraint
where conrelid = 'public.b_campaign_parts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%part_type%';
