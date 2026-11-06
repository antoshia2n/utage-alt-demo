-- 2026-11-06 担当者への通知（Naoki OK）：リマインドの各通知に to（booker＝予約した人／staff＝担当者）を持たせる（jsonb の中だけ・列は増やさない）
-- 担当者向けのテンプレート 2 つを作り、今の予約メニューに「予約した直後 → 担当者」「キャンセルされたとき → 担当者」をオンで足す
do $$
declare n_id uuid; x_id uuid;
begin
  select id into n_id from b_booking_templates where name = '担当者へ：新しい予約' and archived_at is null limit 1;
  if n_id is null then insert into b_booking_templates (name, subject, body, updated_by) values ('担当者へ：新しい予約', '【新しい予約】{{title}}：{{name}} さん',
    E'{{staff}} さん\n\n新しい予約が入りました。\n\n■ 予約者\n{{name}}（{{email}}）\n\n■ 日時\n{{date}}〜{{end}}\n\n■ メニュー\n{{title}}\n\n■ Zoom\n{{zoom}}\n\n■ いただいた回答\n{{answers}}', 'migration') returning id into n_id; end if;
  select id into x_id from b_booking_templates where name = '担当者へ：キャンセル' and archived_at is null limit 1;
  if x_id is null then insert into b_booking_templates (name, subject, body, updated_by) values ('担当者へ：キャンセル', '【予約のキャンセル】{{title}}：{{name}} さん',
    E'{{staff}} さん\n\n予約がキャンセルされました（日時の変更のときは、変更前の日時のキャンセルです）。\n\n■ 予約者\n{{name}}（{{email}}）\n\n■ キャンセルされた日時\n{{date}}〜{{end}}\n\n■ メニュー\n{{title}}', 'migration') returning id into x_id; end if;
  update b_booking_types set reminders = reminders
    || jsonb_build_array(jsonb_build_object('key', 's5', 'when', 'booked', 'minutes', 0, 'template_id', n_id, 'on', true, 'to', 'staff'),
                         jsonb_build_object('key', 's6', 'when', 'canceled', 'minutes', 0, 'template_id', x_id, 'on', true, 'to', 'staff'))
    where reminders is not null and not exists (select 1 from jsonb_array_elements(reminders) r where r->>'to' = 'staff');
end $$;
