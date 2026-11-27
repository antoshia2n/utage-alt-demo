// デザインの指示集（仮の名前）便 1（2026-11-27 Naoki OK）：公式サイト（lp.shia2n.jp/design-feedback）の棚
// - デザイナーが実際に使う直しの指示 40 枚を「気になる所 → デザイナーの言葉 → なぜ → 直す指示（日本語・英語）」で並べる
// - 場面（画像ポスト・サムネ・図解・LP・スライド）ごとの基本と、見本の画像の見立て（AI を使わない固定の見本）
// - 一覧と見本は誰でも読める。指示のコピーは無料会員（公式サイトのログイン cookie lab_site か、登録したその端末の印 lab_u）
// - 画像を入れて AI が見立てる・比べるは便 2、パクリ度チェックは便 3、マイスタイルは便 4
// 正本の考え方：スキル shia2n-reference-remix（パクらない参考術）・shia2n-design-base 1.1
export const KOTOBA_VIEWS = ["主役と順番", "文字", "色", "配置と余白", "絵", "AIへの頼み方"];
// [番号, 見るところ, 気になる所, デザイナーの言葉, なぜ, 直す指示（日本語）, 直す指示（英語）, 見本の絵]
export const KOTOBA_RULES = [
[1,"主役と順番","何を見ればいいか分からない","主役が決まっていない（ヒエラルキーがない）","目が止まる場所が無いと、一瞬で流される","主役を1つだけに決めて大きくし、それ以外は大きさと濃さを下げて脇役にしてください。","Make one element the clear focal point; reduce the size and contrast of everything else.","focus"],
[2,"主役と順番","全部が目立っている","強調のしすぎ","全部を強調すると、何も強調されない","強調は1か所だけにして、ほかの太字・色・囲みは外してください。","Keep emphasis to a single spot; remove extra bold, color and boxes elsewhere.",null],
[3,"主役と順番","読む順番に迷う","視線誘導が弱い","目の動きと並びが合っていない","左上から右下へ、見出し → 図 → 説明の順に目が流れる並びにしてください。","Arrange elements so the eye flows top-left to bottom-right: headline, visual, then details.","flow"],
[4,"主役と順番","一言で何の話か分からない","メッセージが絞れていない","1枚に言いたいことが2つ以上ある","伝えることを1文に絞って見出しにし、入らない話は次の枚へ回してください。","Reduce the message to one sentence and use it as the headline; move the rest to another image.",null],
[5,"主役と順番","結論がなかなか出てこない","結論が後ろにある","読む人は最初の数秒で読むかを決める","結論を一番上に置き、理由はその下に並べてください。","Put the conclusion at the top and the reasons below it.",null],
[6,"主役と順番","情報が多すぎる","詰め込みすぎ","読む前に疲れてしまう","情報を半分に減らし、残すのは見出し・主役・要点3つまでにしてください。","Cut the information in half: keep only the headline, the main visual and up to three key points.","less"],
[7,"文字","メリハリがない","ジャンプ率が低い","見出しと本文の大きさが近いと、どこから読むか分からない","見出しを本文の3倍以上の大きさにして、見出しと本文の差をはっきりさせてください。","Make the headline at least three times larger than the body text for a strong size contrast.","jump"],
[8,"文字","文字が小さくて読めない","可読性が低い","スマホでは画像が小さく表示される","スマホの画面で読める大きさまで文字を大きくし、入らない分は削ってください。","Enlarge the text so it is readable on a phone screen; cut words that no longer fit.",null],
[9,"文字","文字が背景に埋もれる","コントラストが足りない","文字と背景の明るさが近い","文字と背景の明るさの差を大きくしてください（明るい背景に濃い文字）。","Increase the brightness contrast between text and background (dark text on a light background).","contrast"],
[10,"文字","書体がバラバラ","書体の数が多い","書体が増えるほど、まとまりが消える","書体は見出し用と本文用の2種類だけにしてください。","Use only two typefaces: one for headlines and one for body text.",null],
[11,"文字","文字が窮屈","行間・字間が詰まっている","詰まった文字は読む気をそぐ","行間を文字の大きさの1.6〜1.8倍に広げてください。","Increase line spacing to about 1.6–1.8 times the font size.",null],
[12,"文字","文字が派手で安っぽい","文字の飾りの盛りすぎ","縁取り・影・グラデーションは素人っぽく見えやすい","縁取り・影・グラデーションの文字をやめ、太さと大きさだけで強調してください。","Remove outlines, drop shadows and gradients from text; emphasize only with weight and size.","deco"],
[13,"文字","1行が長くて読みにくい","行長が長すぎる","目が行の頭に戻るのに迷う","1行を全角20〜35字までにして改行してください。","Keep each line short, around 20–35 Japanese characters, and break lines there.",null],
[14,"文字","画像の文字が多い","文字量が多すぎる","小さく表示される画像では、多い文字は読まれない","画像の中の文字は3〜5語に絞り、説明はタイトルや本文に回してください。","Limit on-image text to three to five words; move explanations into the title or caption.",null],
[15,"色","色がうるさい","色数が多い","色が多いと、どれが大事か分からない","色は背景・文字・差し色の3色までにしてください。","Use no more than three colors: background, text and one accent.","color"],
[16,"色","地味で目立たない","差し色が弱い","見てほしい所に色の合図が無い","見てほしい所・押してほしい所だけに、はっきりした差し色を1色使ってください。","Use one strong accent color only where you want attention or a click.",null],
[17,"色","統一感がない","トンマナがそろっていない","投稿ごとに見た目が変わると、誰の発信か覚えてもらえない","前の投稿と同じ色・書体・絵柄にそろえてください。","Match the colors, typefaces and illustration style of previous posts.",null],
[18,"色","色が安っぽい","彩度が高すぎる","鮮やかすぎる色は目が疲れる","色の鮮やかさを少し落として、くすみ寄りにしてください。","Lower the saturation slightly toward muted tones.",null],
[19,"色","文字の色がチカチカする","補色の重なり","反対の色を重ねると、境目がちらつく","赤と緑、青と橙のような反対の色を、文字と背景で重ねないでください。","Avoid placing complementary colors directly as text and background (e.g. red on green).",null],
[20,"色","AI っぽいツヤ","グラデーションと光の盛り","光るグラデーションは作った感が出やすい","グラデーションと光の効果をやめ、平らな塗りにしてください。","Remove gradients and glow effects; use flat color fills.",null],
[21,"配置と余白","ごちゃごちゃしている","余白が足りない","余白は「ここは別のまとまり」という合図になる","画面の外周と要素の間に余白を取り、詰めすぎをやめてください。","Add generous margins around the edges and between elements.","space"],
[22,"配置と余白","なんとなくズレている","整列していない","端がそろっていないと、雑に見える","要素の左端をそろえ、見えない格子の上に並べてください。","Align elements to a shared left edge on an invisible grid.","align"],
[23,"配置と余白","関係が分かりにくい","グルーピングが弱い（近接）","近いもの同士は仲間に見える","関係するものは近づけ、別のまとまりは離してください。","Group related items closely and separate unrelated groups with space.","group"],
[24,"配置と余白","枠だらけ","囲みの使いすぎ","枠が多いと、どれも同じ重さに見える","囲み枠を減らし、まとまりは余白で作ってください。","Remove most boxes and borders; create grouping with white space instead.",null],
[25,"配置と余白","端が切れる","安全な範囲の外","SNS では端末によって端が隠れる","大事な文字と顔は、画面の外周から1割内側に収めてください。","Keep important text and faces within the central safe area, about 10% in from each edge.",null],
[26,"配置と余白","バランスが悪い","重心が偏っている","主役の位置で落ち着きが決まる","主役を画面を三分割した線の交点に置き、反対側に余白を残してください。","Place the subject on a rule-of-thirds intersection and leave open space on the other side.",null],
[27,"配置と余白","形がバラバラ","図形の形・大きさが不ぞろい","同じ役割の形がそろうと、意味が読み取りやすい","同じ役割の箱は、同じ形・同じ大きさにそろえてください。","Make boxes with the same role the same shape and size.",null],
[28,"配置と余白","背景がうるさい","背景の描き込みすぎ","背景が主役と取り合う","背景は場面に要る物だけにし、主役の後ろは無地にしてください。","Keep the background minimal with only necessary props; plain behind the subject.",null],
[29,"絵","絵柄がバラバラ","画風が混ざっている","写真・イラスト・素材が混ざると、まとまらない","写真・イラスト・素材を混ぜず、1つの画風にそろえてください。","Use one consistent illustration style; do not mix photos, illustrations and stock art.",null],
[30,"絵","人物の顔が毎回変わる","キャラクターの一貫性がない","同じ人に見えないと、話がつながらない","1枚目と同じ顔・髪型・服・頭身で描いてください。","Keep the same face, hairstyle, outfit and proportions as in the first image.",null],
[31,"絵","表情が大げさ","感情の押しつけ","大げさな表情は作り物に見える","表情は控えめにして、状況で気持ちを伝えてください。","Keep facial expressions subtle; convey emotion through the situation.",null],
[32,"絵","どこかで見た絵","ありきたり（クリシェ）","指示が足りないと、AI はよくある形で埋める","主題・場所・光・構図を具体的に書き足して、よくある構図を避けてください。","Specify subject, setting, lighting and composition concretely to avoid a generic result.",null],
[33,"絵","主役が背景に溶ける","図と地が分かれていない","主役と背景の明るさが近い","主役の輪郭をはっきりさせ、背景の明るさを主役と変えてください。","Sharpen the subject's outline and make the background a different brightness.",null],
[34,"絵","指や文字が崩れる","生成の崩れ","画像の AI は細かい文字と指が苦手","画像の中に文字は入れず、あとから文字を重ねる余白を空けて作ってください。","Do not render text in the image; leave clean space to add text afterwards.",null],
[35,"AIへの頼み方","思った絵にならない","指示が欠けている","主題・スタイル・構図・雰囲気と光・制約のどれかが抜けている","主題・スタイル・構図・雰囲気と光・制約を1行ずつ書いて頼んでください。","Write the request as five lines: subject, style, composition, mood and lighting, constraints.",null],
[36,"AIへの頼み方","「高級感」が伝わらない","抽象的な言葉","AI は雰囲気の言葉より、物の言葉に反応する","「高級感」ではなく、素材と光の言葉で書いてください（例：つや消しの黒、横からのやわらかい光）。","Replace abstract words like premium with materials and light (e.g. matte black, soft side light).",null],
[37,"AIへの頼み方","参考に似すぎる","参考の画像をそのまま渡している","似せる力が強く働き、絵柄まで写る","参考の画像は渡さず、良さを言葉にして頼んでください。","Do not upload the reference image; describe its qualities in words instead.",null],
[38,"AIへの頼み方","直したら全部変わった","直す範囲を言っていない","範囲が無いと、AI は全体を作り直す","〇〇以外は変えずに、〇〇だけ直してください。","Change only [X]; keep everything else exactly the same.",null],
[39,"AIへの頼み方","「〜しないで」が効かない","否定の言い方","否定の言葉が、かえって描かれることがある","「〜しない」ではなく「〜にする」で書いてください（例：白い背景に机だけ）。","Phrase requests positively (e.g. a white background with only a desk) instead of saying what not to do.",null],
[40,"AIへの頼み方","毎回ちがう絵になる","決めごとが毎回ちがう","色・書体・画風を毎回書かないと、ぶれる","色・書体・画風の決めごとを最初の3行に固定し、毎回同じ文を入れてください。","Fix your color, type and style rules in the first three lines and reuse them every time.",null]
];
export const KOTOBA_SCENES = [
{id:"post",name:"画像ポスト",sub:"X・Instagram",pre:["タイムラインで一瞬で流される。止まってもらえるかは最初の1秒で決まる","画像の向きと大きさは SNS ごとに違い、変わることもあるので、出す前にその SNS の案内で確かめる","端末によって端が隠れることがあるので、大事なものは内側に置く"],rules:[4,6,7,21,25,15],ng:["文字を詰め込んで小さくする","縁取り・影の付いた文字で押す","写真の上に直接文字を置いて読めなくする"]},
{id:"thumb",name:"サムネ",sub:"YouTube・note",pre:["スマホの小さな枠で見られる。小さくしても何の話か分かるか","YouTube のサムネは 16:9","題名と画像で役割を分ける。画像は題名と同じことを言わない"],rules:[1,14,9,8,33,25],ng:["文字が6語以上ある","主役と背景の明るさが近い","題名と同じ文を画像にも書く"]},
{id:"zukai",name:"図解",sub:"X・note・資料",pre:["保存されて、あとで読み込まれる","1枚に言いたいことは1つ","四角と矢印の意味を最初に決めて、最後まで変えない"],rules:[4,3,23,27,12,24],ng:["吹き出しと枠だらけ","矢印の意味が場所ごとに違う","同じ役割の箱の形がバラバラ"]},
{id:"lp",name:"LP・WEB",sub:"販売・登録のページ",pre:["スマホで縦に流し読みされる","最初の画面で、誰の何の話かを言い切る","押してほしいボタンは1種類"],rules:[5,16,11,13,22,21],ng:["同じ幅のカード3枚を並べるだけ","光るグラデーションの背景","ボタンが何種類もある"]},
{id:"slide",name:"スライド",sub:"セミナー・講座",pre:["話を聞きながら数秒で見る","1枚1メッセージ。文は話す側が持つ","全部の枚で、色・書体・位置をそろえる"],rules:[4,6,12,10,23,27],ng:["箇条書きだらけ","ワードアートや凝った飾り","枚ごとに色や書体が変わる"]}
];
export const KOTOBA_SAMPLE = {scene:"zukai",good:"伝えたいことを1枚にまとめようとしている姿勢が見える",picks:[{id:6,where:"全体",reason:"文字の行が9本あり、読む前に疲れてしまう"},{id:15,where:"上の帯と下のボタン",reason:"赤・青・黄・緑・紫と5色以上使っていて、どこが大事か分からない"},{id:1,where:"左の青い四角",reason:"大きさの近い四角が並び、目が止まる場所が無い"},{id:21,where:"外周",reason:"上の帯が画面の端に触れていて窮屈に見える"}],wish:"",changes:[{title:"白地に墨と差し色1色で静かに",why:"色を絞るだけで、主役と要点が浮き上がる",steps:["背景は白、文字は黒に近い墨色にする","差し色は赤1色だけにし、押してほしいボタンにだけ使う","帯と飾りの丸を外す"],words:["白地に差し色1色","余白多め"]},{title:"大きな見出し1行と図1つに絞る",why:"情報量が多すぎるので、1枚1メッセージにすると伝わる",steps:["見出しを本文の3倍の大きさで1行にする","図は1つだけにして中央に大きく置く","残りの説明は次の枚に回す"],words:["日の丸構図","ミニマル"]}]};
export function kotobaMock(k,after){
 const I="#1a1a1a",G="#bdbdbd",Rd="#c8102e",L=(x,y,w,h,c)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${c||G}"/>`;
 let b="",bg="#ffffff";
 if(k==="focus"){b=after?`<circle cx="80" cy="48" r="26" fill="${I}"/><circle cx="24" cy="80" r="7" fill="${G}"/><circle cx="136" cy="80" r="7" fill="${G}"/>`:`<circle cx="32" cy="50" r="18" fill="${I}"/><circle cx="80" cy="50" r="18" fill="${Rd}"/><circle cx="128" cy="50" r="18" fill="${I}"/>`}
 if(k==="flow"){b=after?L(14,12,90,12,I)+L(14,32,64,46,G)+L(88,36,58,5)+L(88,46,52,5)+L(88,56,56,5)+L(100,82,46,10,Rd):L(70,62,80,10,I)+L(10,10,50,30,G)+L(100,14,48,5)+L(20,70,40,5)+L(96,30,40,5)+L(16,52,28,10,Rd)}
 if(k==="less"){b=after?L(14,14,110,12,I)+L(14,40,90,6)+L(14,54,80,6)+L(14,68,86,6):Array.from({length:9},(_,i)=>L(8,8+i*9,i%3?140:100,5,i?G:I)).join("")+`<circle cx="140" cy="88" r="6" fill="${Rd}"/><circle cx="124" cy="88" r="6" fill="#3a86ff"/>`}
 if(k==="jump"){b=after?L(14,16,126,20,I)+L(14,50,120,5)+L(14,60,110,5)+L(14,70,116,5):L(14,22,100,8,I)+L(14,38,120,6)+L(14,50,110,6)+L(14,62,116,6)}
 if(k==="contrast"){bg=after?"#ffffff":"#cfcfcf";b=after?L(14,24,120,14,I)+L(14,50,110,6,"#555")+L(14,62,96,6,"#555"):L(14,24,120,14,"#a9a9a9")+L(14,50,110,6,"#b8b8b8")+L(14,62,96,6,"#b8b8b8")}
 if(k==="deco"){b=after?`<text x="80" y="58" text-anchor="middle" font-size="26" font-weight="900" fill="${I}" font-family="Noto Sans JP,sans-serif">見出し</text>`:`<text x="80" y="58" text-anchor="middle" font-size="26" font-weight="900" fill="url(#g-rain)" stroke="#fff" stroke-width="2.4" paint-order="stroke" filter="url(#f-sh)" font-family="Noto Sans JP,sans-serif">見出し</text>`}
 if(k==="color"){const cs=after?[I,G,G,G,Rd,G]:["#ff4d6d","#ffd60a","#3a86ff","#06d6a0","#8338ec","#fb5607"];b=cs.map((c,i)=>L(14+(i%3)*46,18+Math.floor(i/3)*38,40,30,c)).join("")}
 if(k==="space"){b=after?L(20,18,96,12,I)+L(20,40,120,40,G):L(2,2,156,14,I)+L(2,18,156,80,G)}
 if(k==="align"){b=after?[0,1,2,3].map(i=>L(20,14+i*20,[110,80,96,70][i],10,i?G:I)).join(""):[0,1,2,3].map(i=>L([20,34,14,46][i],14+i*20,[110,80,96,70][i],10,i?G:I)).join("")}
 if(k==="group"){b=after?[0,1,2].map(i=>L(14,14+i*12,56,8)).join("")+[0,1,2].map(i=>L(90,14+i*12,56,8)).join("")+L(14,70,132,14,I):[0,1,2,3,4,5].map(i=>L(14,10+i*11,130,7)).join("")+L(14,78,132,12,I)}
 return `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${after?"直した後":"直す前"}"><rect width="160" height="100" fill="${bg}"/>${b}</svg>`;
}
