// Unit test for the screen translations (lib/client/i18n.js + i18n/*.js): every language has the same keys and {placeholders}
// as English, a missing key falls back to English, and every key a module asks for exists.
const fs = require("fs"), path = require("path"), vm = require("vm");
let passed = 0, failed = 0;
const ok = (n, c, i) => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
const root = path.join(__dirname, "..");
const dir = path.join(root, "lib", "client");
const load = (win, ...files) => { const ctx = vm.createContext({ window: win, config: win.config }); for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), ctx, { filename: f }); return ctx; };
const langs = fs.readdirSync(path.join(dir, "i18n")).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));
const win = { config: { language: "en" } };
load(win, "i18n.js", ...langs.map((l) => `i18n/${l}.js`));
const S = win.OpenSkyStrings, en = S.en, holders = (s) => (s.match(/\{\w+\}/g) || []).sort().join();

ok("1 English exists", en && Object.keys(en).length > 0, Object.keys(en || {}).length);
for (const l of langs.filter((x) => x !== "en")) {
  const missing = Object.keys(en).filter((k) => !(k in S[l])), extra = Object.keys(S[l]).filter((k) => !(k in en));
  ok(`2 ${l} has every English key`, !missing.length, missing.slice(0, 5));
  ok(`3 ${l} has no keys English lacks`, !extra.length, extra.slice(0, 5));
  ok(`4 ${l} keeps the {placeholders}`, Object.keys(en).every((k) => !(k in S[l]) || holders(en[k]) === holders(S[l][k])),
    Object.keys(en).filter((k) => k in S[l] && holders(en[k]) !== holders(S[l][k])).slice(0, 5));
  ok(`5 ${l} has no empty text`, Object.values(S[l]).every((v) => v.trim()));
}

// the lookup
const T = win.OpenSkyT;
ok("6 English by default", T("settings.title") === "Settings");
ok("7 {placeholders} are filled", T("settings.free", { size: "3 GB" }) === "3 GB free");
ok("8 an unknown key gives the fallback, else the key", T("nope", null, "Plain") === "Plain" && T("nope") === "nope");
win.config.language = "sv";
ok("9 Swedish when config.language is sv", T("settings.title") === "Inställningar");
win.config.language = "sv-SE";
ok("10 sv-SE uses sv", T("settings.title") === "Inställningar");
win.config.language = "xx";
ok("11 an unknown language uses English", T("settings.title") === "Settings");
S.sv_tmp = S.sv; delete S.sv["settings.title"]; win.config.language = "sv";
ok("12 a key missing in a language uses English", T("settings.title") === "Settings");
S.sv["settings.title"] = S.sv_tmp["settings.title"];

// every key a module asks for exists in English (t("a.b") / this.t("a.b") / OpenSkyT("a.b"), also `page.${k}`-style prefixes are skipped)
const used = new Set();
for (const m of fs.readdirSync(path.join(root, "modules"))) {
  const mdir = path.join(root, "modules", m);
  for (const f of fs.readdirSync(mdir, { recursive: true }).filter((x) => /\.js$/.test(x) && !/node_helper/.test(x))) {
    const src = fs.readFileSync(path.join(mdir, f), "utf8");
    for (const x of src.matchAll(/\b(?:OpenSkyT|t)\(\s*"([a-zA-Z]+\.[\w.]+)"/g)) used.add(`${m}/${f}: ${x[1]}`);
  }
}
const unknown = [...used].filter((u) => !(u.split(": ")[1] in en));
ok("13 every key used by a module exists in English", !unknown.length, unknown.slice(0, 5));
ok("14 the modules do use translations", used.size > 0, used.size);
console.log(`SUMMARY pass=${passed} fail=${failed}`);
process.exit(failed ? 1 : 0);
