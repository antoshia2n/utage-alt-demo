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
- 続き（0.13.2）：台帳の数（`stats`）の段階は、会員かどうかを先に見る（`find_person` と同じ判定：B で買った権利と門番の表 `member_entitlement`）。会員でない人だけを出来事の段階に分ける。`members` に会員の人数、`by_activity` に出来事だけの段階を返す。表は変えていない
- 続き（0.13.2）：「メールの送り方」の欄は、開き直したとき・画面に戻ったときに読み直し、保存では変えた欄だけを送る（承認や AI で変えた値を、開いたままの古い欄で上書きしないため）
- 続き（0.13.3）：ログインの頁で、台帳（member）にいるのに Supabase のログインの番号がまだ無い人（ポータル時代の会員）も、リンクを受け取れるようにした。頁は先に `POST /api/login/prepare` を呼び、台帳にいる人だけ番号を作る（メールは確かめ済み）。台帳にいない人には作らず、今までどおり「まだ登録されていません」

## B の便 8d で足したもの

- 名前：シアニン用の画面は Lab OS（生徒に見える名前はシアラボのまま）
- 設計図のレーンを 7 つにした：出会う・登録・温める・相談・購入・受講・紹介（お客さんの段階）
- 商品のまとまり：UTAGE の同じ商品から写した売り方（b_products の utage_product_id が同じもの）は 1 箱にたたむ。箱の名前は売り方の名前の頭の共通部分。押すと売り方が開く
- 変えた記録と元に戻す（`src/changes.js`）：メールの送り方・オプチャの招待リンク・部品の持ち主を変えたら、前と後を `b_inbound_log` に channel=change で残す。「元に戻す」で前の値を書き戻す。同じ記録は 1 回だけ。あとの変更がある記録は戻さない（あとのほうを先に戻す）。表は増やしていない
- 片付け案：企画に入っていない部品を、役目つきで常設へ入れる案（何も変えない）。当てると 1 件ずつ変えた記録に残る
- AI の道具：`get_tidy_plan`・`list_changes`（自動）、`apply_tidy`・`undo_change`（承認が要る）
- 権限の最初の値：表に行が無い道具のうち `src/guard.js` の DEFAULT_MODES にあるものは、最初に使うとき（または権限の一覧を開いたとき）にその値で表へ入る。表にある行は上書きしない。一覧に無い道具は今までどおり禁止。新しい道具のために SQL Editor に貼る手が要らなくなった

## 置き場

- Cloudflare Workers（静的ページ＋API）
- 設定の値は Cloudflare の画面の Secret に 4 つ：`SUPABASE_URL`・`SUPABASE_PUBLISHABLE_KEY`・`SUPABASE_SECRET_KEY`・`MCP_SECRET`（足りないものは `/api/health` が名前で返す）
- Supabase：`supabase/schema.sql` を SQL Editor で 1 回流す（何回流しても同じ）。表はすべて RLS 有効でブラウザから読めない

## 調べる手段

- `/api/health`：足りない設定の名前と、データベースに届くか、画像の置き場があるか（`images`）を返す
- `events`：いつ・誰に・何が起きたかが 1 件ずつ残る
- `inbound_log`：外からの呼び出し（登録・MCP）の中身と返事
- 0 件は `ok: true, count: 0`、失敗は `ok: false`（MCP では `isError: true`）

## B の便 12a で足したもの（ページ作成）

- ページの中身（HTML）は Claude が書く。Lab OS は「依頼文を出す・見る・公開する・数を見る」場所（`src/pages.js`）
  - Lab OS「ページ」→「新しく作る」：目的・ページの名前・企画・参考・材料・コメントを入れて「依頼文を出す」。出た依頼文を Claude（Chrome のサイドパネル）に貼る
  - Claude は AI の道具 `get_page_request`（依頼と書き方の決まり）を読み、`save_page_draft` で下書きを置く（版が 1 つ増える）。直すときは詳細の「依頼とコメント」から直しの依頼文を出す
  - 公開は Lab OS の詳細の「版 n を公開する」か、AI の `publish_page`（承認が要る）
- 公開の住所は会員の画面と別の `https://lp.shia2n.jp/<住所の名前>`（wrangler.jsonc の `PAGES_ORIGIN`。Cloudflare の画面で Worker にこの住所を足す）
  - この住所では、ページ・`/_lab/embed.js`・`/api/p/` の下だけを返す。シアニン用の画面・生徒の画面・ほかの API は返さない（`run_worker_first: true` で静的ファイルより先に Worker を通す）
  - Claude が書いた HTML の中の仕掛けが、lab.shia2n.jp にログインしている人の鍵に届かないようにするため
- ページの中の印（B が公開のときに中身を差し込む）
  - 申込の枠 `<div data-lab-part="form:フォームの住所の名前"></div>`（便 11a のフォーム。答えた人は台帳に入る）
  - 決済の枠 `<div data-lab-part="checkout:商品の id"></div>`（名前・価格・申し込むボタン。押すと lab の `/register?product=`）
  - ボタン `data-lab-button="名前"`。押した数を数え、コネクタのきっかけ「ページのボタンを押した」になる
- 見た・押したは表 `b_page_hits`（まだ登録していない人も端末ごとに数える）。台帳にいる人（メールのリンクから来た・その端末でフォームに答えた）は出来事 `page_viewed`（1 人 1 ページ 1 日 1 回）・`page_clicked` にも積む
- 経路：ページの住所の後ろの `?r=名前`。初めて登録したときの経路が `registered` の payload.route に残り、自動ラベル「経路:名前」になる。Lab OS「ページ」の「経路」タブで住所を作り、経路ごとの見た人・登録・買った人を見る
- 設計図：ページは「出会う」のレーンに出る。申込の枠 → フォーム、決済の枠 → 商品の線。先週の数は見た人
- 表：`supabase/b12a_pages.sql` を SQL Editor で 1 回流す（何回流しても同じ）。表 4 本（b_pages・b_page_versions・b_page_requests・b_page_hits）と、コネクタのきっかけ 2 つ
- 試験：`node --test tests/pages.test.mjs tests/pages-host.test.mjs`

## B の便 13 で足したもの（セミナーの回と知らせ）

- 表 `b_seminars`（回）と `b_seminar_notices`（回ごとの知らせ）。`supabase/b13_seminars.sql` を SQL Editor で 1 回流す。中身は `src/seminars.js`
- 回に申込のフォーム（`form_slug`）を結ぶと、そのフォームに答えた人がその回の申込者になる（出来事 `seminar_registered`）。定員を超えたら申込にしない
- 知らせは名前（`key`）で見分け、あとから足せる。いつ送るかは「開催の何分前」（空なら申込の直後・マイナスは開催のあと）。定時の処理（毎時 7 分）で、送る時刻から 3 時間のうちに、送る時刻より前に申し込んだ人へ 1 回だけ送る（`seminar_notice_sent`）
- 知らせは手続きのメール（`kind=seminar_notice`）なので、送る範囲が login のままで申込者に届く
- 申込者には自動のラベル「セミナー:題名」が付く。あとから一斉配信やステップ配信の宛先にできる
- サンクスページ（ページの目的 `thanks`）を回に結ぶと、答えたあとそこへ移る（公開中のときだけ）
- AI の道具：`list_seminars`・`get_seminar`（自動）、`set_seminar`・`set_seminar_notice`・`send_seminar_notice`（承認）
- 試験：`node --test tests/seminars.test.mjs`
