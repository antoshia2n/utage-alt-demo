# utage-alt-demo

UTAGE の代わりになるサイト兼アプリ（PWA）のデモ。架空のデータだけで動く。
正本の依頼書：Notion の Tasks「UTAGE の代わりになるサイト兼アプリのデモを作る（架空のデータだけ）」

## 便 1 で入っているもの

- 顧客の台帳（1 人 1 件）と出来事の記録。段階は記録から計算する（`customer_summary`）
- 入口は 1 つ：シアニン用の画面（`/api/admin/*`）と AI（`/mcp`）が同じ処理を呼ぶ
- 公開の面：LP `/`・無料登録 `/register`・ログイン `/login`・固定ページ `/legal/*`
- ログインの面：`/app`（教材・お知らせ・添削ルームの入口）。ログイン直後に 1 回だけ「ホーム画面に追加」の案内
- シアニン用の画面：`/admin`（メールのリンク＋認証アプリの 6 桁）
- 流入元：`?src=x|note|youtube` を登録時に台帳の 1 列に残す
- note のメンバー：手で付ける列（シアニン用の画面のチェック）
- MCP：`find_person`・`get_timeline`・`stats`

## 便 2 で足したもの

- 添削ルーム（1 対 1）：生徒は `/app` の「添削ルーム」から文章と画像（4 枚まで・1 枚 5MB まで）を出す。シアニンは `/admin` の「添削ルーム」で、未返信のある部屋が上に来る一覧から開き、原文・添削後・コメントの 3 欄で返す
- やりとりは新しい表を作らず `events` に積む（`correction_submitted`・`correction_returned`・`room_read`）。未返信・既読は記録から計算する
- 新着の知らせ：タブの数字（30 秒ごとに見る）と、ホーム画面に追加したアプリのアイコンの数字。届かない人へのメール 1 通は便 3（メール）で足す
- 生徒同士の場：添削ルームの下にリンクの置き場。設定 `COMMUNITY_URL` が無ければ「準備中」
- MCP：`list_rooms`・`get_room`・`return_correction`
- 画像は R2（`IMAGES`）。名前を書かないので、初回の組み立てで Cloudflare が自動で作る。本人とシアニンだけが読める

## 便 3 で足したもの

- 決済（UnivaPay のテスト）：登録の直後と `/app` に「入会する」。UnivaPay のウィジェットが定期課金（月 3,000 円・テスト）を作り、サイトは秘密の鍵で UnivaPay に聞き直してから `subscription_started` を積む
- UnivaPay の知らせ：`POST /api/webhooks/univapay`。合言葉は `MCP_SECRET` から作り、シアニン用の画面の「決済とメールの設定」に出す。2 回目以降の入金・失敗・解約を積む。受け取りは全部 `inbound_log` に残す
- 権利：会員かどうかは出来事から計算する（始まった・入金 → 会員、失敗・解約・停止 → 会員でない）
- メール（Cloudflare Email Service）：送信元 `noreply@demo.shia2n.jp`（Email Service には demo.shia2n.jp で登録）。デモの間は送り先をシアニン用の画面に入れるメール（と + 付きの別名）だけに限る。全メールの末尾に配信停止のリンク
- 定時の処理（1 時間ごと）：添削が返って 1 時間読まれていない人へメールを 1 通
- MCP：`send_email`
- 秘密の値の追加：`UNIVAPAY_APP_TOKEN`・`UNIVAPAY_APP_SECRET`（Cloudflare の画面）

## 便 4 で足したもの

- 個別相談の予約：`/app` の「予約」タブ。平日 10・14・20 時（日本時間）の 30 分枠を 14 日先まで。1 人 1 件まで・取り消しできる。予約すると確認のメール
- セミナー：架空の 2 回（`src/bin4.js` の SEMINARS）。申し込むと Zoom の URL をメール、開始の 24 時間前を過ぎたら前日の知らせ（毎時の定時の処理）、終わったらシアニン用の画面からアーカイブを配る
- 商談の段階：相談予約 → 面談済 → 成約／失注。シアニン用の画面の詳しい画面で、メモと成約額をつけて進める。段階は出来事から計算する
- コンサルの請求を読む見本：sales-manager の形を真似た架空のデータ（`CONTRACT_SAMPLES`）を、詳しい画面に読むだけで出す。本物には触れない
- MCP：`list_consults`・`set_deal_stage`・`list_seminars`

## B の便 8c で足したもの

