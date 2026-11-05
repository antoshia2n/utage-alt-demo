-- 2026-11-05 予約の便②（デモ v5 に Naoki OK）：受付時間をドラッグで塗る・特定日・予約ルール・複数の所要時間
-- week_hours     … 曜日ごとの受付時間 {"1":[[600,720],[1200,1320]], ...}（分。日本時間）。null なら今までの weekdays＋times
-- date_overrides … 特定日 {"2026-11-20":[]（休業日）／[[600,660]]（その日だけの時間）}
-- durations      … 予約する人が選べる所要時間（空なら minutes だけ）
-- slot_step      … 開始時刻の間隔（分）。null なら所要時間ごと
-- buffer_before / buffer_after … 予約の前後に空ける時間（分）
-- max_per_day    … このメニューで 1 日に受ける件数（null＝上限なし）
-- max_per_person … 同じ人が同時に持てる予約の件数
-- cancel_hours   … 予約者が自分で変更・キャンセルできるのは開始の何時間前まで（null＝直前まで）
alter table b_booking_types
  add column if not exists week_hours jsonb,
  add column if not exists date_overrides jsonb not null default '{}'::jsonb,
  add column if not exists durations integer[] not null default '{}',
  add column if not exists slot_step integer,
  add column if not exists buffer_before integer not null default 0,
  add column if not exists buffer_after integer not null default 0,
  add column if not exists max_per_day integer,
  add column if not exists max_per_person integer not null default 1,
  add column if not exists cancel_hours integer;
alter table b_booking_types
  add constraint b_booking_types_slot_step_chk check (slot_step is null or slot_step between 5 and 240),
  add constraint b_booking_types_buffer_chk check (buffer_before between 0 and 120 and buffer_after between 0 and 120),
  add constraint b_booking_types_max_day_chk check (max_per_day is null or max_per_day between 1 and 50),
  add constraint b_booking_types_max_person_chk check (max_per_person between 1 and 10),
  add constraint b_booking_types_cancel_chk check (cancel_hours is null or cancel_hours between 0 and 168),
  add constraint b_booking_types_durations_chk check (cardinality(durations) <= 6);
