// ==UserScript==
// @name         Google Calendar – Shift Badges
// @namespace    gcal-shift-badges
// @version      3.1.0
// @description  Shows the events of up to two Google calendars as small colored badges in the top corners of each day in Google Calendar's month view (e.g. shifts on the right, vacation on the left), like aCalendar's corner info.
// @author       mikulik86
// @license      MIT
// @homepageURL  https://github.com/mikulik86/gcal-shift-badges
// @supportURL   https://github.com/mikulik86/gcal-shift-badges/issues
// @updateURL    https://raw.githubusercontent.com/mikulik86/gcal-shift-badges/main/gcal-shift-badges.user.js
// @downloadURL  https://raw.githubusercontent.com/mikulik86/gcal-shift-badges/main/gcal-shift-badges.user.js
// @match        https://calendar.google.com/calendar/*
// @run-at       document-idle
// @noframes
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      calendar.google.com
// ==/UserScript==

// Setup: Tampermonkey menu → "Shift badges: settings". For each corner (right,
// left) paste a calendar's "Secret address in iCal format" (Google Calendar →
// Settings → the calendar → Integrate calendar). Every event of that calendar
// becomes a badge showing its title. Rules change how matching badges look:
// "show as" text, color, or hide. Settings are stored by Tampermonkey, so script
// updates keep them. The calendars' normal event bars are not touched.