- 画面の形：シアニン用の画面と生徒の画面を「左のメニュー＋上のナビ」にした。スマホでは左のメニューが上の横並びになる
- 設計図（シアニン用の画面の最初の画面）：部品を集める・育てる・売る・届ける・紹介のレーンに並べ、実際の設定から引いた線を引く。図は別の表に描かず、毎回組み立てる（`src/plan.js`）
  - 部品：トップの LP・無料登録・ステップ・一斉配信・セミナー・個別相談の予約・売っている商品・しあらぼの教材・添削ルーム・オプチャ
  - 線：登録 → 登録のステップ／商品 → 購入のステップ／会員の権利の商品 → 教材とオプチャ／商品 → その商品を買った人への一斉配信
  - 数：部品ごとの先週 7 日の数。線の数は行き先に入る線が 1 本のときだけ出す
- 企画（`b_campaigns`）と部品の持ち主（`b_campaign_parts`）：部品 1 つに企画 1 つ。「常設」は 1 つだけでしまえない。企画名の頭に年月が自動で付く
  - 名前は 2 つ：外の名前（生徒に見える・部品の名前や件名そのまま）と、中の名前（「企画名｜種類｜役目」で自動）
  - しまう：持ち主の部品が 1 つでも動いていたらしまわない。しまうと「すべて」から消えるが、部品と数は残る
- MCP：`get_blueprint`・`list_campaigns`・`create_campaign`・`set_part_campaign`（自動）、`archive_campaign`（承認が要る）
- 表：`supabase/b8c_plan.sql` を SQL Editor で 1 回流す（何回流しても同じ）

## B の便 7c-1 で足したもの

- メールの送り方を表 `b_settings` の 4 行に置いた（Cloudflare の値から移した）：`mail_from`（送り元）・`mail_from_name`（表示名）・`mail_reply_to`（返信先・空なら付けない）・`mail_scope`（誰に送るか）
  - `mail_scope`：`test`（テスト宛てだけ）／`login`（ログインと手続きのメールは誰にでも・一斉配信とステップはテスト宛てだけ）／`all`（全部誰にでも）
  - 送り元は `mail.shia2n.jp` か `demo.shia2n.jp` の住所だけ（Cloudflare の Email Sending に登録した下の住所。shia2n.jp そのものは XServer の送信の決まりがあるので使わない）
  - 表に行が無いときは wrangler.jsonc の `MAIL_FROM` と `test` に戻る。本番では Cloudflare の値 `MAIL_OPEN` を読まない
  - 変えるのはシアニン用の画面「決済・メール・オプチャ」の「メールの送り方」か、AI の `set_mail_settings`（承認が要る）。読むのは `get_mail_settings`（自動）
- メールの末尾：事業者名・所在地・お問い合わせ先・特商法の頁・配信停止（デモの置き場では今までどおりデモの文）
- 生徒に見える頁と法定の頁を本物にした：名前はシアラボ。特商法とプライバシーポリシーは UTAGE のファネル「特商法・プライバシーポリシー」から写した。利用規約は本物が無いのでリンクを外し、頁は「準備中」
- 個別相談の枠とセミナーはまだ架空なので、本番の置き場ではシアニン以外に「準備中」だけを返す（本物は便 8f）
- 登録の画面の試しのカードの案内は、決済が試し（`univapayMode` が test）のときだけ出す
- 表：`supabase/b7c1_mail.sql` を SQL Editor で 1 回流す（何回流しても同じ・画面で変えた値は上書きしない）。流す前に Email Sending に `mail.shia2n.jp` を登録しておく
- 続き（0.13.1）：B の住所を `https://lab.shia2n.jp` にした（wrangler.jsonc の `PUBLIC_ORIGIN`。Cloudflare の画面で Worker にこの住所を足す）。ログインのメールのリンクは Supabase の住所ではなく `/auth`（`public/auth.html`）を通し、ページの中で `verifyOtp`（token_hash）で確かめる。送り元とリンク先の住所をそろえて迷惑メールに入りにくくするため。メールには見た目を整えた本文も付ける

## 置き場

- Cloudflare Workers（静的ページ＋API）
- 設定の値は Cloudflare の画面の Secret に 4 つ：`SUPABASE_URL`・`SUPABASE_PUBLISHABLE_KEY`・`SUPABASE_SECRET_KEY`・`MCP_SECRET`（足りないものは `/api/health` が名前で返す）
- Supabase：`supabase/schema.sql` を SQL Editor で 1 回流す（何回流しても同じ）。表はすべて RLS 有効でブラウザから読めない

## 調べる手段

- `/api/health`：足りない設定の名前と、データベースに届くか、画像の置き場があるか（`images`）を返す
- `events`：いつ・誰に・何が起きたかが 1 件ずつ残る
- `inbound_log`：外からの呼び出し（登録・MCP）の中身と返事
- 0 件は `ok: true, count: 0`、失敗は `ok: false`（MCP では `isError: true`）
