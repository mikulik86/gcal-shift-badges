// ==UserScript==
// @name         Google Calendar – Shift Badges
// @namespace    gcal-shift-badges
// @version      2.1.0
// @description  Shows the titles of your shift calendar's events (e.g. D11, Night, Vacation) as small colored badges in the top-right corner of each day in Google Calendar's month view, like aCalendar's corner info.
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

// Setup: Tampermonkey menu → "Shift badges: set iCal address" → paste your shift
// calendar's "Secret address in iCal format" (Google Calendar → Settings → the
// calendar → Integrate calendar). Each event's title becomes a badge on its day;
// short titles fit best. Pick colors (or hide titles) via the Tampermonkey menu
// → "Shift badges: colors". Address and colors are stored by Tampermonkey, so
// script updates keep them. The calendar's normal event bars are not touched:
// tick or untick the calendar in the sidebar as you like.

(function () {
  'use strict';

  /* ======================= SETTINGS – edit here ======================= */
  const CONFIG = {
    // Starting colors for titles you haven't picked a color for in the
    // "Shift badges: colors" panel. A title matches if the WHOLE title fits
    // the pattern; first match wins. Colors picked in the panel always win.
    startColors: [
      { match: /^D\d+$/, bg: '#039be5' }, // D11, D8, …   (Google "Peacock")
      { match: /^N\d+$/, bg: '#33b679' }, // N11, …       (Google "Sage")
      { match: /^DOV$/,  bg: '#e67c73' }, // DOV          (Google "Flamingo")
      { match: /^PRC$/,  bg: '#616161' }, // PRC          (Google "Graphite")
    ],
    // Color for any other title until you pick one.
    otherColor: '#757575',

    // How often the feed is reloaded.
    refreshMinutes: 30,

    // Badge position inside the day cell (pixels from the top/right edge).
    offsetTop: 4,
    offsetRight: 4,

    debug: false,
  };
  /* ==================================================================== */

  const WRAP_CLASS = 'gcsb-wrap';
  const BADGE_CLASS = 'gcsb-badge';
  const PANEL_ID = 'gcsb-panel';

  const log = (...a) => { if (CONFIG.debug) console.log('[shift-badges]', ...a); };
  const lastRun = { info: {} };

  /* ----------------------------- styles ------------------------------ */
  const P = `#${PANEL_ID}`;
  const css = `
    .${WRAP_CLASS} {
      position: absolute; top: ${CONFIG.offsetTop}px; right: ${CONFIG.offsetRight}px;
      display: flex; gap: 2px; z-index: 3; pointer-events: none; max-width: calc(50% - 16px);
    }
    .${BADGE_CLASS} {
      font: 500 11px/16px "Google Sans", Roboto, Arial, sans-serif;
      letter-spacing: .2px; padding: 0 4px; border-radius: 4px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
    }
    ${P} { position: fixed; top: 72px; right: 16px; z-index: 2147483000; width: 340px;
      max-height: calc(100vh - 96px); overflow: auto; box-sizing: border-box; padding: 14px 16px 12px;
      background: #fff; color: #1f1f1f; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.28);
      font: 14px/1.4 "Google Sans", Roboto, Arial, sans-serif; text-align: left; }
    ${P}.gcsb-dark { background: #2d2e30; color: #e3e3e3; }
    ${P} * { box-sizing: border-box; }
    ${P} .gcsb-head { display: flex; align-items: center; justify-content: space-between; }
    ${P} .gcsb-title { font-size: 16px; font-weight: 500; }
    ${P} .gcsb-x { border: 0; background: none; color: inherit; font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 6px; }
    ${P} .gcsb-note { font-size: 12px; opacity: .75; margin: 4px 0 10px; }
    ${P} .gcsb-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid rgba(128,128,128,.25); }
    ${P} .gcsb-prev { flex: 1; min-width: 0; display: flex; }
    ${P} .gcsb-prev .${BADGE_CLASS} { font-size: 12px; line-height: 18px; padding: 0 6px; max-width: 100%; }
    ${P} .gcsb-row.gcsb-off .gcsb-prev { opacity: .35; text-decoration: line-through; }
    ${P} .gcsb-count { font-size: 12px; opacity: .6; min-width: 30px; text-align: right; }
    ${P} input[type=color] { width: 34px; height: 24px; border: 0; padding: 0; background: none; cursor: pointer; }
    ${P} .gcsb-hidebox { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; user-select: none; }
    ${P} .gcsb-reset { border: 0; background: none; color: inherit; opacity: .6; cursor: pointer; font-size: 15px; padding: 0 2px; visibility: hidden; }
    ${P} .gcsb-row.gcsb-custom .gcsb-reset { visibility: visible; }
    ${P} .gcsb-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    ${P} .gcsb-btn { border: 1px solid rgba(128,128,128,.5); background: none; color: inherit; border-radius: 16px;
      padding: 6px 16px; cursor: pointer; font: inherit; font-size: 13px; }
    ${P} .gcsb-btn.gcsb-primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }`;
  if (typeof GM_addStyle === 'function') GM_addStyle(css);
  else { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }

  /* ----------------------------- helpers ----------------------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  const store = {
    get: (k, d) => (typeof GM_getValue === 'function' ? GM_getValue(k, d) : d),
    set: (k, v) => { if (typeof GM_setValue === 'function') GM_setValue(k, v); },
  };

  /* ------------------------------ colors ----------------------------- */
  // Stored per exact title: { bg: '#rrggbb', hidden: true|false }.
  const getColors = () => store.get('colors', {}) || {};

  function startColor(title) {
    const r = CONFIG.startColors.find((x) => x.match.test(title));
    return r ? r.bg : CONFIG.otherColor;
  }

  // null = hidden, otherwise the background color for this title.
  function colorFor(title, colors) {
    const s = colors[title] || {};
    if (s.hidden) return null;
    return s.bg || startColor(title);
  }

  function setColor(title, patch) {
    const all = getColors();
    const next = { ...(all[title] || {}), ...patch };
    if (!next.bg) delete next.bg;
    if (!next.hidden) delete next.hidden;
    if (Object.keys(next).length) all[title] = next; else delete all[title];
    store.set('colors', all);
  }

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

  /* --------------------------- day cells ----------------------------- */
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

  /* ---------------------------- iCal feed ---------------------------- */
  const ics = { byDate: new Map(), events: 0, fetchedAt: 0, error: null, loading: false };

  function parseIcsDate(value) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    if (!m[4]) return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
    if (m[7]) return { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), allDay: false };
    return { date: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), allDay: false };
  }

  function parseIcs(text) {
    const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
    const byDate = new Map();
    let ev = null, count = 0;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
      if (line === 'END:VEVENT') {
        if (ev && ev.start && ev.summary && ev.status !== 'CANCELLED') {
          count++;
          const first = new Date(ev.start.date.getFullYear(), ev.start.date.getMonth(), ev.start.date.getDate());
          let days = 1;
          if (ev.start.allDay && ev.end && ev.end.allDay) {
            days = Math.max(1, Math.round((ev.end.date - ev.start.date) / 864e5));
          }
          for (let i = 0; i < Math.min(days, 62); i++) {
            const key = ymd(addDays(first, i));
            if (!byDate.has(key)) byDate.set(key, []);
            byDate.get(key).push(ev.summary);
          }
        }
        ev = null; continue;
      }
      if (!ev) continue;
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const name = line.slice(0, idx).split(';')[0].toUpperCase();
      const value = line.slice(idx + 1);
      if (name === 'DTSTART') ev.start = parseIcsDate(value);
      else if (name === 'DTEND') ev.end = parseIcsDate(value);
      else if (name === 'SUMMARY') ev.summary = value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
      else if (name === 'STATUS') ev.status = value.trim().toUpperCase();
    }
    return { byDate, count };
  }

  function applyIcsText(text, fetchedAt) {
    const { byDate, count } = parseIcs(text);
    ics.byDate = byDate; ics.events = count; ics.fetchedAt = fetchedAt; ics.error = null;
    log(`iCal: ${count} events`);
  }

  function resetIcs() {
    ics.byDate = new Map(); ics.events = 0; ics.fetchedAt = 0; ics.error = null;
  }

  // Versions 1.x kept the address in the script; adopt the one they cached.
  (function migrateAddress() {
    if (store.get('icsUrl', null) !== null) return;
    const cached = store.get('icsCache', null);
    if (cached && cached.url) store.set('icsUrl', cached.url);
  })();

  function getIcsUrl() {
    return store.get('icsUrl', '') || '';
  }

  function loadIcs(force) {
    const url = getIcsUrl();
    if (!url || ics.loading) return;
    const cached = store.get('icsCache', null);
    if (cached && cached.url === url && !ics.fetchedAt) applyIcsText(cached.text, cached.t);
    const fresh = Date.now() - ics.fetchedAt < CONFIG.refreshMinutes * 60e3;
    if (fresh && !force) return;
    ics.loading = true;
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      onload: (res) => {
        ics.loading = false;
        if (url !== getIcsUrl()) return; // address changed meanwhile
        if (res.status !== 200 || !/BEGIN:VCALENDAR/.test(res.responseText || '')) {
          ics.error = res.status !== 200 ? `HTTP ${res.status} – check the address` : 'not an iCal feed – check the address';
          log('iCal fetch failed', res.status); schedule(); return;
        }
        const t = Date.now();
        applyIcsText(res.responseText, t);
        store.set('icsCache', { url, t, text: res.responseText });
        schedule();
        if (panel) openPanel(); // refresh the colors list
      },
      onerror: () => { ics.loading = false; ics.error = 'network error'; schedule(); },
    });
  }

  function askForIcsUrl() {
    const input = prompt(
      'Secret address in iCal format of your shift calendar\n'
      + '(Google Calendar → Settings → the calendar → Integrate calendar).\n\n'
      + 'Leave empty to remove the badges.',
      getIcsUrl(),
    );
    if (input === null) return; // cancelled
    const url = input.trim();
    if (url && !/^https:\/\/calendar\.google\.com\/calendar\/ical\//.test(url)) {
      alert('That doesn\'t look like a Google Calendar iCal address.\nIt should start with https://calendar.google.com/calendar/ical/');
      return;
    }
    store.set('icsUrl', url);
    store.set('icsCache', null);
    resetIcs();
    if (url) loadIcs(true);
    schedule();
    if (panel) openPanel();
  }

  /* --------------------------- colors panel --------------------------- */
  let panel = null;

  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
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

  function closePanel() {
    if (panel) panel.remove();
    panel = null;
    document.removeEventListener('keydown', onPanelKey, true);
  }

  function onPanelKey(e) { if (e.key === 'Escape') closePanel(); }

  function titleCounts() {
    const counts = new Map();
    for (const titles of ics.byDate.values()) for (const t of titles) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function colorRow(title, count) {
    const colors = getColors();
    const own = colors[title] || {};
    const bg = own.bg || startColor(title);
    const badge = el('span', { class: BADGE_CLASS, textContent: title, title });
    const paint = (c) => { badge.style.background = c; badge.style.color = textOn(toHex(c)); };
    paint(bg);
    const row = el('div', { class: 'gcsb-row' });
    const sync = () => {
      const s = getColors()[title] || {};
      row.classList.toggle('gcsb-off', !!s.hidden);
      row.classList.toggle('gcsb-custom', !!s.bg);
    };
    const picker = el('input', {
      type: 'color', value: toHex(bg), title: 'Badge color',
      oninput: () => { paint(picker.value); setColor(title, { bg: picker.value }); sync(); schedule(); },
    });
    const hide = el('input', {
      type: 'checkbox', checked: !!own.hidden,
      onchange: () => { setColor(title, { hidden: hide.checked }); sync(); schedule(); },
    });
    const reset = el('button', {
      class: 'gcsb-reset', type: 'button', textContent: '↺', title: 'Back to the starting color',
      onclick: () => { setColor(title, { bg: undefined }); const c = startColor(title); paint(c); picker.value = toHex(c); sync(); schedule(); },
    });
    row.append(
      el('div', { class: 'gcsb-prev' }, badge),
      el('span', { class: 'gcsb-count', textContent: `${count}×`, title: `${count} day(s) in the feed` }),
      picker,
      el('label', { class: 'gcsb-hidebox' }, [hide, 'Hide']),
      reset,
    );
    sync();
    return row;
  }

  function openPanel() {
    const wasOpen = panel;
    if (wasOpen) panel.replaceChildren(); else panel = el('div', { id: PANEL_ID });
    panel.classList.toggle('gcsb-dark', pageIsDark());
    panel.append(el('div', { class: 'gcsb-head' }, [
      el('span', { class: 'gcsb-title', textContent: 'Badge colors' }),
      el('button', { class: 'gcsb-x', type: 'button', textContent: '×', title: 'Close', onclick: closePanel }),
    ]));
    const foot = el('div', { class: 'gcsb-foot' });
    if (!getIcsUrl()) {
      panel.append(el('p', { class: 'gcsb-note', textContent: 'Set your shift calendar\'s iCal address first. Its event titles will then be listed here.' }));
      foot.append(el('button', { class: 'gcsb-btn gcsb-primary', type: 'button', textContent: 'Set iCal address', onclick: askForIcsUrl }));
    } else {
      const list = titleCounts();
      panel.append(el('p', {
        class: 'gcsb-note',
        textContent: list.length
          ? 'Every title in your shift calendar. Changes are saved right away.'
          : (ics.error ? `The feed could not be loaded (${ics.error}).` : 'Loading the feed …'),
      }));
      for (const [title, count] of list) panel.append(colorRow(title, count));
    }
    foot.append(el('button', { class: 'gcsb-btn', type: 'button', textContent: 'Done', onclick: closePanel }));
    panel.append(foot);
    if (!wasOpen) {
      document.body.appendChild(panel);
      document.addEventListener('keydown', onPanelKey, true);
    }
  }

  /* ----------------------------- render ------------------------------ */
  // badges: [{ title, bg }]
  function setBadges(cellEl, badges) {
    let wrap = null;
    for (const ch of cellEl.children) if (ch.classList.contains(WRAP_CLASS)) { wrap = ch; break; }
    const sig = badges.map((b) => `${b.title}\u0000${b.bg}`).join('|');
    if (!badges.length) { if (wrap) wrap.remove(); return; }
    if (wrap && wrap.dataset.sig === sig) return;
    if (getComputedStyle(cellEl).position === 'static') cellEl.style.position = 'relative';
    if (!wrap) { wrap = document.createElement('div'); wrap.className = WRAP_CLASS; cellEl.appendChild(wrap); }
    wrap.dataset.sig = sig;
    wrap.replaceChildren(...badges.map(({ title, bg }) => {
      const b = document.createElement('span');
      b.className = BADGE_CLASS;
      b.textContent = title;
      b.title = title;
      b.style.background = bg;
      b.style.color = textOn(toHex(bg));
      return b;
    }));
  }

  function clearAll(root) {
    root.querySelectorAll('.' + WRAP_CLASS).forEach((w) => w.remove());
  }

  function render() {
    const main = document.querySelector('[role="main"]') || document.body;
    const info = { address: !!getIcsUrl(), view: 'other', cells: 0, rows: 0, dating: '-', badgedCells: 0 };
    lastRun.info = info;

    if (isOtherView() || !info.address) { clearAll(main); return; }

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

    const colors = getColors();
    cells.forEach((c, i) => {
      const badges = [];
      for (const title of ics.byDate.get(ymd(dates[i])) || []) {
        const bg = colorFor(title, colors);
        if (bg && !badges.some((b) => b.title === title)) badges.push({ title, bg });
      }
      setBadges(c.el, badges);
      if (badges.length) info.badgedCells++;
    });
    log(info);
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

  loadIcs(false);
  setInterval(() => loadIcs(true), CONFIG.refreshMinutes * 60e3);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Shift badges: set iCal address', askForIcsUrl);
    GM_registerMenuCommand('Shift badges: colors', openPanel);
    GM_registerMenuCommand('Shift badges: reload now', () => {
      if (!getIcsUrl()) { askForIcsUrl(); return; }
      loadIcs(true);
    });
    GM_registerMenuCommand('Shift badges: diagnose', () => {
      render();
      const i = lastRun.info;
      const lines = [`iCal address: ${i.address ? 'set' : 'not set – use "Shift badges: set iCal address"'}`];
      if (i.address) {
        lines.push(`Feed: ${ics.events} events, ${ics.error ? 'error: ' + ics.error
          : 'last loaded ' + (ics.fetchedAt ? new Date(ics.fetchedAt).toLocaleString() : 'never')}`);
        lines.push(`View detected: ${i.view}`, `Day cells: ${i.cells} in ${i.rows} rows`);
        lines.push(`Date mapping: ${i.dating}${i.firstDate ? ` (${i.firstDate} … ${i.lastDate})` : ''}`);
        lines.push(`Days with badges: ${i.badgedCells}`);
      }
      console.log('[shift-badges] diagnose', i);
      alert(lines.join('\n'));
    });
  }

  schedule();
})();
