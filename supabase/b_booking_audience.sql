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
