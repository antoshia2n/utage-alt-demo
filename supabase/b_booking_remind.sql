-- 2026-11-06 予約の便④（デモ v5 に Naoki OK）：リマインドをシナリオ（いつ・どのテンプレート）に、文はテンプレートに分ける
-- b_booking_templates … 予約メニューをまたいで使い回すメールのテンプレート（名前・件名・本文）
-- b_booking_types.reminders … そのメニューの通知の並び [{key, when: booked|before|after|canceled, minutes, template_id, on}]
--   null のあいだは今までの confirm_*／remind_* で送る
create table if not exists b_booking_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  archived_at timestamptz
);
alter table b_booking_templates enable row level security;
alter table b_booking_types add column if not exists reminders jsonb;

-- 今の 2 つのメニューの文をテンプレートにして、今と同じ送り方の並びを入れる（キャンセルの確認とお礼はオフで足す）
do $$
declare t record; c_id uuid; r_id uuid; x_id uuid; th_id uuid;
begin
  for t in select * from b_booking_types where reminders is null loop
    select id into c_id from b_booking_templates where subject = t.confirm_subject and body = t.confirm_body and archived_at is null limit 1;
    if c_id is null then insert into b_booking_templates (name, subject, body, updated_by) values (left(t.title, 40) || '：受付', t.confirm_subject, t.confirm_body, 'migration') returning id into c_id; end if;
    select id into r_id from b_booking_templates where subject = t.remind_subject and body = t.remind_body and archived_at is null limit 1;
    if r_id is null then insert into b_booking_templates (name, subject, body, updated_by) values (left(t.title, 40) || '：前日', t.remind_subject, t.remind_body, 'migration') returning id into r_id; end if;
    select id into x_id from b_booking_templates where name = 'キャンセルの確認' and archived_at is null limit 1;
    if x_id is null then insert into b_booking_templates (name, subject, body, updated_by) values ('キャンセルの確認', '【予約をキャンセルしました】{{title}}', E'{{name}} さん\n\n{{date}} の {{title}} の予約をキャンセルしました。\n\nまたのご予約をお待ちしています。\n{{booking_url}}', 'migration') returning id into x_id; end if;
    select id into th_id from b_booking_templates where name = 'お礼と次の予約' and archived_at is null limit 1;
    if th_id is null then insert into b_booking_templates (name, subject, body, updated_by) values ('お礼と次の予約', '本日はありがとうございました', E'{{name}} さん\n\n本日はありがとうございました。\n次の予約はこちらからできます。\n{{booking_url}}', 'migration') returning id into th_id; end if;
    update b_booking_types set reminders = jsonb_build_array(
      jsonb_build_object('key', 's1', 'when', 'booked', 'minutes', 0, 'template_id', c_id, 'on', true),
      jsonb_build_object('key', 's2', 'when', 'before', 'minutes', coalesce(t.remind_minutes, 1440), 'template_id', r_id, 'on', t.remind_minutes is not null),
      jsonb_build_object('key', 's3', 'when', 'after', 'minutes', 60, 'template_id', th_id, 'on', false),
      jsonb_build_object('key', 's4', 'when', 'canceled', 'minutes', 0, 'template_id', x_id, 'on', false)
    ) where id = t.id;
  end loop;
end $$;
