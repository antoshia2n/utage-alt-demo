-- 便B（2026-11-06）：会員サイトのコンテンツに「録画」の欄（録画の棚の id）。あれば生徒の画面は R2 から流す
alter table b_site_contents add column if not exists rec_id text;
-- b_site_rows の最後に t.rec_id を足した（create or replace view・ほかの欄はそのまま）
