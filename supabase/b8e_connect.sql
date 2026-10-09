-- B の便 8e：ステップの表 b_steps を、コネクタ（トリガー → セレクタ → アクション）に広げる。新しい表は作らない。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある行の値は変えない（新しい欄は既定の値で埋まる）。
--   trigger      … きっかけ。登録・購入に、リンクを押した・教材を見た・添削を出した・ログインした・ラベルが付いた を足す
--   trigger_args … きっかけの細かい条件（label：ラベルの名前・url：押したリンク）
--   selector     … 誰に。一斉配信の宛先と同じ形（空なら全員）
--   action       … 何をする。send_email（メールを送る・いままでのステップ）／notify_admin（Naoki に知らせる）／add_label（ラベルを付ける）
--   action_args  … アクションの細かい値（label：付けるラベル）
-- あわせて、Naoki への知らせを 3 本入れる（購入・添削の提出・通しの確かめ用のラベル「通しテスト」）。同じ名前の行があれば入れない。
-- 新しい道具（get_labels・add_label・remove_label）の権限は、コードの一覧の値で B が自分で入れる（便 8d から）。
-- 戻し方：
--   delete from public.b_steps where name in ('購入を Naoki に知らせる','添削の提出を Naoki に知らせる','通しテスト：ラベルが付いたら Naoki に知らせる');
--   alter table public.b_steps drop constraint if exists b_steps_trigger_check, drop constraint if exists b_steps_action_check;
--   alter table public.b_steps drop column if exists trigger_args, drop column if exists selector, drop column if exists action, drop column if exists action_args;
--   alter table public.b_steps add constraint b_steps_trigger_check check (trigger in ('registered','purchase'));

alter table public.b_steps add column if not exists trigger_args jsonb not null default '{}'::jsonb;
alter table public.b_steps add column if not exists selector     jsonb not null default '{}'::jsonb;
alter table public.b_steps add column if not exists action       text  not null default 'send_email';
alter table public.b_steps add column if not exists action_args  jsonb not null default '{}'::jsonb;

-- きっかけの決まりを広げる（便 5 の決まりは名前が自動で付いたので、中身で探して外す）
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.b_steps'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%trigger%' or pg_get_constraintdef(oid) like '%action%')
  loop
    execute format('alter table public.b_steps drop constraint %I', c);
  end loop;
end $$;

alter table public.b_steps add constraint b_steps_trigger_check
  check (trigger in ('registered','purchase','clicked','lesson_viewed','correction_submitted','login','label_added'));
alter table public.b_steps add constraint b_steps_action_check
  check (action in ('send_email','notify_admin','add_label'));

insert into public.b_steps (name, trigger, action, delay_hours, subject, body, active, active_since, updated_by)
select v.name, v.trigger, 'notify_admin', 0, v.subject, '', true, now(), 'seed'
from (values
  ('購入を Naoki に知らせる',      'purchase',             '【Lab OS】購入：{{name}}（{{product}}）'),
  ('添削の提出を Naoki に知らせる', 'correction_submitted', '【Lab OS】添削の提出：{{name}}')
) as v(name, trigger, subject)
where not exists (select 1 from public.b_steps s where s.name = v.name);

insert into public.b_steps (name, trigger, trigger_args, action, delay_hours, subject, body, active, active_since, updated_by)
select '通しテスト：ラベルが付いたら Naoki に知らせる', 'label_added', '{"label":"通しテスト"}'::jsonb, 'notify_admin', 0,
       '【Lab OS】通しテスト：{{name}} にラベル「{{label}}」', '', true, now(), 'seed'
where not exists (select 1 from public.b_steps s where s.name = '通しテスト：ラベルが付いたら Naoki に知らせる');

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from public.b_steps)                                         as steps,
  (select count(*) from public.b_steps where action = 'notify_admin')           as notify,
  (select count(*) from public.b_steps where action = 'send_email')             as send_email,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'b_steps'
       and column_name in ('trigger_args','selector','action','action_args'))   as new_columns,
  has_table_privilege('anon', 'public.b_steps', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_steps', 'SELECT')         as browser_can_read;
