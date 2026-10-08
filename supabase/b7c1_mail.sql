-- B の便 7c-1：メールの送り方を表 b_settings に置く（送り元・表示名・返信先・誰に送るか）と、AI の道具 2 つの権限。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。表は増やさない（b_settings は便 7a で作った）。
-- 最初の値：送り元 info@mail.shia2n.jp・表示名 シアラボ・返信先なし（7c-2 で受信箱ができてから入れる）・誰に送るか login。
--   login：ログインと手続きのメールは誰にでも、お知らせ（一斉配信・ステップ）はテスト宛てだけ。
-- 既に行がある値は上書きしない（画面や AI で変えた値を、流し直しで戻さないため）。
-- 流す前に：Cloudflare の Email Sending に mail.shia2n.jp が登録済みであること（未登録だとログインのメールが送れなくなる）。
-- 戻し方：delete from public.b_settings where key in ('mail_from','mail_from_name','mail_reply_to','mail_scope');
--         delete from public.b_permissions where tool in ('get_mail_settings','set_mail_settings');
--   （戻すと送り元は wrangler.jsonc の MAIL_FROM＝noreply@demo.shia2n.jp、誰に送るかは test に戻る）

insert into public.b_settings (key, value, updated_by) values
  ('mail_from',      'info@mail.shia2n.jp', 'seed'),
  ('mail_from_name', 'シアラボ',             'seed'),
  ('mail_reply_to',  '',                    'seed'),
  ('mail_scope',     'login',               'seed')
on conflict (key) do nothing;

insert into public.b_permissions (tool, mode, note) values
  ('get_mail_settings', 'auto',    '読む'),
  ('set_mail_settings', 'approve', 'メールの送り元・返信先・誰に送るかを変える')
on conflict (tool) do nothing;

-- 確かめ（この 1 行だけが結果に出る）
select
  (select value from public.b_settings where key = 'mail_from')                           as mail_from,
  (select value from public.b_settings where key = 'mail_scope')                          as mail_scope,
  (select count(*) from public.b_settings where key like 'mail_%')                        as mail_rows,
  (select mode from public.b_permissions where tool = 'set_mail_settings')                as set_mode,
  (select count(*) from public.b_permissions)                                             as permissions,
  has_table_privilege('anon', 'public.b_settings', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_settings', 'SELECT')                as browser_can_read;
