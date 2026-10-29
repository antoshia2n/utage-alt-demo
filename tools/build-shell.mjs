// 共通の外枠（shia2n-core の shell/app-shell.js）を、マーケくんの生徒の画面で読める 1 本の JS にまとめる。
// 走らせ方：node tools/build-shell.mjs <shia2n-core を置いた場所>
// 出来上がり：public/js/vendor/app-shell.js（版と元の番号を先頭に書く）。Firebase の部分は tools/shell-stubs.mjs の空の代わりになる
import { build } from "esbuild";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
const core = path.resolve(process.argv[2] || "../antoshia2n/shia2n-core");
const rev = execSync("git rev-parse --short HEAD", { cwd: core }).toString().trim();
const ver = JSON.parse(fs.readFileSync(path.join(core, "package.json"), "utf8")).version;
const stub = path.resolve("tools/shell-stubs.mjs");
const stubs = { name: "stubs", setup(b) {
  b.onResolve({ filter: /^firebase\/(auth|firestore)$/ }, () => ({ path: stub }));
  b.onResolve({ filter: /lib\/firebase\.js$/ }, () => ({ path: stub }));
} };
await build({
  stdin: { contents: `export { mountAppShell, setTabTitle } from ${JSON.stringify(path.join(core, "shell/app-shell.js"))};`, resolveDir: core, loader: "js" },
  bundle: true, format: "esm", target: "es2020", minify: true, outfile: "public/js/vendor/app-shell.js",
  banner: { js: `// shia2n-core ${ver}（${rev}）の shell/app-shell.js をまとめたもの。直すときは tools/build-shell.mjs で作り直す` },
  plugins: [stubs],
});
console.log("built", ver, rev);
