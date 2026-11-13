-- 実績の便 1（2026-11-13 Naoki OK 16:50）：実績の棚。自分の実績と、生徒・お客さんの実績を 1 か所に集める。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。読み書きは Worker が秘密の鍵で行う。
--  ・b_results：実績 1 件 1 行。証拠は画像（R2 の IMAGES の箱の results/）かポストのリンク（link_url）か両方
--  ・whose：me（自分＝シアニン）／person（生徒・お客さん）。person_id は顧客（member）への結び（空でよい）
--  ・folder：「自分の実績」「生徒・お客さんの実績」の下のフォルダの名前。空＝受け箱（AI が迷ったもの）
--  ・publish：載せてよい範囲。unknown＝まだ聞いていない（載せない扱い）／name＝名前を出してよい／anon＝名前を伏せれば／no＝載せない
--    AI は決めない（入るときは必ず unknown）
--  ・ai：AI の仕分け。none（まだ）／done（仕分けた）／unsure（迷った＝受け箱）／failed（読めなかった）。ai_note に AI の一言
--  ・フォルダの並び（空のフォルダも）は表 b_settings の 1 行（key=results_folders）に置く
-- 戻し方：drop table public.b_results;（R2 の results/ は残るので、要らなければ別に消す）
create table if not exists public.b_results (
  id           uuid primary key default gen_random_uuid(),
  whose        text not null default 'person' check (whose in ('me','person')),
  folder       text not null default '' check (char_length(folder) <= 60),
  title        text not null default '' check (char_length(title) <= 200),
  who_name     text not null default '' check (char_length(who_name) <= 80),
  person_id    uuid references public.member(id) on delete set null,
  achieved_on  date,
  quote        text not null default '' check (char_length(quote) <= 1000),
  labels       text[] not null default '{}',
  publish      text not null default 'unknown' check (publish in ('unknown','name','anon','no')),
  r2_key       text unique,
  content_type text not null default '' check (char_length(content_type) <= 100),
  size         bigint not null default 0,
  link_url     text check (link_url is null or char_length(link_url) <= 500),
  source       text not null default 'upload' check (source in ('upload','link','drive','panel','mcp')),
  ai           text not null default 'none' check (ai in ('none','done','unsure','failed')),
  ai_note      text not null default '' check (char_length(ai_note) <= 500),
  ai_text      text not null default '' check (char_length(ai_text) <= 4000),
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default '',
  check (r2_key is not null or link_url is not null)
);
create index if not exists b_results_created on public.b_results (created_at desc);
create index if not exists b_results_folder on public.b_results (whose, folder);
create index if not exists b_results_person on public.b_results (person_id);
alter table public.b_results enable row level security;
revoke all on public.b_results from anon, authenticated;

-- 2026-11-13 17:40 Naoki OK：AI の成果の欄は「案」。人が詳細で保存すると checked=true（確かめ済み）になり、AI は成果・誰・いつ・本人の言葉を書き換えない。
-- LP・ブログの部品にできるのは確かめ済みだけ（実績の便 3）。戻し方：alter table public.b_results drop column checked;
alter table public.b_results add column if not exists checked boolean not null default false;
