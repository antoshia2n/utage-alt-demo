-- 個別相談の予約を、生徒にも生徒以外にも使える形にする（2026-11-05 Naoki OK）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。欄を足すだけ（今の種類の動きは変わらない）。
--   audience       … 誰が予約できるか。public＝ページに置く（名前とメールで予約）／member＝マイページ（ログインした会員）
--   entitlements   … member のとき、どの権利の人が予約できるか（空なら管理者だけ）
--   questions      … 予約のときに聞く質問（[{key,label,kind:text|textarea,required,hint}]・12 問まで）
--   after_actions  … 予約のあとに書く先（shr_next_mtg＝しあらぼ管理のその生徒の「次の面談」）
-- 戻し方：alter table public.b_booking_types drop column audience, drop column entitlements, drop column questions, drop column after_actions;

alter table public.b_booking_types add column if not exists audience text not null default 'public';
alter table public.b_booking_types add column if not exists entitlements text[] not null default '{}';
alter table public.b_booking_types add column if not exists questions jsonb not null default '[]'::jsonb;
alter table public.b_booking_types add column if not exists after_actions text[] not null default '{}';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'b_booking_types_audience_chk') then
    alter table public.b_booking_types add constraint b_booking_types_audience_chk check (audience in ('public', 'member'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'b_booking_types_questions_chk') then
    alter table public.b_booking_types add constraint b_booking_types_questions_chk check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 12);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'b_booking_types_after_chk') then
    alter table public.b_booking_types add constraint b_booking_types_after_chk check (after_actions <@ '{shr_next_mtg}'::text[]);
  end if;
end $$;

-- 2026-11-05 夜（予約メニュー 1 便目・デモ v5 に Naoki OK）：基本設定と公開範囲の欄を足す。欄を足すだけ
--   description     … 説明（予約画面の左に表示・1000 字まで）
--   color           … 色（一覧とカレンダーで区別・#rrggbb か空）
--   allowed_members … 個別に許可するユーザー（顧客の番号・200 人まで）。会員プランの条件と「または」
-- 戻し方：alter table public.b_booking_types drop column description, drop column color, drop column allowed_members;
alter table public.b_booking_types add column if not exists description text not null default '';
alter table public.b_booking_types add column if not exists color text not null default '';
alter table public.b_booking_types add column if not exists allowed_members uuid[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'b_booking_types_desc_chk') then
    alter table public.b_booking_types add constraint b_booking_types_desc_chk check (char_length(description) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'b_booking_types_color_chk') then
    alter table public.b_booking_types add constraint b_booking_types_color_chk check (color = '' or color ~ '^#[0-9a-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'b_booking_types_allowed_chk') then
    alter table public.b_booking_types add constraint b_booking_types_allowed_chk check (cardinality(allowed_members) <= 200);
  end if;
end $$;
