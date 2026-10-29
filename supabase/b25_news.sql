-- B の便 25：お知らせを会員サイト › お知らせで書く（2026-10-29 13:06 Naoki「OK」）。今のお知らせの表に欄を足す。何回流しても同じ結果になる。
--  status … published（出す）・draft（下書き）・withdrawn（取り下げ）。今ある行は全部 published なので、生徒の見え方は変わらない
--  生徒に出すのは status が published で published_at を過ぎたものだけ（src/news.js の newsQuery）
-- 戻し方：alter table public.b_announcements drop column status, drop column updated_at, drop column updated_by;
alter table public.b_announcements
  add column if not exists status text not null default 'published' check (status in ('published', 'draft', 'withdrawn')),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by text;
select count(*) as all_rows, count(*) filter (where status = 'published' and published_at <= now()) as shown from public.b_announcements;
