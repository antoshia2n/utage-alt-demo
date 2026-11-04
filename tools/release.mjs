// 生徒用の版を作る：public/ の今の生徒の画面を public/stable/ に写す（2026-11-04 開発部）
// 使い方：node tools/release.mjs   → できた public/stable/ をプルリクにして、結合したら生徒に出る
// 写すもの：app.html と js/・css/ のすべて。中の "/js/" "/css/" の住所を "/stable/js/" "/stable/css/" に替える
// （絵・マニフェスト・/api は共通のまま。生徒用の版の中から最新の部品を読まないようにするため）
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const PUB = join(ROOT, "public");
const OUT = join(PUB, "stable");

export function rewrite(text) {
  return text.replace(/(["'(`])\/(js|css)\//g, "$1/stable/$2/");
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  rmSync(OUT, { recursive: true, force: true });
  const files = ["app.html", ...walk(join(PUB, "js")).map((p) => p.slice(PUB.length + 1)), ...walk(join(PUB, "css")).map((p) => p.slice(PUB.length + 1))];
  for (const f of files) {
    const dst = join(OUT, f);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, rewrite(readFileSync(join(PUB, f), "utf8")));
  }
  let commit = "";
  try { commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch {}
  const at = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });
  writeFileSync(join(OUT, "RELEASE.json"), JSON.stringify({ released_at: at, from_commit: commit, files: files.length }, null, 2) + "\n");
  console.log(`生徒用の版を作りました：${files.length} 個（${at}・${commit}）`);
}
