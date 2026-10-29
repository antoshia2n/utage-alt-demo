-- B の便 24：マイページをテンプレと部品で作る（2026-10-29 12:53 Naoki「OK」・デモ 8 版）。会員サイトのサイトの行に欄を足す。何回流しても同じ結果になる。
--  mypage      … 公開中のテンプレと部品の形（src/mypage.js の checkConfig の形）。空なら生徒にマイページは出ない
--  mypage_mode … blocks（テンプレと部品）／html（上級：ページと同じ表の HTML の版）。最後に公開した方
--  landing     … ログインしたあと最初に出す画面（mypage／lessons）
--  login       … ログイン画面の見た目（logo・color・msg）
-- 戻し方：alter table public.b_site_sites drop column mypage, drop column mypage_mode, drop column landing, drop column login;
alter table public.b_site_sites
  add column if not exists mypage jsonb,
  add column if not exists mypage_mode text not null default 'blocks' check (mypage_mode in ('blocks', 'html')),
  add column if not exists landing text not null default 'mypage' check (landing in ('mypage', 'lessons')),
  add column if not exists login jsonb not null default '{}'::jsonb;
select id, mypage is null as no_mypage, mypage_mode, landing, login from public.b_site_sites;
