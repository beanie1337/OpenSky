/* OpenSky phone setup — the page the phone opens (served by MMM-OpenSky-Setup's node helper on the Pi).
 * Pair with the code on the screen, then edit the family's settings. Secrets (links, passwords, tokens) are
 * write-only: the Pi says which are set, never what they are. No libraries; everything is built with el().
 */
(() => {
  "use strict";
  const $app = document.getElementById("app");
  let S = null;              // opensky.json being edited
  let secretsSet = new Set(); // dotted paths of secrets already saved on the Pi
  let pending = {};          // secret changes to send: path → value | null (remove)
  let info = {};             // { presets, timezone, service }
  let dirty = false, saved = false, busy = false;

  /* ---------------- texts ----------------
   * The English wording is the key: phone-sv.js (window.OpenSkyPhone.sv) maps it to Swedish; no entry = English.
   * {name} in a text marks a value filled in by the code. The language is the settings' locale.language, else the phone's. */
  const lang = () => String((S && S.locale && S.locale.language) || navigator.language || "en").toLowerCase().split("-")[0];
  const tr = (text, vars) => {
    const map = (window.OpenSkyPhone || {})[lang()], s = (map && map[text]) || text;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
  };

  /* ---------------- tiny helpers ---------------- */
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "html") e.innerHTML = v;   // only ever used with fixed markup (icons)
      else if (k === "style") String(v).split(";").forEach((d) => { const i = d.indexOf(":"); if (i > 0) e.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim()); });   // (CSP: no style attributes)
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  // When the screen can't be reached the browser only says "Load failed" / "Failed to fetch": say what to check instead
  const offline = () => tr("Can't reach the screen. Check this phone is on the same Wi-Fi as the screen and that setup is still open there (Settings → Set up from your phone), then try again.");
  const api = async (method, url, body) => {
    let r;
    try { r = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-OpenSky": "1" }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new Error(offline()); }
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && d.pair) { showPair(); throw new Error(tr("Please pair again")); }
    if (!r.ok) throw new Error(d.error || tr("Error {code}", { code: r.status }));
    return d;
  };
  const palette = () => (window.OpenSkyEventColors && window.OpenSkyEventColors.PALETTE) || { blue: ["#b9ddff", "#2e8bd6"] };
  const COLORS = ["blue", "pink", "green", "orange", "purple", "teal", "red", "yellow", "emerald", "indigo", "tan", "gray"];
  const hex = (name) => name === "peach" ? "#e8663f" : /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(name || "") ? name : (palette()[name] || palette().blue)[1];   // (a color code shows as itself)
  const ICON = {
    logo: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>`,
    family: `<svg viewBox="0 0 24 24"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/></svg>`,
    lists: `<svg viewBox="0 0 24 24"><path d="M3.5 6.5l1.5 1.5 3-3M3.5 12.5l1.5 1.5 3-3M3.5 18.5l1.5 1.5 3-3"/><path d="M12 7h8.5M12 13h8.5M12 19h8.5"/></svg>`,
    photos: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>`,
    pages: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="18" rx="2"/><rect x="14" y="3" width="7" height="8" rx="2"/><rect x="14" y="15" width="7" height="6" rx="2"/></svg>`,
    web: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
    extras: `<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
    up: `<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>`,
    down: `<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`,
    trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 3.5h4M6 7l1 13h10l1-13"/></svg>`,
    check: `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
    lock: `<svg viewBox="0 0 24 24"><rect x="4" y="10.5" width="16" height="11" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>`,
    backup: `<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`
  };
  const icon = (n, cls = "ic") => el("span", { class: cls, html: ICON[n] });
  const change = () => { dirty = true; saved = false; renderBar(); };
  const setSecret = (p, v) => { pending[p] = v; change(); };
  const isSet = (p) => (p in pending ? pending[p] !== null && pending[p] !== "" : secretsSet.has(p) || [...secretsSet].some((x) => x.startsWith(p + ".")));

  let toastTimer;
  function toast(msg, kind = "") {
    let t = document.querySelector(".toast");
    if (!t) { t = el("div", { class: "toast", role: "status" }); document.body.append(t); }
    t.textContent = msg; t.className = `toast show ${kind}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = `toast ${kind}`; }, kind === "bad" ? 8000 : 2600);   // problems stay long enough to read
  }

  /* ---------------- form controls ---------------- */
  const field = (label, input, hint) => el("label", { class: "field" }, el("span", { class: "label" }, label), input, hint ? el("span", { class: "hint" }, hint) : null);
  function text(value, onchange, attrs = {}) {
    return el("input", { type: "text", class: "input", value: value || "", autocomplete: "off", ...attrs, oninput: (e) => onchange(e.target.value) });
  }
  function secretInput(path, placeholder) {
    return el("input", { type: "password", class: "input", autocomplete: "off", placeholder: isSet(path) ? tr("Saved ✓ — type to replace") : placeholder, oninput: (e) => setSecret(path, e.target.value) });
  }
  function seg(options, value, onpick) {
    const box = el("div", { class: "seg", role: "radiogroup" });
    options.forEach(([v, label]) => box.append(el("button", { type: "button", class: v === value ? "on" : "", role: "radio", "aria-checked": String(v === value), onclick: () => { [...box.children].forEach((b) => { b.className = ""; b.setAttribute("aria-checked", "false"); }); const b = box.children[options.findIndex((o) => o[0] === v)]; b.className = "on"; b.setAttribute("aria-checked", "true"); onpick(v); } }, label)));
    return box;
  }
  function toggle(on, onflip, label) {
    const b = el("button", { type: "button", class: `toggle${on ? " on" : ""}`, role: "switch", "aria-checked": String(!!on), "aria-label": label }, el("span"));
    b.onclick = () => { const v = !b.classList.contains("on"); b.classList.toggle("on", v); b.setAttribute("aria-checked", String(v)); onflip(v); };
    return b;
  }
  function chips(value, onpick, colors = COLORS) {
    const box = el("div", { class: "chips" });
    colors.forEach((c) => box.append(el("button", { type: "button", class: `chip${c === value ? " on" : ""}`, style: `--c:${hex(c)}`, "aria-label": c, onclick: (e) => { box.querySelectorAll(".chip").forEach((x) => x.classList.remove("on")); e.currentTarget.classList.add("on"); onpick(c); } })));
    return box;
  }
  // a calendar's or list's color: a palette chip, or any color as a code (the phone's color picker or typed)
  function colorField(value, onpick) {
    const A = window.OpenSkyAccent, custom = /^#/.test(value || "") ? value : "";
    const box = chips(custom ? "" : value, (c) => { code.value = ""; code.classList.remove("bad"); picker.value = A.hex(c); onpick(c); });
    const useCode = (c) => { box.querySelectorAll(".chip").forEach((x) => x.classList.remove("on")); onpick(c); };
    const picker = el("input", { type: "color", class: "color-pick", value: custom || A.hex(value || "blue"), "aria-label": tr("Pick any color"),
      oninput: (e) => { code.value = e.target.value; code.classList.remove("bad"); useCode(e.target.value); } });
    const code = el("input", { type: "text", class: "input hex-input", value: custom, placeholder: "#8cbfc4", maxlength: "7", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": tr("Color code"),
      oninput: (e) => { const c = A.code(e.target.value); e.target.classList.remove("bad"); if (c) { picker.value = c; useCode(c); } },
      onblur: (e) => { e.target.classList.toggle("bad", !!e.target.value.trim() && !A.code(e.target.value)); } });
    return el("div", { class: "field" }, el("span", { class: "label" }, tr("Color")), box, el("div", { class: "hex-row" }, picker, code));
  }
  // the same icons as the screen's sidebar (OpenSkyIcons in opensky-client.js)
  function iconPicker(value, onpick) {
    const box = el("div", { class: "icon-grid" });
    const names = (window.OpenSkyIcons && window.OpenSkyIcons.webPage) || ["embed"];
    names.forEach((n) => box.append(el("button", { type: "button", class: `icon-pick${n === value ? " on" : ""}`, "aria-label": n, html: window.OpenSkyIcons ? window.OpenSkyIcons.svg(n) : "",
      onclick: (e) => { box.querySelectorAll(".icon-pick").forEach((x) => x.classList.remove("on")); e.currentTarget.classList.add("on"); onpick(n); } })));
    return box;
  }

  function select(options, value, onpick) {
    const s = el("select", { class: "input", onchange: (e) => onpick(e.target.value) });
    options.forEach(([v, label]) => s.append(el("option", { value: v, selected: v === value }, label)));
    return s;
  }
  const section = (id, iconName, title, sub, ...body) => el("section", { class: "card", id }, el("header", { class: "card-head" }, icon(iconName, "card-ic"), el("div", {}, el("h2", {}, title), sub ? el("p", {}, sub) : null)), ...body);
  const row = (dotColor, title, sub, onclick, extra) => el("button", { type: "button", class: "row", onclick }, el("span", { class: "dot", style: `--c:${dotColor}` }), el("span", { class: "row-main" }, el("b", {}, title), sub ? el("small", {}, sub) : null), extra || icon("chevron", "row-go"));

  /* ---------------- bottom sheet ---------------- */
  function sheet(title, build, actions) {
    const close = () => { back.classList.remove("show"); setTimeout(() => back.remove(), 250); document.body.classList.remove("noscroll"); };
    const body = el("div", { class: "sheet-body" });
    const foot = el("div", { class: "sheet-foot" });
    const back = el("div", { class: "sheet-back", onclick: (e) => { if (e.target === back) close(); } },
      el("div", { class: "sheet", role: "dialog", "aria-label": title }, el("div", { class: "grab" }), el("h3", {}, title), body, foot));
    build(body);
    actions.forEach(([label, cls, fn]) => foot.append(el("button", { type: "button", class: `btn ${cls}`, onclick: () => { if (fn() !== false) close(); } }, label)));
    document.body.append(back);
    document.body.classList.add("noscroll");
    requestAnimationFrame(() => back.classList.add("show"));
    return close;
  }

  /* ---------------- pairing ---------------- */
  function showPair(err) {
    $app.innerHTML = "";
    const input = el("input", { class: "code-input", inputmode: "numeric", pattern: "[0-9]*", maxlength: "6", autocomplete: "one-time-code", "aria-label": tr("Pairing code") });
    const boxes = el("div", { class: "code-boxes", onclick: () => input.focus() });
    const draw = () => { boxes.innerHTML = ""; for (let i = 0; i < 6; i++) boxes.append(el("span", { class: i === input.value.length ? "cur" : "" }, input.value[i] || "")); };
    const msg = el("p", { class: "pair-msg" }, err || "");
    const go = el("button", { type: "button", class: "btn primary big", disabled: true }, tr("Connect"));
    const submit = async () => {
      if (input.value.length !== 6 || busy) return;
      busy = true; go.textContent = tr("Connecting…"); go.disabled = true;
      try { await api("POST", "/api/pair", { code: input.value }); busy = false; load(); }
      catch (e) { busy = false; msg.textContent = e.message; msg.className = "pair-msg bad"; input.value = ""; draw(); go.textContent = tr("Connect"); boxes.classList.remove("shake"); void boxes.offsetWidth; boxes.classList.add("shake"); }
    };
    input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 6); draw(); go.disabled = input.value.length !== 6; msg.textContent = ""; if (input.value.length === 6) submit(); });
    go.onclick = submit;
    $app.append(el("div", { class: "pair" },
      el("img", { class: "brand-icon", src: "icon.png", alt: "OpenSky" }),
      el("h1", {}, tr("Connect to your OpenSky")),
      el("p", { class: "lead" }, tr("Type the 6-digit code shown on the screen.")),
      el("div", { class: "code-wrap" }, boxes, input), msg, go,
      el("p", { class: "fine" }, tr("Only phones that know the code can change your screen. The code changes every time setup opens."))));
    draw();
    setTimeout(() => input.focus(), 300);
  }

  /* ---------------- main ---------------- */
  async function load() {   // (returns a promise; the backup restore waits on it)
    try {
      const d = await api("GET", "/api/state");
      S = d.settings; secretsSet = new Set(d.secretsSet || []); pending = {}; info = d; dirty = false; saved = false;
      for (const k of ["family", "locale", "location", "weather", "header", "calendar", "lists", "photos", "pickup", "wordgame", "embeds"]) if (!S[k] || typeof S[k] !== "object") S[k] = {};
      if (!Array.isArray(S.pages)) S.pages = ["home", "calendar", "lists", "timer"];
      if (!Array.isArray(S.calendar.sources)) S.calendar.sources = [];
      if (!Array.isArray(S.lists.lists)) S.lists.lists = [];
      render();
    } catch (e) { if (!/pair/i.test(e.message)) $app.replaceChildren(el("div", { class: "pair" }, el("h1", {}, tr("Couldn't load")), el("p", { class: "lead" }, e.message), el("button", { class: "btn primary big", onclick: load }, tr("Try again")))); }
  }

  function render() {
    const y = window.scrollY;
    $app.innerHTML = "";
    $app.append(
      el("header", { class: "top" }, el("div", { class: "brand" }, el("img", { class: "brand-icon sm", src: "icon.png", alt: "" }), el("div", {}, el("b", {}, "OpenSky"), el("small", {}, S.family.name || tr("Setup"))))),
      el("nav", { class: "jump" }, ...[["family", tr("Family")], ["calendars", tr("Calendars")], ["lists", tr("Lists")], ["photos", tr("Photos")], ["pages", tr("Pages")], ["web", tr("Web pages")], ["extras", tr("Extras")], ["backup", tr("Backup")]].map(([id, t]) => el("a", { href: `#${id}` }, t))),
      familyCard(), calendarsCard(), listsCard(), photosCard(), pagesCard(), webCard(), extrasCard(), backupCard(),
      el("p", { class: "fine end" }, tr("Changes reach the screen when you tap Finish.")),
      el("div", { class: "bar" }));
    renderBar();
    window.scrollTo(0, y);
  }

  function renderBar() {
    const bar = document.querySelector(".bar");
    if (!bar) return;
    bar.innerHTML = "";
    if (dirty) bar.append(el("span", { class: "bar-note" }, tr("Unsaved changes")), el("button", { type: "button", class: "btn primary", onclick: save }, tr("Save")));
    else bar.append(el("span", { class: "bar-note" }, saved ? tr("Saved ✓") : tr("All saved")), el("button", { type: "button", class: "btn primary", onclick: finish }, tr("Finish")));
  }

  async function save() {
    if (busy) return;
    busy = true;
    const btn = document.querySelector(".bar .btn"); if (btn) { btn.textContent = tr("Saving…"); btn.disabled = true; }
    try {
      const r = await api("POST", "/api/save", { settings: S, secrets: pending });
      secretsSet = new Set(r.secretsSet || []); pending = {}; dirty = false; saved = true; busy = false;
      toast(tr("Saved"), "good"); render();
    } catch (e) { busy = false; toast(e.message, "bad"); renderBar(); }
  }

  async function finish() {
    if (busy) return;
    busy = true;
    try {
      const r = await api("POST", "/api/done");
      $app.innerHTML = "";
      $app.append(el("div", { class: "pair done" }, el("div", { class: "logo good" }, icon("check")),
        el("h1", {}, tr("All set!")),
        el("p", { class: "lead" }, r.restarting ? tr("Your screen is restarting with the new settings — give it about half a minute.") : tr("Saved. Restart OpenSky on the Pi to see the changes (opensky restart).")),
        el("p", { class: "fine" }, tr("To change things later: Settings → Set up from your phone."))));
    } catch (e) { busy = false; toast(e.message, "bad"); }
  }

  /* ---------------- sections ---------------- */
  function familyCard() {
    const loc = S.location, place = el("div", { class: "place" });
    const drawPlace = () => {
      place.innerHTML = "";
      place.append(el("div", { class: "place-now" }, el("b", {}, loc.name || tr("Not set")), el("small", {}, loc.latitude != null ? tr("Weather, °F/°C and clock follow this") : tr("Needed for the weather"))),
        el("button", { type: "button", class: "btn small", onclick: pickPlace }, loc.name ? tr("Change") : tr("Choose")));
    };
    const pickPlace = () => {
      let results = el("div", { class: "results" });
      const q = text("", () => {}, { placeholder: tr("Town or city, e.g. Boston"), enterkeyhint: "search" });
      const search = async () => {
        results.replaceChildren(el("p", { class: "hint" }, tr("Looking…")));
        try {
          const d = await api("GET", `/api/geocode?q=${encodeURIComponent(q.value)}`);
          results.replaceChildren(...(d.results.length ? d.results.map((r) => el("button", { type: "button", class: "row", onclick: () => { applyPlace(r); close(); } },
            el("span", { class: "row-main" }, el("b", {}, r.name), el("small", {}, [r.admin1, r.country].filter(Boolean).join(", "))), icon("chevron", "row-go"))) : [el("p", { class: "hint" }, tr("Nothing found — try a nearby bigger town."))]));
        } catch (e) { results.replaceChildren(el("p", { class: "hint bad" }, e.message)); }
      };
      q.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
      const close = sheet(tr("Where are you?"), (b) => { b.append(el("div", { class: "search" }, q, el("button", { type: "button", class: "btn primary", onclick: search }, tr("Search"))), results); setTimeout(() => q.focus(), 300); }, [[tr("Cancel"), "", () => {}]]);
    };
    const applyPlace = (r) => {
      const us = r.country_code === "US";
      loc.name = us && r.admin1 ? `${r.name}, ${r.admin1}` : [r.name, r.country].filter(Boolean).join(", ");
      loc.latitude = Math.round(r.latitude * 10000) / 10000; loc.longitude = Math.round(r.longitude * 10000) / 10000;
      S.locale.units = ["US", "LR", "MM"].includes(r.country_code) ? "imperial" : "metric";
      if (r.country_code) { S.locale.country = r.country_code; if (S.calendar.holidays !== "none") S.calendar.holidays = r.country_code; }
      S.locale.timeFormat = ["US", "CA", "AU", "NZ", "PH", "IN", "MX"].includes(r.country_code) ? 12 : 24;
      if (r.timezone && info.timezone && r.timezone !== info.timezone) toast(tr("Heads-up: the Pi's clock is set to {tz}", { tz: info.timezone }), "");
      change(); render();
    };
    drawPlace();
    return section("family", "family", tr("Your family"), tr("Shown at the top of the screen"),
      field(tr("Family name"), text(S.family.name, (v) => { S.family.name = v; change(); }, { placeholder: tr("e.g. The Smiths"), maxlength: "40" })),
      el("div", { class: "field" }, el("span", { class: "label" }, tr("Town (for the weather)")), place),
      field(tr("Language"), seg([["en", "English"], ["sv", "Svenska"]], S.locale.language === "sv" ? "sv" : "en", (v) => {
        // the language also sets how dates are written (Sunday 8 November or Sunday, November 8)
        S.locale.language = v;
        S.locale.locale = v === "sv" ? "sv-SE" : (S.locale.country === "GB" ? "en-GB" : "en-US");
        change(); render();
      }), tr("The words on the screen. Dates follow it; the screen shows the change after it restarts.")),
      el("div", { class: "two" },
        field(tr("Temperature"), seg([["imperial", "°F"], ["metric", "°C"]], S.locale.units || "imperial", (v) => { S.locale.units = v; change(); })),
        field(tr("Clock"), seg([[12, tr("12-hour")], [24, tr("24-hour")]], S.locale.timeFormat === 24 ? 24 : 12, (v) => { S.locale.timeFormat = v; change(); }))),
      field(tr("Week starts on"), seg([[0, tr("Sunday")], [1, tr("Monday")]], S.locale.firstDayOfWeek === 1 ? 1 : 0, (v) => { S.locale.firstDayOfWeek = v; change(); })));
  }

  function calendarsCard() {
    const cal = S.calendar, list = el("div", { class: "rows" });
    const kind = (c) => c.type === "local" ? tr("On this screen · add & edit on the screen") : c.type === "caldav" ? tr("iCloud / CalDAV · add & edit") : c.type === "google" ? `Google${c.readOnly ? ` · ${tr("view only")}` : ` · ${tr("add & edit")}`}` : tr("Calendar link · read-only");
    cal.sources.forEach((c, i) => list.append(row(hex(c.color || "blue"), c.name, kind(c), () => editCalendar(i))));
    if (!cal.sources.length) list.append(el("p", { class: "empty" }, tr("No calendars yet.")));
    return section("calendars", "calendar", tr("Calendars"), tr("Each with its own color"),
      list,
      el("button", { type: "button", class: "add", onclick: addCalendar }, icon("plus"), tr("Add a calendar")),
      el("div", { class: "line" }, el("span", {}, el("b", {}, tr("Public holidays")), el("small", {}, `${S.locale.country || (cal.holidays && cal.holidays !== "none" ? cal.holidays : "US")} · ${tr("on the calendar and the countdown")}`)),
        toggle(!!cal.holidays && cal.holidays !== "none", (v) => { cal.holidays = v ? (S.locale.country || "US") : "none"; change(); }, tr("Public holidays"))));
  }

  function nameOk(name, taken) {
    if (!name) return tr("Please give it a name");
    if (/[.]/.test(name)) return tr("Names can't contain a dot");
    if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) return tr("That name is already used");
    return null;
  }

  function addCalendar() {
    const d = { kind: "link", name: "", color: COLORS[S.calendar.sources.length % COLORS.length], link: "", server: "icloud", url: "", user: "", pass: "", remote: "",
      g: null, gcals: null, gcal: "", gurl: "", cid: "", csec: "", gaddr: "", gbusy: false, gerr: "" };
    const err = el("p", { class: "err" });
    sheet(tr("Add a calendar"), (b) => {
      const parts = el("div");
      const draw = () => {
        parts.replaceChildren(
          ...(d.kind === "google" ? [googleBox()] : []),
          ...(d.kind !== "google" || d.gcals ? [
            field(tr("Name"), text(d.name, (v) => { d.name = v.trim(); d.named = true; }, { placeholder: d.kind === "local" ? tr("e.g. Family") : tr("e.g. Mom, School, Soccer") })),
            colorField(d.color, (c) => { d.color = c; })] : []),
          ...(d.kind === "link" ? [
            field(tr("Calendar link"), el("textarea", { class: "input", rows: "3", placeholder: "https://… or webcal://…", oninput: (e) => { d.link = e.target.value.trim(); } }), tr("Kept private on the Pi.")),
            el("details", { class: "help" }, el("summary", {}, tr("Where do I find the link?")),
              el("p", {}, el("b", {}, "Google: "), tr("on a computer, Settings → your calendar → Integrate calendar → Secret address in iCal format.")),
              el("p", {}, el("b", {}, "Outlook: "), tr("Settings → Calendar → Shared calendars → Publish a calendar → the ICS link.")),
              el("p", {}, el("b", {}, tr("iCloud (read-only): ")), tr("Calendar app → ⓘ next to the calendar → Public Calendar → Share link.")),
              el("p", {}, tr("School and team calendars usually have an “iCal”, “ICS” or “Subscribe” link.")))
          ] : []),
          ...(d.kind === "caldav" ? [
            field(tr("Service"), select([["icloud", "iCloud"], ["fastmail", "Fastmail"], ["other", tr("Nextcloud / other CalDAV")]], d.server, (v) => { d.server = v; draw(); })),
            ...(d.server === "other" ? [field(tr("Server address"), text(d.url, (v) => { d.url = v.trim(); }, { placeholder: "https://your-server/remote.php/dav/", inputmode: "url" }))] : []),
            field(d.server === "icloud" ? tr("Apple ID (email)") : tr("Username"), text(d.user, (v) => { d.user = v.trim(); }, { inputmode: "email", autocapitalize: "off" })),
            field(d.server === "icloud" ? tr("App-specific password") : tr("Password (an app password if you have one)"), el("input", { type: "password", class: "input", autocomplete: "off", oninput: (e) => { d.pass = e.target.value.trim(); } }),
              d.server === "icloud" ? tr("Not your Apple ID password: make one at appleid.apple.com → Sign-In and Security → App-Specific Passwords.") : null),
            field(tr("Calendar's name in your calendar app"), text(d.remote, (v) => { d.remote = v.trim(); }, { placeholder: tr("Same as the name above if empty") }))
          ] : []),
          ...(d.kind === "local" ? [el("p", { class: "hint" }, tr("Events are kept on the Pi — no account needed. Add and edit them right on the screen."))] : []),
          err);
      };
      // Google: sign in once (guided), then pick one of the account's calendars
      const googleBox = () => {
        const box = el("div", { class: "gbox" });
        const run = async (fn) => { d.gbusy = true; d.gerr = ""; draw(); try { await fn(); } catch (e) { d.gerr = e.message; } d.gbusy = false; draw(); };
        if (!d.g) { box.append(el("p", { class: "hint" }, tr("Checking Google…"))); api("GET", "/api/google").then((g) => { d.g = g; draw(); }, (e) => { d.gerr = e.message; d.g = { clientSet: false, signedIn: false }; draw(); }); return box; }
        if (d.g.signedIn) {
          if (!d.gcals && !d.gbusy && !d.gerr) run(async () => { d.gcals = (await api("GET", "/api/google/calendars")).calendars; });
          if (d.gcals) {
            const pick = (id) => { d.gcal = id; const c = d.gcals.find((x) => x.id === id); if (c && !d.named) d.name = c.primary ? "Family" : c.name.slice(0, 30); };
            if (!d.gcal && d.gcals.length) pick(d.gcals[0].id);
            box.append(el("p", { class: "good-note" }, tr("Signed in to Google ✓")),
              field(tr("Which Google calendar?"), select(d.gcals.map((c) => [c.id, `${c.primary ? tr("Main calendar") : c.name}${c.canEdit ? "" : ` (${tr("view only")})`}`]), d.gcal, (v) => { pick(v); draw(); })));
          }
        } else {
          box.append(el("details", { class: "help", open: !d.g.clientSet },
            el("summary", {}, tr("First: your own Google key (once, about 5 minutes)")),
            el("p", {}, tr("Google asks every MagicMirror screen to have its own key. On a computer, open console.cloud.google.com and:")),
            el("ol", { class: "steps" },
              el("li", {}, tr("Create a project (any name, e.g. OpenSky).")),
              el("li", {}, tr("APIs & Services → Library → “Google Calendar API” → Enable.")),
              el("li", {}, tr("Google Auth platform → Get started: app name “OpenSky”, your email, audience “External”.")),
              el("li", {}, tr("Audience → Publish app → In production (otherwise the sign-in stops working after 7 days).")),
              el("li", {}, tr("Clients → Create client → type “Desktop app” → copy the Client ID and Client secret below."))),
            el("p", {}, tr("Step-by-step with pictures: docs/google-calendar.md in OpenSky."))));
          if (!d.g.clientSet) box.append(
            field(tr("Client ID"), text(d.cid, (v) => { d.cid = v.trim(); }, { placeholder: "….apps.googleusercontent.com", autocapitalize: "off" })),
            field(tr("Client secret"), el("input", { type: "password", class: "input", autocomplete: "off", value: d.csec, oninput: (e) => { d.csec = e.target.value.trim(); } })));
          if (!d.gurl) box.append(el("button", { type: "button", class: "btn primary block", disabled: d.gbusy, onclick: () => run(async () => { d.gurl = (await api("POST", "/api/google/start", d.g.clientSet ? {} : { clientId: d.cid, clientSecret: d.csec })).url; d.g.clientSet = true; }) }, d.gbusy ? tr("One moment…") : tr("Get the Google sign-in")));
          else box.append(
            el("a", { class: "btn primary block", href: d.gurl, target: "_blank", rel: "noopener" }, tr("Sign in with Google")),
            el("p", { class: "hint" }, tr("Google may say it hasn't verified the app — it's your own key: tap Advanced → Go to OpenSky, then allow both permissions. At the end your browser shows a page that can't be reached (http://127.0.0.1…). That's expected: copy that whole address and paste it here.")),
            el("textarea", { class: "input", rows: "3", placeholder: "http://127.0.0.1:53682/?code=…", oninput: (e) => { d.gaddr = e.target.value.trim(); } }, d.gaddr),
            el("button", { type: "button", class: "btn primary block", disabled: d.gbusy, onclick: () => run(async () => { const r = await api("POST", "/api/google/finish", { address: d.gaddr }); d.gcals = r.calendars; d.g.signedIn = true; }) }, d.gbusy ? tr("Signing in…") : tr("Finish sign-in")));
        }
        if (d.gerr) box.append(el("p", { class: "err" }, d.gerr));
        return box;
      };
      b.append(seg([["link", tr("Link")], ["google", "Google"], ["caldav", tr("iCloud & co.")], ["local", tr("On screen")]], d.kind, (v) => { d.kind = v; draw(); }), parts);
      draw();
    }, [[tr("Cancel"), "", () => {}], [tr("Add"), "primary", () => {
      const bad = nameOk(d.name, S.calendar.sources.map((c) => c.name)) ||
        (d.kind === "link" && !/^(https?|webcal):\/\/\S+$/i.test(d.link) ? tr("Paste the calendar's link (it starts with https:// or webcal://)") : null) ||
        (d.kind === "caldav" && (!d.user || !d.pass) ? tr("Please fill in the username and password") : null) ||
        (d.kind === "google" && !d.gcal ? tr("Sign in to Google and pick a calendar first") : null) ||
        (d.kind === "caldav" && d.server === "other" && !/^https?:\/\//.test(d.url) ? tr("Please add the server address") : null);
      if (bad) { err.textContent = bad; return false; }
      const src = { name: d.name, color: d.color };
      if (d.kind === "local") src.type = "local";
      if (d.kind === "google") { src.type = "google"; src.calendarId = d.gcal; const c = (d.gcals || []).find((x) => x.id === d.gcal); if (c && !c.canEdit) src.readOnly = true; }
      if (d.kind === "caldav") {
        src.type = "caldav";
        const url = d.server === "icloud" ? "https://caldav.icloud.com/" : d.server === "fastmail" ? "https://caldav.fastmail.com/" : d.url;
        pending[`calendar.caldav.${d.name}`] = { url, username: d.user, password: d.pass, calendar: d.remote || d.name };
      }
      if (d.kind === "link") pending[`calendar.sources.${d.name}`] = d.link;
      S.calendar.sources.push(src);
      change(); render();
    }]]);
  }

  function editCalendar(i) {
    const c = S.calendar.sources[i];
    let color = c.color || "blue";
    sheet(c.name, (b) => {
      b.append(colorField(color, (v) => { color = v; }));
      if (c.type !== "local" && c.type !== "caldav" && c.type !== "google") b.append(field(tr("Replace the link"), el("textarea", { class: "input", rows: "2", placeholder: isSet(`calendar.sources.${c.name}`) ? tr("Saved ✓ — paste a new link to replace it") : "https://… or webcal://…", oninput: (e) => { if (e.target.value.trim()) pending[`calendar.sources.${c.name}`] = e.target.value.trim(); } })));
      if (c.type === "caldav") b.append(field(tr("New password"), el("input", { type: "password", class: "input", placeholder: tr("Saved ✓ — type to replace"), oninput: (e) => { if (e.target.value.trim()) pending[`calendar.caldav.${c.name}`] = { password: e.target.value.trim() }; } })));
      if (c.type === "local") b.append(el("p", { class: "hint" }, tr("Removing it here takes it off the screen. Its events stay saved on the Pi.")));
    }, [[tr("Remove"), "danger", () => {
      S.calendar.sources.splice(i, 1);
      if (isSet(`calendar.sources.${c.name}`)) pending[`calendar.sources.${c.name}`] = null;
      if (isSet(`calendar.caldav.${c.name}`)) pending[`calendar.caldav.${c.name}`] = null;
      change(); render();
    }], [tr("Done"), "primary", () => { c.color = color; change(); render(); }]]);
  }

  function listsCard() {
    const L = S.lists, rows = el("div", { class: "rows" });
    const where = (l) => l.provider === "todoist" ? `Todoist${l.project && l.project !== l.name ? ` · ${tr("project “{name}”", { name: l.project })}` : ""}` : l.provider === "homeassistant" ? `Home Assistant · ${l.entity || "?"}` : tr("On this screen");
    L.lists.forEach((l, i) => rows.append(row(hex(l.color || "blue"), l.name, where(l), () => editList(i))));
    if (!L.lists.length) rows.append(el("p", { class: "empty" }, tr("No lists yet.")));
    const usesTodoist = L.lists.some((l) => l.provider === "todoist"), usesHA = L.lists.some((l) => l.provider === "homeassistant");
    return section("lists", "lists", tr("Lists"), tr("Groceries, to-dos… the first three show on Home"),
      rows,
      el("button", { type: "button", class: "add", onclick: addList }, icon("plus"), tr("Add a list")),
      usesTodoist ? field(tr("Todoist API token"), secretInput("lists.todoist.token", tr("Paste your token")), tr("Todoist → Settings → Integrations → Developer → API token.")) : null,
      usesHA ? field(tr("Home Assistant address"), secretInput("homeassistant.url", "http://homeassistant.local:8123")) : null,
      usesHA ? field(tr("Home Assistant token"), secretInput("homeassistant.token", tr("Paste a long-lived access token")), tr("In Home Assistant: your profile → Security → Long-lived access tokens → Create token.")) : null);
  }

  function addList() {
    const d = { name: "", color: COLORS[(S.lists.lists.length + 3) % COLORS.length], provider: "local", project: "", entity: "" };
    const err = el("p", { class: "err" });
    sheet(tr("Add a list"), (b) => {
      const extra = el("div");
      const draw = () => extra.replaceChildren(...(d.provider === "todoist" ? [field(tr("Todoist project"), text(d.project, (v) => { d.project = v.trim(); }, { placeholder: tr("Same as the list's name if empty") }))]
        : d.provider === "homeassistant" ? [field(tr("Home Assistant to-do list"), text(d.entity, (v) => { d.entity = v.trim().toLowerCase(); }, { placeholder: "todo.shopping_list", autocapitalize: "off" }), tr("Its entity ID (Settings → Entities in Home Assistant). Address and token go below the lists."))]
        : [el("p", { class: "hint" }, tr("Kept on the Pi — no account needed."))]));
      b.append(field(tr("Name"), text("", (v) => { d.name = v.trim(); }, { placeholder: tr("e.g. Groceries") })),
        colorField(d.color, (c) => { d.color = c; }),
        field(tr("Kept in"), seg([["local", tr("This screen")], ["todoist", "Todoist"], ["homeassistant", "Home Assistant"]], d.provider, (v) => { d.provider = v; draw(); })), extra, err);
      draw();
    }, [[tr("Cancel"), "", () => {}], [tr("Add"), "primary", () => {
      const bad = nameOk(d.name, S.lists.lists.map((l) => l.name)) || (d.provider === "homeassistant" && !/^todo\.[a-z0-9_]+$/.test(d.entity) ? tr("The list's entity ID looks like todo.shopping_list") : null);
      if (bad) { err.textContent = bad; return false; }
      const l = { name: d.name, color: d.color };
      if (d.provider === "todoist") { l.provider = "todoist"; if (d.project && d.project !== d.name) l.project = d.project; }
      if (d.provider === "homeassistant") { l.provider = "homeassistant"; l.entity = d.entity; }
      S.lists.lists.push(l);
      if (!S.pages.includes("lists") && S.lists.lists.length > 3) S.pages.splice(Math.min(3, S.pages.length), 0, "lists");
      change(); render();
    }]]);
  }

  function editList(i) {
    const l = S.lists.lists[i];
    let color = l.color || "blue";
    sheet(l.name, (b) => {
      b.append(colorField(color, (v) => { color = v; }));
      if (l.provider !== "todoist") b.append(el("p", { class: "hint" }, tr("Removing the list takes it off the screen; its items stay saved on the Pi.")));
    }, [[tr("Remove"), "danger", () => { S.lists.lists.splice(i, 1); change(); render(); }], [tr("Done"), "primary", () => { l.color = color; change(); render(); }]]);
  }

  function photosCard() {
    const P = S.photos, body = el("div");
    const mode = P.enabled === false ? "off" : P.provider === "immich" ? "immich" : "folder";
    const draw = (m) => body.replaceChildren(...(m === "folder" ? [
      field(tr("Folder on the Pi"), text(P.folder || "~/Pictures", (v) => { P.folder = v.trim(); change(); }), tr("Copy photos into it over the network — or use a USB stick:")),
      el("div", { class: "line" }, el("span", {}, el("b", {}, tr("USB stick")), el("small", {}, tr("Photos in a folder named “OpenSky” on a stick"))), toggle(P.usb !== false, (v) => { P.usb = v; change(); }, tr("USB stick")))
    ] : m === "immich" ? [
      field(tr("Immich address"), text(P.url, (v) => { P.url = v.trim(); change(); }, { placeholder: "http://192.168.1.20:2283", inputmode: "url", autocapitalize: "off" })),
      field(tr("Immich API key"), secretInput("photos.immich.apiKey", tr("Paste the key")), tr("In Immich: Account Settings → API Keys."))
    ] : [el("p", { class: "hint" }, tr("No photo card — the lists get more room."))]));
    draw(mode);
    return section("photos", "photos", tr("Photos"), tr("A slideshow on the Home page"),
      seg([["folder", tr("On the Pi")], ["immich", "Immich"], ["off", tr("Off")]], mode, (m) => { P.enabled = m !== "off"; if (m !== "off") P.provider = m; change(); draw(m); }),
      body,
      field(tr("Change photo every"), select([[15, tr("15 seconds")], [30, tr("30 seconds")], [60, tr("1 minute")], [300, tr("5 minutes")]], Number(P.intervalSeconds) || 30, (v) => { P.intervalSeconds = Number(v); change(); })));
  }

  function pagesCard() {
    const names = { home: tr("Home"), calendar: tr("Calendar"), lists: tr("Lists"), wordgame: tr("Word Game"), timer: tr("Timer"), music: tr("Music") };
    for (const [k, e] of Object.entries(S.embeds)) names[k] = (e && e.title) || k;
    const all = [...S.pages.filter((p) => names[p]), ...Object.keys(names).filter((k) => !S.pages.includes(k))];
    const box = el("div", { class: "rows" });
    all.forEach((k) => {
      const on = S.pages.includes(k), i = S.pages.indexOf(k);
      box.append(el("div", { class: `pagerow${on ? "" : " off"}` },
        el("span", { class: "row-main" }, el("b", {}, names[k])),
        on ? el("span", { class: "order" },
          el("button", { type: "button", class: "mini", "aria-label": tr("Up"), disabled: i === 0, onclick: () => { S.pages.splice(i, 1); S.pages.splice(i - 1, 0, k); change(); render(); }, html: ICON.up }),
          el("button", { type: "button", class: "mini", "aria-label": tr("Down"), disabled: i === S.pages.length - 1, onclick: () => { S.pages.splice(i, 1); S.pages.splice(i + 1, 0, k); change(); render(); }, html: ICON.down })) : null,
        toggle(on, (v) => { if (v) S.pages.push(k); else if (S.pages.length > 1) S.pages.splice(S.pages.indexOf(k), 1); change(); render(); }, names[k])));
    });
    return section("pages", "pages", tr("Pages"), tr("The buttons down the left side, top to bottom. The first is where the screen goes back to when idle."), box);
  }

  function webRow(k, e, sub, onclick, extra) {
    const r = row("#6b7280", (e && e.title) || k, sub, onclick, extra);
    const ic = el("span", { class: "row-icon", html: window.OpenSkyIcons ? window.OpenSkyIcons.svg((e && e.icon) || (k === "smarthome" ? "smarthome" : "embed")) : "" });
    r.querySelector(".dot").replaceWith(ic);
    return r;
  }

  function webCard() {
    const rows = el("div", { class: "rows" });
    Object.entries(S.embeds).forEach(([k, e]) => rows.append(webRow(k, e, isSet(`embeds.${k}.pin`) ? tr("Locked with a PIN") : (e && e.url) || tr("Private address"), () => editWeb(k), isSet(`embeds.${k}.pin`) ? icon("lock", "row-go") : null)));
    if (!Object.keys(S.embeds).length) rows.append(el("p", { class: "empty" }, tr("None yet.")));
    return section("web", "web", tr("Web pages"), tr("A page of its own for a Home Assistant dashboard, a camera, a website…"),
      rows, el("button", { type: "button", class: "add", onclick: addWeb }, icon("plus"), tr("Add a web page")));
  }

  function addWeb() {
    const d = { title: "", url: "", pin: "", icon: "globe" };
    const err = el("p", { class: "err" });
    sheet(tr("Add a web page"), (b) => b.append(
      field(tr("Button label"), text("", (v) => { d.title = v.trim(); }, { placeholder: tr("e.g. Smart Home"), maxlength: "14" })),
      field(tr("Address"), text("", (v) => { d.url = v.trim(); }, { placeholder: "http://homeassistant.local:8123", inputmode: "url", autocapitalize: "off" })),
      el("div", { class: "field" }, el("span", { class: "label" }, tr("Icon")), iconPicker(d.icon, (i) => { d.icon = i; })),
      field(tr("PIN (optional)"), el("input", { type: "password", class: "input", inputmode: "numeric", maxlength: "8", placeholder: tr("4–8 digits to lock the page"), oninput: (e) => { d.pin = e.target.value.replace(/\D/g, ""); } }), tr("With a PIN, the page asks for it every time it opens.")),
      err), [[tr("Cancel"), "", () => {}], [tr("Add"), "primary", () => {
      let key = d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "web";
      if (/^[^a-z]/.test(key)) key = `web-${key}`;
      const reserved = ["home", "calendar", "lists", "wordgame", "timer", "settings"];
      while (S.embeds[key] || reserved.includes(key)) key += "-2";
      const bad = !d.title ? tr("Please give it a label") : !/^https?:\/\/\S+$/i.test(d.url) ? tr("The address starts with http:// or https://") : d.pin && !/^\d{4,8}$/.test(d.pin) ? tr("A PIN is 4 to 8 digits") : null;
      if (bad) { err.textContent = bad; return false; }
      S.embeds[key] = d.pin ? { title: d.title, icon: d.icon } : { title: d.title, icon: d.icon, url: d.url };
      if (d.pin) { pending[`embeds.${key}.url`] = d.url; pending[`embeds.${key}.pin`] = d.pin; }
      if (!S.pages.includes(key)) S.pages.splice(Math.max(1, S.pages.length - 1), 0, key);
      change(); render();
    }]]);
  }

  function editWeb(k) {
    const e = S.embeds[k];
    sheet((e && e.title) || k, (b) => b.append(el("p", { class: "hint" }, isSet(`embeds.${k}.pin`) ? tr("This page is locked with a PIN.") : tr("Address: {url}", { url: (e && e.url) || tr("private") }))),
      [[tr("Remove"), "danger", () => {
        delete S.embeds[k];
        S.pages = S.pages.filter((p) => p !== k);
        if (isSet(`embeds.${k}`)) pending[`embeds.${k}`] = null;
        change(); render();
      }], [tr("Done"), "primary", () => {}]]);
  }

  // accent color: a palette chip, or any color as a code (#rrggbb) — typed, or picked with the phone's color picker
  function accentField() {
    const A = window.OpenSkyAccent;
    const now = (S.look && S.look.accent) || "peach", custom = /^#/.test(now) ? now : "";
    const set = (c) => { S.look = S.look || {}; if (c === "peach") delete S.look.accent; else S.look.accent = c; change(); };
    const warn = el("span", { class: "hint bad", hidden: true }, tr("That color is very light: white text on buttons will be hard to read."));
    const showWarn = (c) => { warn.hidden = !(c && A.light(c)); };
    const box = chips(custom ? "" : now, (c) => { code.value = ""; code.classList.remove("bad"); picker.value = A.hex(c); showWarn(null); set(c); }, ["peach", ...COLORS.filter((c) => c !== "gray")]);
    const useCode = (c) => { box.querySelectorAll(".chip").forEach((x) => x.classList.remove("on")); showWarn(c); set(c); };
    const picker = el("input", { type: "color", class: "color-pick", value: A.hex(now), "aria-label": tr("Pick any color"),
      oninput: (e) => { code.value = e.target.value; code.classList.remove("bad"); useCode(e.target.value); } });
    const code = el("input", { type: "text", class: "input hex-input", value: custom, placeholder: "#3b82f6", maxlength: "7", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": tr("Color code"),
      oninput: (e) => { const c = A.code(e.target.value); e.target.classList.remove("bad"); if (c) { picker.value = c; useCode(c); } },
      onblur: (e) => { e.target.classList.toggle("bad", !!e.target.value.trim() && !A.code(e.target.value)); } });
    showWarn(custom || null);
    return el("div", { class: "field" }, el("span", { class: "label" }, tr("Accent color (buttons, highlights)")), box,
      el("div", { class: "hex-row" }, picker, code), el("span", { class: "hint" }, tr("Or any color: tap the swatch to pick one, or type its code (e.g. your team's color).")), warn);
  }

  function extrasCard() {
    const pk = S.pickup, hd = S.header, wg = S.wordgame, w = S.weather;
    if (!hd.sports || typeof hd.sports !== "object") hd.sports = { league: "nfl", team: "" };
    const days = [["", tr("No pickup icons")], ["monday", tr("Monday")], ["tuesday", tr("Tuesday")], ["wednesday", tr("Wednesday")], ["thursday", tr("Thursday")], ["friday", tr("Friday")]];
    const weatherKey = el("div");
    const drawWeather = (p) => weatherKey.replaceChildren(...(p === "openweathermap" ? [field(tr("OpenWeatherMap API key"), secretInput("weather.openweathermap.apiKey", tr("Paste the key")))] : []));
    drawWeather(w.provider || "open-meteo");
    return section("extras", "extras", tr("Extras"), null,
      accentField(),
      field(tr("Trash day"), select(days, pk.trashDay || "", (v) => { pk.trashDay = v; change(); })),
      (info.presets || []).length ? field(tr("City pickup schedule"), select([["", tr("None — just my trash day")], ...info.presets.map((p) => [p, p.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ (\w\w)$/, (m) => m.toUpperCase())])], pk.preset || "", (v) => { pk.preset = v; change(); }), tr("Adds recycling, yard waste and holiday delays.")) : null,
      field(tr("Or a pickup calendar link"), el("input", { type: "password", class: "input", autocomplete: "off", inputmode: "url",
        placeholder: isSet("calendar.sources.Pickup") ? tr("Saved ✓ — paste a new link to replace it") : tr("https://… (your city or ReCollect)"),
        oninput: (e) => { const v = e.target.value.trim(); pending["calendar.sources.Pickup"] = v; pk.url = v ? "secret" : (isSet("calendar.sources.Pickup") ? "secret" : ""); if (!pk.url) delete pk.url; change(); } }),
        tr("Many cities publish trash & recycling days as a calendar. Its events become the icons. Kept private (it can contain your address).")),
      el("div", { class: "two" },
        field(tr("Sports league"), select([["nfl", "NFL"], ["college-football", tr("College football")], ["nba", "NBA"], ["wnba", "WNBA"], ["mens-college-basketball", tr("College basketball")], ["mlb", "MLB"], ["nhl", "NHL"], ["mls", "MLS"], ["nwsl", "NWSL"], ["epl", "Premier League"]], hd.sports.league || "nfl", (v) => { hd.sports.league = v; change(); })),
        field(tr("Team code"), text(hd.sports.team, (v) => { hd.sports.team = v.trim().toUpperCase(); change(); }, { placeholder: tr("e.g. NE"), maxlength: "5", autocapitalize: "characters" }), tr("Game-day pill. Empty = off."))),
      field(tr("Word game"), seg([["nyt", tr("NYT's daily word")], ["opensky", tr("OpenSky's words")]], wg.source === "opensky" ? "opensky" : "nyt", (v) => { wg.source = v; change(); })),
      ...musicFields(),
      field(tr("Weather from"), seg([["open-meteo", tr("Open-Meteo (free)")], ["openweathermap", "OpenWeatherMap"]], w.provider || "open-meteo", (v) => { w.provider = v; change(); drawWeather(v); })),
      weatherKey);
  }

  // Music page: this screen as a speaker (the add-on: name, AirPlay / Spotify) and other speakers to control
  // (Home Assistant media players). Shown once the Music page is on, or the add-on is installed.
  function musicFields() {
    const inst = (info.addons && info.addons.music) || {};
    if (!S.pages.includes("music") && !inst.spotify && !inst.airplay) return [];
    if (!S.music || typeof S.music !== "object") S.music = {};
    const M = S.music;
    if (!Array.isArray(M.speakers)) M.speakers = [];
    const others = el("div", { class: "rows" });
    let found = null;   // [{ id, name, state }] once looked up
    const drawOthers = () => {
      const list = found ? [...found, ...M.speakers.filter((id) => !found.some((f) => f.id === id)).map((id) => ({ id, name: id, state: tr("not found") }))]
        : M.speakers.map((id) => ({ id, name: id, state: "" }));
      others.replaceChildren(...list.map((sp) => el("div", { class: "line" },
        el("span", {}, el("b", {}, sp.name), el("small", {}, sp.state && sp.state !== "unknown" ? `${sp.id} · ${sp.state}` : sp.id)),
        toggle(M.speakers.includes(sp.id), (v) => { M.speakers = v ? [...M.speakers.filter((x) => x !== sp.id), sp.id] : M.speakers.filter((x) => x !== sp.id); change(); }, sp.name))));
      if (found && !found.length) others.append(el("p", { class: "hint" }, tr("Home Assistant has no speakers (media players).")));
    };
    drawOthers();
    const haSet = isSet("homeassistant.url") && isSet("homeassistant.token");
    const find = el("button", { type: "button", class: "btn block", onclick: async (e) => {
      if (Object.keys(pending).some((k) => k.startsWith("homeassistant."))) return toast(tr("Save first, then look for speakers"), "bad");
      const b = e.currentTarget; b.disabled = true; b.textContent = tr("Looking…");
      try { found = (await api("GET", "/api/music/speakers")).speakers; drawOthers(); }
      catch (x) { toast(x.message, "bad"); }
      b.disabled = false; b.textContent = tr("Find my speakers");
    } }, tr("Find my speakers"));
    return [
      el("h4", { class: "sub-title" }, tr("Music")),
      !inst.spotify && !inst.airplay ? el("p", { class: "hint" }, tr("To use this screen as a speaker, on the Pi open Terminal and type  opensky addon music. Other speakers (below) work without it.")) : null,
      field(tr("Speaker name"), text(M.name || "", (v) => { M.name = v.trim(); if (!M.name) delete M.name; change(); }, { placeholder: S.family.name || "OpenSky", maxlength: "40" }), tr("What phones show in the AirPlay and Spotify speaker lists.")),
      el("div", { class: "line" }, el("span", {}, el("b", {}, "AirPlay"), el("small", {}, tr("iPhone, iPad, Mac"))), toggle(M.airplay !== false, (v) => { M.airplay = v; change(); }, "AirPlay")),
      el("div", { class: "line" }, el("span", {}, el("b", {}, "Spotify Connect"), el("small", {}, tr("Needs Spotify Premium"))), toggle(M.spotify !== false, (v) => { M.spotify = v; change(); }, "Spotify Connect")),
      el("h4", { class: "sub-title" }, tr("Other speakers to control")),
      el("p", { class: "hint" }, tr("Sonos, HomePod, Echo, Google speakers… through Home Assistant: the Music page gets a tab for each, with its song, buttons and volume.")),
      ...(haSet ? [] : [field(tr("Home Assistant address"), secretInput("homeassistant.url", "http://homeassistant.local:8123")),
        field(tr("Home Assistant token"), secretInput("homeassistant.token", tr("Paste a long-lived access token")), tr("In Home Assistant: your profile → Security → Long-lived access tokens → Create token. Save, then Find my speakers."))]),
      others, find
    ];
  }

  function backupCard() {
    const link = el("a", { class: "btn primary block", href: "/api/backup", download: "" }, tr("Download a backup"));
    const file = el("input", { type: "file", accept: "application/json,.json", class: "hidden-file", onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      let backup;
      try { backup = JSON.parse(await f.text()); } catch (x) { return toast(tr("That file isn't an OpenSky backup"), "bad"); }
      if (!backup || backup.opensky !== "backup") return toast(tr("That file isn't an OpenSky backup"), "bad");
      const when = backup.created ? new Date(backup.created).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : tr("an earlier day");
      sheet(tr("Restore this backup?"), (b) => b.append(
        el("p", { class: "hint" }, tr("From {when}. It replaces this screen's settings{data}{secrets}.", { when,
          data: backup.data && Object.keys(backup.data).length ? tr(", calendar events on the screen, lists and word-game stats") : "", secrets: backup.secrets ? tr(", and its passwords and keys") : "" })),
        el("p", { class: "hint" }, tr("The current files are kept as .bak copies on the Pi."))),
      [[tr("Cancel"), "", () => {}], [tr("Restore"), "primary", () => {
        api("POST", "/api/restore", { backup }).then(() => { toast(tr("Restored — tap Finish to restart the screen"), "good"); load().then(() => { saved = true; renderBar(); }); }, (x) => toast(x.message, "bad"));
      }]]);
    } });
    // automatic nightly backups to a place this Pi can reach (USB stick, network folder…)
    S.backup = S.backup || {};
    const auto = el("div", { class: "auto-backup" });
    const drawAuto = (places, st) => {
      const opts = [["", tr("Off — no automatic backups")], ...places.map((p) => [p.path, `${p.label}${p.freeMB != null ? ` · ${tr("{size} free", { size: p.freeMB >= 1024 ? `${Math.round(p.freeMB / 1024)} GB` : `${p.freeMB} MB` })}` : ""}`])];
      if (S.backup.destination && !places.some((p) => p.path === S.backup.destination)) opts.push([S.backup.destination, tr("{path} (not available right now)", { path: S.backup.destination })]);
      const last = st && st.last ? `${st.ok ? tr("Last backup") : tr("Last try")}: ${new Date(st.last).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}${st.ok ? " ✓" : ` — ${st.error}`}` : tr("No automatic backup yet.");
      auto.replaceChildren(
        el("h4", { class: "sub-title" }, tr("Automatic backups")),
        field(tr("Back up every night to"), select(opts, S.backup.destination || "", (v) => { if (v) S.backup.destination = v; else delete S.backup.destination; change(); }),
          tr("USB sticks and network folders the Pi can see right now. Plug in a stick (or open a network folder on the Pi) and reload to see it here.")),
        el("div", { class: "two" },
          field(tr("Time"), select([["01:00", "1 AM"], ["02:00", "2 AM"], ["03:00", "3 AM"], ["04:00", "4 AM"], ["05:00", "5 AM"]], S.backup.time || "03:00", (v) => { S.backup.time = v; change(); })),
          field(tr("Keep"), select([[7, tr("{n} backups", { n: 7 })], [14, tr("{n} backups", { n: 14 })], [30, tr("{n} backups", { n: 30 })], [90, tr("{n} backups", { n: 90 })]], Number(S.backup.keep) || 14, (v) => { S.backup.keep = Number(v); change(); }))),
        el("div", { class: "line top" }, el("span", {}, el("b", {}, tr("Include passwords & keys")), el("small", {}, tr("A complete copy; keep that place private"))),
          toggle(!!S.backup.includeSecrets, (v) => { S.backup.includeSecrets = v; change(); }, tr("Include passwords in automatic backups"))),
        el("p", { class: `hint${st && st.ok === false ? " bad" : ""}` }, last),
        el("button", { type: "button", class: "btn block", onclick: async (e) => {
          if (dirty) return toast(tr("Save first, then back up"), "bad");
          e.currentTarget.disabled = true;
          try { const r = await api("POST", "/api/backup/run"); toast(tr("Backed up ✓"), "good"); drawAuto(places, r.status); }
          catch (x) { toast(x.message, "bad"); api("GET", "/api/backup/places").then((d) => drawAuto(d.places, d.status), () => {}); }
        } }, tr("Back up now")));
    };
    auto.append(el("p", { class: "hint" }, tr("Looking for places to back up to…")));
    api("GET", "/api/backup/places").then((d) => drawAuto(d.places, d.status), (e) => auto.replaceChildren(el("p", { class: "hint bad" }, e.message)));

    return section("backup", "backup", tr("Backup"), tr("Keep a copy of this screen's setup — handy for a new SD card or a new Pi"),
      el("h4", { class: "sub-title" }, tr("Download a copy")),
      el("div", { class: "line top" }, el("span", {}, el("b", {}, tr("Include passwords & keys")), el("small", {}, tr("Keep that file somewhere private"))),
        toggle(false, (v) => { link.setAttribute("href", v ? "/api/backup?secrets=1" : "/api/backup"); }, tr("Include passwords"))),
      link,
      el("button", { type: "button", class: "btn block", onclick: () => file.click() }, tr("Restore from a backup")), file, auto);
  }

  /* ---------------- start ---------------- */
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  load();
})();
