-- B の便 23：マイページ（2026-10-29 11:42 Naoki「OK」）。ページの表 b_pages の目的に mypage を足す。
-- マイページはページと同じ表・同じ版で持ち、作る画面は会員サイト › マイページに分ける（src/mypage.js）。何回流しても同じ結果になる。
-- 戻し方：目的が mypage の行を消してから、b13_seminars.sql の 2 文（目的の決まり）を流し直す
alter table public.b_pages drop constraint if exists b_pages_purpose_check;
alter table public.b_pages add constraint b_pages_purpose_check check (purpose in ('signup','seminar','sale','news','thanks','mypage'));
select pg_get_constraintdef(oid) as purpose_rule from pg_constraint where conname = 'b_pages_purpose_check' and conrelid = 'public.b_pages'::regclass;
