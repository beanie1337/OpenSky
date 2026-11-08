/* OpenSky screen-side translations (loaded by modules via getScripts: "modules/opensky-lib/client/i18n.js", followed by
 * the language files "modules/opensky-lib/client/i18n/en.js" and "…/<language>.js"). Defines window.OpenSkyT.
 *   OpenSkyT("settings.title")                    → the text in config.language, else English, else the key itself
 *   OpenSkyT("settings.free", { size: "3 GB" })   → {size} in the text is replaced
 *   OpenSkyT("page.home", null, "Home")           → a third argument is shown when no language has the key
 * The language files add their texts to window.OpenSkyStrings.<language>. Safe to load more than once.
 */
(function () {
  if (window.OpenSkyT) return;
  const S = (window.OpenSkyStrings = window.OpenSkyStrings || {});
  const lang = () => String((typeof config !== "undefined" && config.language) || "en").toLowerCase();
  const find = (key) => {
    const l = lang();
    for (const code of [l, l.split("-")[0], "en"]) if (S[code] && typeof S[code][key] === "string") return S[code][key];
    return null;
  };
  window.OpenSkyT = function (key, vars, fallback) {
    const text = find(key);
    if (text == null) return fallback != null ? fallback : key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : text;
  };
  // the name of a page: OpenSky's own pages are translated, a web page the family added keeps the name they gave it
  window.OpenSkyT.page = (key, label) => (S.en && typeof S.en[`page.${key}`] === "string" ? window.OpenSkyT(`page.${key}`) : label);
})();
