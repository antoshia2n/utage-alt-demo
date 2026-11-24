-- 先着の数（2026-11-24・人数限定の個別相談）：予約メニューごとに、受ける予約の合計の上限。空なら上限なし
-- 何回流しても同じ結果になる
alter table public.b_booking_types add column if not exists max_total integer;
alter table public.b_booking_types drop constraint if exists b_booking_types_max_total_check;
alter table public.b_booking_types add constraint b_booking_types_max_total_check check (max_total is null or (max_total between 1 and 500));