(function () {
  'use strict';

  /* ======================= SETTINGS – edit here ======================= */
  // Addresses and rules are set in the panel (Tampermonkey menu →
  // "Shift badges: settings"), not here.
  const CONFIG = {
    otherColor: '#757575',    // badges no rule gives a color
    newRuleColor: '#039be5',  // starting color of a newly added rule
    refreshMinutes: 30,       // how often the feeds are reloaded
    offsetTop: 4,             // badge distance from the top of the day (px)
    offsetSide: 4,            // … and from its left/right edge (px)
    debug: false,
  };
  /* ==================================================================== */

  const SIDES = ['right', 'left'];
  const SIDE_LABEL = { right: 'Right corner', left: 'Left corner' };
  const WRAP_CLASS = 'gcsb-wrap';
  const BADGE_CLASS = 'gcsb-badge';
  const PANEL_ID = 'gcsb-panel';
  const ICAL_RE = /^https:\/\/calendar\.google\.com\/calendar\/ical\//;

  const log = (...a) => { if (CONFIG.debug) console.log('[shift-badges]', ...a); };
  const lastRun = { info: {} };

  /* ----------------------------- styles ------------------------------ */
  const P = `#${PANEL_ID}`;
  const css = `
    .${WRAP_CLASS} {
      position: absolute; top: ${CONFIG.offsetTop}px; display: flex; gap: 2px; z-index: 3;
      pointer-events: none; max-width: calc(50% - 16px);
    }
    .${WRAP_CLASS}.gcsb-right { right: ${CONFIG.offsetSide}px; justify-content: flex-end; }
    .${WRAP_CLASS}.gcsb-left { left: ${CONFIG.offsetSide}px; justify-content: flex-start; }
    .${BADGE_CLASS} {
      font: 500 11px/16px "Google Sans", Roboto, Arial, sans-serif;
      letter-spacing: .2px; padding: 0 4px; border-radius: 4px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
    }
    ${P} { position: fixed; top: 72px; right: 16px; z-index: 2147483000; width: 440px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 96px); overflow: auto; box-sizing: border-box; padding: 14px 16px 12px;
      background: #fff; color: #1f1f1f; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.28);
      font: 14px/1.4 "Google Sans", Roboto, Arial, sans-serif; text-align: left; }
    ${P}.gcsb-dark { background: #2d2e30; color: #e3e3e3; }
    ${P} * { box-sizing: border-box; }
    ${P} .gcsb-head { display: flex; align-items: center; justify-content: space-between; }
    ${P} .gcsb-title { font-size: 16px; font-weight: 500; }
    ${P} .gcsb-x { border: 0; background: none; color: inherit; font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 6px; }
    ${P} .gcsb-tabs { display: flex; gap: 4px; margin: 8px 0 12px; border-bottom: 1px solid rgba(128,128,128,.3); }
    ${P} .gcsb-tab { border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; background: none; color: inherit;
      font: inherit; font-size: 13px; padding: 6px 10px; cursor: pointer; opacity: .7; }
    ${P} .gcsb-tab.gcsb-on { opacity: 1; font-weight: 500; border-bottom-color: #1a73e8; }
    ${P} .gcsb-label { display: block; font-size: 12px; opacity: .75; margin-bottom: 4px; }
    ${P} .gcsb-in { font: inherit; font-size: 13px; color: inherit; background: rgba(128,128,128,.08);
      border: 1px solid rgba(128,128,128,.45); border-radius: 6px; padding: 5px 7px; min-width: 0; }
    ${P} .gcsb-in.gcsb-bad { border-color: #d93025; }
    ${P} .gcsb-url { width: 100%; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
    ${P} .gcsb-err, ${P} .gcsb-errtext { color: #d93025; font-size: 12px; }
    ${P}.gcsb-dark .gcsb-err, ${P}.gcsb-dark .gcsb-errtext { color: #f28b82; }
    ${P} .gcsb-status { font-size: 12px; opacity: .75; margin-top: 4px; }
    ${P} .gcsb-sub { font-size: 14px; font-weight: 500; margin: 14px 0 2px; }
    ${P} .gcsb-note { font-size: 12px; opacity: .75; margin: 0 0 6px; }
    ${P} .gcsb-rule { padding: 8px 0; border-top: 1px solid rgba(128,128,128,.25); }
    ${P} .gcsb-line { display: flex; align-items: center; gap: 6px; }
    ${P} .gcsb-pat { flex: 1.4 1 0; }
    ${P} .gcsb-show { flex: 1 1 0; }
    ${P} input[type=color] { width: 32px; height: 26px; border: 0; padding: 0; background: none; cursor: pointer; flex: none; }
    ${P} .gcsb-hidebox { display: flex; align-items: center; gap: 3px; font-size: 12px; cursor: pointer; user-select: none; flex: none; }
    ${P} .gcsb-del { border: 0; background: none; color: inherit; opacity: .6; cursor: pointer; font-size: 18px; line-height: 1; padding: 0 2px; flex: none; }
    ${P} .gcsb-prev { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; opacity: .85; margin-top: 5px; }
    ${P} .gcsb-prev .${BADGE_CLASS} { max-width: 120px; }
    ${P} .gcsb-hiddenlbl { font-size: 11px; border: 1px dashed rgba(128,128,128,.8); border-radius: 4px; padding: 0 4px; }
    ${P} .gcsb-empty { font-size: 12px; opacity: .7; padding: 8px 0; border-top: 1px solid rgba(128,128,128,.25); }
    ${P} .gcsb-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 10px; }
    ${P} .gcsb-btn { border: 1px solid rgba(128,128,128,.5); background: none; color: inherit; border-radius: 16px;
      padding: 6px 16px; cursor: pointer; font: inherit; font-size: 13px; }
    ${P} .gcsb-btn.gcsb-primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }`;
  if (typeof GM_addStyle === 'function') GM_addStyle(css);
  else { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }

  /* ----------------------------- helpers ----------------------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  // Lowercase, without accents and extra spaces: "Dovolená " → "dovolena".
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  const store = {
    get: (k, d) => (typeof GM_getValue === 'function' ? GM_getValue(k, d) : d),
    set: (k, v) => { if (typeof GM_setValue === 'function') GM_setValue(k, v); },
  };

  // Text color for a badge: white like Google's event chips, dark only on
  // light backgrounds (yellow, pastels) where white would be hard to read.
  function textOn(bg) {
    const m = /^#?([0-9a-f]{6})$/i.exec(bg || '');
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.45 ? '#202124' : '#ffffff';
  }

  // Any CSS color ("red", "rgb(…)", "#abc") → "#rrggbb", as the color picker needs.
  function toHex(c) {
    const x = document.createElement('canvas').getContext('2d');
    x.fillStyle = '#757575';
    x.fillStyle = c || '';
    return /^#[0-9a-f]{6}$/i.test(x.fillStyle) ? x.fillStyle : '#757575';
  }

  function isOwnNode(n) {
    return n && n.nodeType === 1 && (n.classList.contains(WRAP_CLASS) || n.classList.contains(BADGE_CLASS) || n.id === PANEL_ID);
  }

  /* ----------------------------- settings ---------------------------- */
  // { right: { url, rules: [{ pattern, show, color, hide }] }, left: { … } }
  const emptySide = () => ({ url: '', rules: [] });

  // Earlier versions stored one address (icsUrl / icsCache) and per-title
  // colors; carry them over to the right corner so nothing changes.
  function migrate() {
    const s = { right: emptySide(), left: emptySide() };
    const oldUrl = store.get('icsUrl', null);
    const oldCache = store.get('icsCache', null);
    const url = (oldUrl !== null ? oldUrl : oldCache && oldCache.url) || '';
    if (!url) return s;
    s.right.url = url;
    const colors = store.get('colors', {}) || {};
    for (const [title, c] of Object.entries(colors)) {
      s.right.rules.push({ pattern: title, show: '', color: (c && c.bg) || CONFIG.otherColor, hide: !!(c && c.hidden) });
    }
    const have = new Set(s.right.rules.map((r) => norm(r.pattern)));
    for (const [pattern, color] of [['/^D\\d+$/', '#039be5'], ['/^N\\d+$/', '#33b679'], ['DOV', '#e67c73'], ['PRC', '#616161']]) {
      if (!have.has(norm(pattern))) s.right.rules.push({ pattern, show: '', color, hide: false });
    }
    if (oldCache && oldCache.url === url && oldCache.text) store.set('feedCache', { [url]: { t: oldCache.t, text: oldCache.text } });
    return s;
  }

  function loadSettings() {
    let s = store.get('settings', null);
    if (!s || typeof s !== 'object') { s = migrate(); store.set('settings', s); }
    for (const side of SIDES) {
      s[side] = { ...emptySide(), ...(s[side] || {}) };
      s[side].rules = (s[side].rules || []).map((r) => ({ pattern: '', show: '', color: CONFIG.otherColor, hide: false, ...r }));
    }
    return s;
  }

  const settings = loadSettings();
  let compiled = null;
  function saveSettings() { store.set('settings', settings); compiled = null; }

  /* ------------------------------ rules ------------------------------ */
  function compileRule(r) {
    const p = String(r.pattern || '').trim();
    if (!p) return { r, kind: 'empty' };
    const m = /^\/(.+)\/([a-z]*)$/s.exec(p);
    if (m) {
      try { return { r, kind: 'regex', re: new RegExp(m[1], m[2].replace(/[gy]/g, '')) }; }
      catch (e) { return { r, kind: 'error', error: e.message.replace(/^Invalid regular expression: /, '') }; }
    }
    return { r, kind: 'text', key: norm(p) };
  }

  function rulesFor(side) {
    if (!compiled) compiled = Object.fromEntries(SIDES.map((s) => [s, settings[s].rules.map(compileRule)]));
    return compiled[side];
  }

  // Plain-text rules win over regex rules; otherwise the upper rule wins.
  function matchRule(list, title) {
    const n = norm(title);
    for (const c of list) if (c.kind === 'text' && c.key === n) return { c, m: null };
    for (const c of list) {
      if (c.kind !== 'regex') continue;
      const m = c.re.exec(title);
      if (m) return { c, m };
    }
    return null;
  }

  // → { text, bg } or null when hidden.
  function badgeFor(side, title) {
    const hit = matchRule(rulesFor(side), title);
    if (!hit) return { text: title, bg: CONFIG.otherColor };
    const r = hit.c.r;
    if (r.hide) return null;
    let text = title;
    if (r.show && r.show.trim()) {
      text = hit.m ? r.show.replace(/\$(&|\d)/g, (_, g) => (g === '&' ? hit.m[0] : hit.m[+g] ?? '')) : r.show;
    }
    return { text: text.trim() || title, bg: r.color || CONFIG.otherColor };
  }

  /* ---------------------- month view: cells & dates ------------------- */
  // Month shown according to the URL (…/r/month/2026/11/21), else today.
  function displayedMonth() {
    const m = location.pathname.match(/\/r\/(?:[a-z]+\/)?(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (m) return { y: +m[1], m: +m[2] };
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1 };
  }

  function isOtherView() {
    return /\/r\/(day|week|customday|customweek|agenda|year|search|eventedit|settings|tasks)\b/.test(location.pathname);
  }

  // First 1–2 digit number in the cell's own text (its day number), ignoring our badges.
  function dayNumber(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('.' + WRAP_CLASS))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let txt = '';
    while (w.nextNode() && txt.length < 60) txt += ' ' + w.currentNode.nodeValue;
    const m = txt.match(/\d{1,2}/);
    return m ? +m[0] : null;
  }

  // Finds the day boxes of the month grid by size, so it survives changes to
  // Google's class names. Returns [{el, r}] sorted top-to-bottom, left-to-right.
  function findDayCells(main) {
    const mainRect = main.getBoundingClientRect();
    const minW = mainRect.width / 8.5, maxW = mainRect.width / 4.5;
    for (const sel of ['[role="gridcell"][data-datekey]', '[data-datekey]', '[role="gridcell"]']) {
      const seen = new Map();
      for (const el of main.querySelectorAll(sel)) {
        if (el.closest('[role="dialog"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < minW || r.width > maxW || r.height < 40) continue;
        const key = `${Math.round(r.left)}:${Math.round(r.top)}`;
        const prev = seen.get(key);
        if (!prev || el.contains(prev.el)) seen.set(key, { el, r }); // keep the outermost box
      }
      const cells = [...seen.values()];
      if (cells.length >= 20) {
        cells.sort((a, b) => (Math.abs(a.r.top - b.r.top) > 5 ? a.r.top - b.r.top : a.r.left - b.r.left));
        return cells;
      }
    }
    return [];
  }

  function countRows(cells) {
    const tops = [];
    for (const c of cells) if (!tops.some((t) => Math.abs(t - c.r.top) <= 5)) tops.push(c.r.top);
    return tops.length;
  }

  // Assigns a Date to each cell. Tries Google's data-datekey first, checked
  // against the visible day numbers; otherwise counts days from the first cell.
  function dateCells(cells) {
    const shown = displayedMonth();
    const mid = cells[Math.floor(cells.length / 2)];
    const nums = cells.map((c) => dayNumber(c.el));

    for (const off of [0, 1]) {
      const dates = cells.map((c) => {
        const k = parseInt(c.el.getAttribute('data-datekey'), 10);
        if (!Number.isFinite(k)) return null;
        return new Date(1970 + (k >> 9), ((k >> 5) & 15) + off - 1, k & 31);
      });
      if (dates.some((d) => !d || isNaN(d))) break;
      const midD = dates[cells.indexOf(mid)];
      const dayOk = dates.filter((d, i) => nums[i] == null || nums[i] === d.getDate()).length;
      if (midD.getMonth() + 1 === shown.m && dayOk >= cells.length * 0.9) {
        return { method: off ? 'datekey (0-based month)' : 'datekey', dates };
      }
    }

    const cols = cells.length / countRows(cells);
    const d0 = nums[0];
    if (cols === 7 && d0) {
      const start = d0 === 1 ? new Date(shown.y, shown.m - 1, 1) : new Date(shown.y, shown.m - 2, d0);
      const dates = cells.map((_, i) => addDays(start, i));
      const dayOk = dates.filter((d, i) => nums[i] == null || nums[i] === d.getDate()).length;
      if (dayOk >= cells.length * 0.9) return { method: 'sequential', dates };
    }
    return { method: 'none', dates: null };
  }

  /* ---------------------------- iCal feeds --------------------------- */
  // A feed keeps one-off events by day and recurring events as rules; the
  // rules are expanded only for the days on screen.
  const feeds = new Map(); // url → { singles, series, events, recurring, ranges, fetchedAt, error, loading }

  function feed(url) {
    if (!feeds.has(url)) {
      feeds.set(url, { singles: new Map(), series: [], events: 0, recurring: 0, ranges: new Map(), fetchedAt: 0, error: null, loading: false });
    }
    return feeds.get(url);
  }

  const activeUrls = () => [...new Set(SIDES.map((s) => settings[s].url).filter(Boolean))];

  // Days are counted as day numbers (days since 1970-01-01) of a calendar date,
  // which keeps the arithmetic free of time zones and daylight saving.
  const DAY_MS = 864e5;
  const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const dnOf = (y, mo, d) => Math.round(Date.UTC(y, mo, d) / DAY_MS);
  const dnLocal = (date) => dnOf(date.getFullYear(), date.getMonth(), date.getDate());
  const fromDn = (dn) => { const x = new Date(dn * DAY_MS); return { y: x.getUTCFullYear(), mo: x.getUTCMonth(), d: x.getUTCDate() }; };
  const ymdDn = (dn) => { const w = fromDn(dn); return `${w.y}-${pad(w.mo + 1)}-${pad(w.d)}`; };
  const wdOf = (dn) => (((dn + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
  const daysIn = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const seq = (a, n) => Array.from({ length: n }, (_, i) => a + i);

  // Offset (ms) of an IANA time zone at instant t, or null for an unknown zone.
  const tzFormats = new Map();
  function tzOffset(tz, t) {
    if (!tzFormats.has(tz)) {
      let f = null;
      try {
        f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
      } catch (e) { /* not an IANA zone name */ }
      tzFormats.set(tz, f);
    }
    const f = tzFormats.get(tz);
    if (!f) return null;
    const p = {};
    for (const x of f.formatToParts(new Date(t))) p[x.type] = +x.value;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000;
  }

  // Clock time in the event's zone → Date. tm.tz: 'UTC', an IANA name, or null (local time).
  function wallToDate(y, mo, d, tm) {
    const wall = Date.UTC(y, mo, d, tm.h, tm.mi, tm.s);
    if (tm.tz === 'UTC') return new Date(wall);
    const o1 = tm.tz ? tzOffset(tm.tz, wall) : null;
    if (o1 === null) return new Date(y, mo, d, tm.h, tm.mi, tm.s);
    const o2 = tzOffset(tm.tz, wall - o1);
    return new Date(wall - o2);
  }

  // → { y, mo, d, allDay, tm, date }; date is the start as a local Date.
  function parseIcsDate(value, params = {}) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i.exec(String(value).trim());
    if (!m) return null;
    const p = { y: +m[1], mo: +m[2] - 1, d: +m[3] };
    if (!m[4]) return { ...p, allDay: true, tm: null, date: new Date(p.y, p.mo, p.d) };
    p.allDay = false;
    p.tm = { h: +m[4], mi: +m[5], s: +m[6], tz: m[7] ? 'UTC' : (params.TZID || null) };
    p.date = wallToDate(p.y, p.mo, p.d, p.tm);
    return p;
  }

  const parseDates = (value, params) => value.split(',').map((v) => parseIcsDate(v, params)).filter(Boolean);

  // "NAME;PARAM=x;…:value" → { name, params, value }
  function splitProp(line) {
    let q = false, i = 0;
    for (; i < line.length; i++) {
      if (line[i] === '"') q = !q;
      else if (line[i] === ':' && !q) break;
    }
    if (i >= line.length) return null;
    const [name, ...ps] = line.slice(0, i).split(';');
    const params = {};
    for (const x of ps) {
      const k = x.indexOf('=');
      if (k > 0) params[x.slice(0, k).toUpperCase()] = x.slice(k + 1).replace(/^"|"$/g, '');
    }
    return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
  }

  // RRULE value → rule, or null when it can't be expanded (e.g. hourly).
  function parseRule(value) {
    const r = {};
    for (const part of value.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) r[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim().toUpperCase();
    }
    if (!/^(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(r.FREQ || '')) return null;
    const ints = (s) => (s ? s.split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0) : []);
    const count = parseInt(r.COUNT, 10);
    return {
      freq: r.FREQ,
      interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
      count: count > 0 ? count : 0,
      until: r.UNTIL ? parseIcsDate(r.UNTIL) : null,
      byday: (r.BYDAY ? r.BYDAY.split(',') : [])
        .map((x) => /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(x.trim())).filter(Boolean)
        .map((m) => ({ n: m[1] ? +m[1] : 0, wd: WD[m[2]] })),
      bymonthday: ints(r.BYMONTHDAY).filter((n) => n >= -31 && n <= 31),
      bymonth: ints(r.BYMONTH).filter((n) => n >= 1 && n <= 12),
      bysetpos: ints(r.BYSETPOS),
      wkst: r.WKST in WD ? WD[r.WKST] : 1,
    };
  }

  // Every given weekday among days, or the n-th of it (1, 2, … or -1 = last).
  function pickWeekdays(days, byday) {
    const out = [];
    for (const b of byday) {
      const all = days.filter((dn) => wdOf(dn) === b.wd);
      if (!b.n) out.push(...all);
      else {
        const x = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
        if (x !== undefined) out.push(x);
      }
    }
    return out;
  }

  function monthDays(y, mo, rule, startDay) {
    const n = daysIn(y, mo), first = dnOf(y, mo, 1);
    if (rule.bymonthday.length) {
      const days = rule.bymonthday.map((x) => (x > 0 ? x : n + 1 + x)).filter((x) => x >= 1 && x <= n).map((x) => first + x - 1);
      return rule.byday.length ? days.filter((dn) => rule.byday.some((b) => b.wd === wdOf(dn))) : days;
    }
    if (rule.byday.length) return pickWeekdays(seq(first, n), rule.byday);
    return startDay <= n ? [first + startDay - 1] : [];
  }

  // The p-th day, week, month or year of a series: { start, days }.
  function period(rule, s, p) {
    const step = p * rule.interval;
    let start, days;
    if (rule.freq === 'DAILY') {
      start = s.dn + step;
      const w = fromDn(start);
      const ok = (!rule.bymonth.length || rule.bymonth.includes(w.mo + 1))
        && (!rule.bymonthday.length || rule.bymonthday.some((x) => (x > 0 ? x : daysIn(w.y, w.mo) + 1 + x) === w.d))
        && (!rule.byday.length || rule.byday.some((b) => b.wd === wdOf(start)));
      days = ok ? [start] : [];
    } else if (rule.freq === 'WEEKLY') {
      start = s.dn - ((wdOf(s.dn) - rule.wkst + 7) % 7) + step * 7;
      const wds = rule.byday.length ? rule.byday.map((b) => b.wd) : [wdOf(s.dn)];
      days = seq(start, 7).filter((dn) => wds.includes(wdOf(dn)) && (!rule.bymonth.length || rule.bymonth.includes(fromDn(dn).mo + 1)));
    } else if (rule.freq === 'MONTHLY') {
      const mi = s.mo + step, y = s.y + Math.floor(mi / 12), mo = ((mi % 12) + 12) % 12;
      start = dnOf(y, mo, 1);
      days = !rule.bymonth.length || rule.bymonth.includes(mo + 1) ? monthDays(y, mo, rule, s.d) : [];
    } else {
      const y = s.y + step;
      start = dnOf(y, 0, 1);
      if (rule.byday.length && !rule.bymonth.length && !rule.bymonthday.length) {
        days = pickWeekdays(seq(start, dnOf(y + 1, 0, 1) - start), rule.byday);
      } else {
        const months = rule.bymonth.length ? rule.bymonth.map((m) => m - 1) : rule.bymonthday.length ? seq(0, 12) : [s.mo];
        days = months.flatMap((mo) => monthDays(y, mo, rule, s.d));
      }
    }
    days = [...new Set(days)].sort((a, b) => a - b);
    if (rule.bysetpos.length) {
      const all = days;
      days = [...new Set(rule.bysetpos.map((i) => (i > 0 ? all[i - 1] : all[all.length + i])).filter((x) => x !== undefined))].sort((a, b) => a - b);
    }
    return { start, days };
  }

  // Calls emit(date) with the start of each occurrence up to day number hi
  // (occurrences well before lo are counted but not converted).
  function expandSeries(sr, lo, hi, emit) {
    const { rule, s } = sr;
    const u = rule.until;
    let limitDn = Infinity, limitMs = Infinity;
    if (u) {
      if (u.allDay) limitDn = dnOf(u.y, u.mo, u.d);
      else if (!sr.tm) limitDn = dnLocal(u.date);
      else { limitMs = u.date.getTime(); limitDn = dnLocal(u.date) + 2; }
    }
    let n = 0;
    const take = (dn) => {
      if (dn > limitDn) return false;
      if (rule.count && ++n > rule.count) return false;
      if (dn < lo - 2) return true;
      const w = fromDn(dn);
      const date = sr.tm ? wallToDate(w.y, w.mo, w.d, sr.tm) : new Date(w.y, w.mo, w.d);
      if (date.getTime() > limitMs) return false;
      emit(date);
      return true;
    };
    if (!take(s.dn)) return; // DTSTART is always the first occurrence
    for (let p = 0; p < 40000; p++) {
      const { start, days } = period(rule, s, p);
      if (start > hi + 2) return;
      for (const dn of days) {
        if (dn <= s.dn) continue;
        if (dn > hi + 2 || !take(dn)) return;
      }
    }
  }

  // Titles of the recurring events per day (YYYY-MM-DD), for day numbers lo…hi.
  function seriesDays(f, lo, hi) {
    const key = `${lo}:${hi}`;
    if (f.ranges.has(key)) return f.ranges.get(key);
    const map = new Map();
    for (const sr of f.series) {
      const put = (date) => {
        if (sr.ex.has(ymd(date))) return;
        const d0 = dnLocal(date);
        for (let i = 0; i < sr.days; i++) {
          if (d0 + i < lo || d0 + i > hi) continue;
          const k = ymdDn(d0 + i);
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(sr.summary);
        }
      };
      expandSeries(sr, lo - sr.days, hi, put);
      for (const r of sr.rdates) put(r.date);
    }
    if (f.ranges.size > 8) f.ranges.clear();
    f.ranges.set(key, map);
    return map;
  }

  // Titles on one day: one-off events first, then recurring ones.
  const titlesOn = (f, day, rec) => [...(f.singles.get(day) || []), ...(rec.get(day) || [])];

  function parseIcs(text) {
    const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
    const all = [];
    let ev = null, depth = 0;
    for (const line of lines) {
      if (!ev) {
        if (/^BEGIN:VEVENT\s*$/i.test(line)) { ev = { ex: [], rdates: [] }; depth = 0; }
        continue;
      }
      if (/^END:/i.test(line)) {
        if (depth) depth--;
        else { all.push(ev); ev = null; }
        continue;
      }
      if (/^BEGIN:/i.test(line)) { depth++; continue; }
      if (depth) continue; // reminders (VALARM) inside the event
      const p = splitProp(line);
      if (!p) continue;
      const v = p.value;
      if (p.name === 'DTSTART') ev.start = parseIcsDate(v, p.params);
      else if (p.name === 'DTEND') ev.end = parseIcsDate(v, p.params);
      else if (p.name === 'DURATION') ev.duration = v.trim().toUpperCase();
      else if (p.name === 'SUMMARY') ev.summary = v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
      else if (p.name === 'STATUS') ev.status = v.trim().toUpperCase();
      else if (p.name === 'UID') ev.uid = v.trim();
      else if (p.name === 'RRULE') ev.rule = parseRule(v);
      else if (p.name === 'EXDATE') ev.ex.push(...parseDates(v, p.params));
      else if (p.name === 'RDATE' && !/^PERIOD$/i.test(p.params.VALUE || '')) ev.rdates.push(...parseDates(v, p.params));
      else if (p.name === 'RECURRENCE-ID') ev.rid = parseIcsDate(v, p.params);
    }

    // Length in days of an all-day event; timed events count on their start day.
    const length = (e) => {
      if (!e.start.allDay) return 1;
      let n = 1;
      if (e.end && e.end.allDay) n = dnOf(e.end.y, e.end.mo, e.end.d) - dnOf(e.start.y, e.start.mo, e.start.d);
      else {
        const m = /^P(?:(\d+)W)?(?:(\d+)D)?/.exec(e.duration || '');
        if (m && (m[1] || m[2])) n = (+m[1] || 0) * 7 + (+m[2] || 0);
      }
      return Math.min(62, Math.max(1, n));
    };

    const events = all.filter((e) => e.start && e.summary);
    const masters = new Map();
    for (const e of events) if (e.rule && !e.rid && e.uid) masters.set(e.uid, e);
    const singles = new Map(), series = [];
    let count = 0;
    const addSingle = (e) => {
      const d0 = dnLocal(e.start.date);
      for (let i = 0; i < length(e); i++) {
        const k = ymdDn(d0 + i);
        if (!singles.has(k)) singles.set(k, []);
        singles.get(k).push(e.summary);
      }
    };
    for (const e of events) {
      if (e.rid) { // one changed or cancelled occurrence of a recurring event
        const m = masters.get(e.uid);
        if (m) m.ex.push(e.rid);
        if (e.status !== 'CANCELLED') addSingle(e);
        continue;
      }
      if (e.status === 'CANCELLED') continue;
      count++;
      if (!e.rule) { addSingle(e); continue; }
      series.push({
        summary: e.summary, rule: e.rule, tm: e.start.tm, days: length(e), rdates: e.rdates, exList: e.ex,
        s: { y: e.start.y, mo: e.start.mo, d: e.start.d, dn: dnOf(e.start.y, e.start.mo, e.start.d) },
      });
    }
    for (const sr of series) { sr.ex = new Set(sr.exList.map((x) => ymd(x.date))); delete sr.exList; }
    return { singles, series, count };
  }

  function applyText(f, text, t) {
    const { singles, series, count } = parseIcs(text);
    Object.assign(f, { singles, series, events: count, recurring: series.length, ranges: new Map(), fetchedAt: t, error: null });
  }

  function saveCache(url, t, text) {
    const all = store.get('feedCache', {}) || {};
    const keep = new Set(activeUrls());
    for (const k of Object.keys(all)) if (!keep.has(k)) delete all[k];
    all[url] = { t, text };
    store.set('feedCache', all);
  }

  function loadFeed(url, force) {
    const f = feed(url);
    if (f.loading) return;
    if (!f.fetchedAt) {
      const c = (store.get('feedCache', {}) || {})[url];
      if (c && c.text) applyText(f, c.text, c.t);
    }
    if (!force && Date.now() - f.fetchedAt < CONFIG.refreshMinutes * 60e3) return;
    f.loading = true;
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      onload: (res) => {
        f.loading = false;
        if (res.status !== 200 || !/BEGIN:VCALENDAR/.test(res.responseText || '')) {
          f.error = res.status !== 200 ? `HTTP ${res.status} – check the address` : 'not an iCal feed – check the address';
          log('feed failed', res.status);
        } else {
          applyText(f, res.responseText, Date.now());
          saveCache(url, f.fetchedAt, res.responseText);
          log(`feed: ${f.events} events, ${f.recurring} recurring`);
        }
        schedule();
        updatePanel();
      },
      onerror: () => { f.loading = false; f.error = 'network error'; schedule(); updatePanel(); },
    });
  }

  const loadAll = (force) => activeUrls().forEach((u) => loadFeed(u, force));

  // Titles in the feed, most frequent first (recurring ones counted over ±1 year).
  function titlesOf(url) {
    const f = feed(url), counts = new Map();
    const today = dnLocal(new Date());
    for (const m of [f.singles, seriesDays(f, today - 366, today + 366)]) {
      for (const list of m.values()) for (const t of list) counts.set(t, (counts.get(t) || 0) + 1);
    }
    for (const sr of f.series) if (!counts.has(sr.summary)) counts.set(sr.summary, 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }

  /* ----------------------------- render ------------------------------ */
  function badgeEl(text, bg) {
    const b = document.createElement('span');
    b.className = BADGE_CLASS;
    b.textContent = text;
    b.title = text;
    b.style.background = bg;
    b.style.color = textOn(toHex(bg));
    return b;
  }

  // badges: [{ text, bg }]
  function setBadges(cellEl, side, badges) {
    let wrap = null;
    for (const ch of cellEl.children) if (ch.classList.contains(WRAP_CLASS) && ch.classList.contains(`gcsb-${side}`)) { wrap = ch; break; }
    if (!badges.length) { if (wrap) wrap.remove(); return; }
    const sig = badges.map((b) => `${b.text}\u0000${b.bg}`).join('|');
    if (wrap && wrap.dataset.sig === sig) return;
    if (getComputedStyle(cellEl).position === 'static') cellEl.style.position = 'relative';
    if (!wrap) { wrap = document.createElement('div'); wrap.className = `${WRAP_CLASS} gcsb-${side}`; cellEl.appendChild(wrap); }
    wrap.dataset.sig = sig;
    wrap.replaceChildren(...badges.map((b) => badgeEl(b.text, b.bg)));
  }

  function clearAll(root) {
    root.querySelectorAll('.' + WRAP_CLASS).forEach((w) => w.remove());
  }

  function render() {
    const main = document.querySelector('[role="main"]') || document.body;
    const info = { view: 'other', cells: 0, rows: 0, dating: '-', badged: { right: 0, left: 0 } };
    lastRun.info = info;

    if (isOtherView() || !activeUrls().length) { clearAll(main); return; }

    const cells = findDayCells(main);
    info.cells = cells.length;
    info.rows = countRows(cells);
    if (cells.length < 20 || info.rows < 4) { clearAll(main); return; }
    info.view = 'month';

    const { method, dates } = dateCells(cells);
    info.dating = method;
    if (!dates) { clearAll(main); return; }
    info.firstDate = ymd(dates[0]);
    info.lastDate = ymd(dates[dates.length - 1]);

    // recurring events, expanded for the days on screen
    const lo = dnLocal(dates[0]), hi = dnLocal(dates[dates.length - 1]);
    const rec = {};
    for (const side of SIDES) if (settings[side].url) rec[side] = seriesDays(feed(settings[side].url), lo, hi);

    cells.forEach((c, i) => {
      const day = ymd(dates[i]);
      for (const side of SIDES) {
        const url = settings[side].url;
        const list = [];
        if (url) {
          for (const title of titlesOn(feed(url), day, rec[side])) {
            const b = badgeFor(side, title);
            if (b && !list.some((x) => x.text === b.text && x.bg === b.bg)) list.push(b);
          }
        }
        setBadges(c.el, side, list);
        if (list.length) info.badged[side]++;
      }
    });
    log(info);
  }

  /* ---------------------------- settings panel ----------------------- */
  let panel = null;
  let activeSide = 'right';
  let dyn = null; // live parts of the open panel

  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'attrs') for (const [a, av] of Object.entries(v)) e.setAttribute(a, av);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e[k] = v;
    }
    for (const c of [].concat(children)) if (c != null) e.append(c);
    return e;
  }

  function pageIsDark() {
    for (const n of [document.querySelector('[role="main"]'), document.body, document.documentElement]) {
      const m = n && /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(n).backgroundColor);
      if (m && (m[4] === undefined || +m[4] > 0.5)) return (+m[1] + +m[2] + +m[3]) / 3 < 110;
    }
    return false;
  }

  function onPanelKey(e) { if (e.key === 'Escape') closePanel(); }

  function closePanel() {
    if (panel) panel.remove();
    panel = null; dyn = null;
    document.removeEventListener('keydown', onPanelKey, true);
  }

  function openPanel(side) {
    if (side) activeSide = side;
    if (!panel) {
      panel = el('div', { id: PANEL_ID });
      // keep Google Calendar's keyboard shortcuts away from our inputs
      for (const t of ['keydown', 'keypress', 'keyup']) panel.addEventListener(t, (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
      document.body.appendChild(panel);
      document.addEventListener('keydown', onPanelKey, true);
    }
    buildPanel();
  }

  function ruleRow(side, r, i, listId) {
    const pat = el('input', { type: 'text', class: 'gcsb-in gcsb-pat', value: r.pattern, placeholder: 'Title or /regex/', spellcheck: false, attrs: { list: listId } });
    const show = el('input', { type: 'text', class: 'gcsb-in gcsb-show', value: r.show, placeholder: 'Show as', spellcheck: false });
    const color = el('input', { type: 'color', value: toHex(r.color), title: 'Badge color' });
    const hide = el('input', { type: 'checkbox', checked: !!r.hide });
    const del = el('button', {
      type: 'button', class: 'gcsb-del', textContent: '×', title: 'Delete rule',
      onclick: () => { settings[side].rules.splice(i, 1); saveSettings(); schedule(); buildPanel(); },
    });
    const preview = el('div', { class: 'gcsb-prev' });
    const changed = () => {
      Object.assign(r, { pattern: pat.value, show: show.value, color: color.value, hide: hide.checked });
      saveSettings(); schedule(); updatePanel();
    };
    for (const x of [pat, show, color]) x.addEventListener('input', changed);
    hide.addEventListener('change', changed);
    const row = el('div', { class: 'gcsb-rule' }, [
      el('div', { class: 'gcsb-line' }, [pat, show, color, el('label', { class: 'gcsb-hidebox', title: 'No badge for matching events' }, [hide, 'Hide']), del]),
      preview,
    ]);
    return { row, pat, preview };
  }

  function buildPanel() {
    const side = activeSide, cfg = settings[side];
    panel.replaceChildren();
    panel.classList.toggle('gcsb-dark', pageIsDark());
    panel.append(el('div', { class: 'gcsb-head' }, [
      el('span', { class: 'gcsb-title', textContent: 'Shift badges' }),
      el('button', { class: 'gcsb-x', type: 'button', textContent: '×', title: 'Close', onclick: closePanel }),
    ]));
    panel.append(el('div', { class: 'gcsb-tabs' }, SIDES.map((s) => el('button', {
      type: 'button', class: 'gcsb-tab' + (s === side ? ' gcsb-on' : ''), textContent: SIDE_LABEL[s], onclick: () => openPanel(s),
    }))));

    // iCal address
    const url = el('input', { type: 'text', class: 'gcsb-in gcsb-url', value: cfg.url, spellcheck: false,
      placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics' });
    const urlErr = el('div', { class: 'gcsb-err' });
    const status = el('div', { class: 'gcsb-status' });
    const commit = () => {
      const v = url.value.trim();
      if (v && !ICAL_RE.test(v)) {
        url.classList.add('gcsb-bad');
        urlErr.textContent = 'This should be a Google Calendar iCal address starting with https://calendar.google.com/calendar/ical/';
        return;
      }
      url.classList.remove('gcsb-bad'); urlErr.textContent = '';
      if (v === cfg.url) return;
      cfg.url = v; saveSettings();
      if (v) loadFeed(v, true);
      schedule(); updatePanel();
    };
    url.addEventListener('change', commit);
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    panel.append(
      el('label', { class: 'gcsb-label', textContent: 'iCal address – Google Calendar → Settings → the calendar → Integrate calendar → Secret address in iCal format' }),
      url, urlErr, status,
    );

    // rules
    const listId = `gcsb-titles-${side}`;
    const datalist = el('datalist', { id: listId });
    panel.append(
      el('div', { class: 'gcsb-sub', textContent: 'Rules' }),
      el('p', { class: 'gcsb-note', textContent: 'Every event gets a badge with its title, in grey. A rule changes the badges it matches. Plain text matches the whole title, ignoring case and accents; /regex/ matches a pattern (add i for any case, e.g. /^n\\d+$/i). "Show as" replaces the text – with a regex, $1 inserts the first group. Plain text wins over regex, otherwise the upper rule wins.' }),
      datalist,
    );
    const rows = cfg.rules.map((r, i) => ruleRow(side, r, i, listId));
    if (rows.length) rows.forEach((x) => panel.append(x.row));
    else panel.append(el('div', { class: 'gcsb-empty', textContent: 'No rules yet.' }));

    panel.append(el('div', { class: 'gcsb-foot' }, [
      el('button', {
        type: 'button', class: 'gcsb-btn', textContent: '+ Add rule',
        onclick: () => {
          cfg.rules.push({ pattern: '', show: '', color: CONFIG.newRuleColor, hide: false });
          saveSettings(); buildPanel();
          const pats = panel.querySelectorAll('.gcsb-pat');
          if (pats.length) pats[pats.length - 1].focus();
        },
      }),
      el('button', { type: 'button', class: 'gcsb-btn gcsb-primary', textContent: 'Done', onclick: closePanel }),
    ]));

    dyn = { side, status, datalist, rows };
    updatePanel();
  }

  // Refreshes feed status, title suggestions and rule previews without
  // rebuilding the inputs (so typing isn't interrupted).
  function updatePanel() {
    if (!panel || !dyn) return;
    const { side, status, datalist, rows } = dyn;
    const url = settings[side].url;
    const f = url ? feed(url) : null;
    status.className = 'gcsb-status' + (f && f.error ? ' gcsb-errtext' : '');
    status.textContent = !url ? 'No address – this corner shows nothing.'
      : f.error ? `Feed error: ${f.error}`
        : f.fetchedAt ? `${f.events} events loaded${f.recurring ? `, ${f.recurring} of them recurring` : ''} (${new Date(f.fetchedAt).toLocaleTimeString()})` : 'Loading …';

    const titles = url ? titlesOf(url) : [];
    datalist.replaceChildren(...titles.slice(0, 500).map((t) => el('option', { value: t })));

    const list = rulesFor(side);
    rows.forEach((ref, i) => {
      const c = list[i];
      ref.pat.classList.toggle('gcsb-bad', c.kind === 'error');
      ref.preview.replaceChildren();
      if (c.kind === 'empty') { ref.preview.textContent = 'Type a title or a /regex/.'; return; }
      if (c.kind === 'error') { ref.preview.append(el('span', { class: 'gcsb-errtext', textContent: `Invalid regex: ${c.error}` })); return; }
      if (!titles.length) { ref.preview.textContent = url ? 'Matches show here once the feed is loaded.' : 'Set the iCal address to see matches.'; return; }
      const own = titles.filter((t) => { const h = matchRule(list, t); return h && h.c === c; });
      if (!own.length) {
        const any = titles.some((t) => matchRule([c], t));
        ref.preview.textContent = any ? 'Only matches titles another rule already takes.' : 'No title in the feed matches.';
        return;
      }
      const sample = badgeFor(side, own[0]);
      ref.preview.append(sample ? badgeEl(sample.text, sample.bg) : el('span', { class: 'gcsb-hiddenlbl', textContent: 'hidden' }));
      ref.preview.append(el('span', { textContent: `${own.slice(0, 5).join(', ')}${own.length > 5 ? ` +${own.length - 5} more` : ''}` }));
    });
  }

  /* ------------------------------ wiring ----------------------------- */
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { render(); } catch (e) { console.error('[shift-badges]', e); }
    }, 120);
  }

  new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (t && (isOwnNode(t) || t.closest(`.${WRAP_CLASS}, #${PANEL_ID}`))) continue;
      const nodes = [...m.addedNodes, ...m.removedNodes];
      if (nodes.length && nodes.every(isOwnNode)) continue;
      schedule();
      return;
    }
  }).observe(document.body, { childList: true, subtree: true });

  window.addEventListener('resize', schedule);

  loadAll(false);
  setInterval(() => loadAll(true), CONFIG.refreshMinutes * 60e3);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Shift badges: settings', () => openPanel());
    GM_registerMenuCommand('Shift badges: reload now', () => {
      if (!activeUrls().length) { openPanel(); return; }
      loadAll(true);
    });
    GM_registerMenuCommand('Shift badges: diagnose', () => {
      render();
      const i = lastRun.info;
      const lines = SIDES.map((s) => {
        const url = settings[s].url;
        if (!url) return `${SIDE_LABEL[s]}: no address`;
        const f = feed(url);
        return `${SIDE_LABEL[s]}: ${f.events} events (${f.recurring} recurring), ${settings[s].rules.length} rules, `
          + (f.error ? `error: ${f.error}` : `last loaded ${f.fetchedAt ? new Date(f.fetchedAt).toLocaleString() : 'never'}`);
      });
      lines.push(`View detected: ${i.view}`, `Day cells: ${i.cells} in ${i.rows} rows`);
      lines.push(`Date mapping: ${i.dating}${i.firstDate ? ` (${i.firstDate} … ${i.lastDate})` : ''}`);
      lines.push(`Days with badges: right ${i.badged ? i.badged.right : 0}, left ${i.badged ? i.badged.left : 0}`);
      // no addresses in the output – they are secret
      console.log('[shift-badges] diagnose', i, SIDES.map((s) => ({ side: s, address: !!settings[s].url, rules: settings[s].rules.map((r) => ({ ...r })) })));
      alert(lines.join('\n'));
    });
  }

  schedule();
})();
