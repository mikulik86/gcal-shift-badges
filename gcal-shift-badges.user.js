// ==UserScript==
// @name         Google Calendar – Shift Badges
// @namespace    gcal-shift-badges
// @version      2.0.0
// @description  Shows shift codes (D11, N11, DOV, PRC …) from your shift calendar's iCal feed as small colored badges in the top-right corner of each day in Google Calendar's month view, like aCalendar's corner info.
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
// calendar → Integrate calendar). The address is stored by Tampermonkey, so
// script updates keep it. The calendar's normal event bars are not touched:
// tick or untick the calendar in the sidebar as you like.

(function () {
  'use strict';

  /* ======================= SETTINGS – edit here ======================= */
  const CONFIG = {
    // Badge colors by event title. First match wins; a title matches only if
    // the WHOLE title fits the pattern.
    rules: [
      { match: /^D\d+$/, bg: '#039be5' }, // D11, D8, …   (Google "Peacock")
      { match: /^N\d+$/, bg: '#33b679' }, // N11, …       (Google "Sage")
      { match: /^DOV$/,  bg: '#e67c73' }, // DOV          (Google "Flamingo")
      { match: /^PRC$/,  bg: '#616161' }, // PRC          (Google "Graphite")
    ],
    textColor: '#ffffff',

    // Also show titles that match no rule, in this color (false = skip them).
    showUnmatched: true,
    unmatchedColor: '#757575',

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

  const log = (...a) => { if (CONFIG.debug) console.log('[shift-badges]', ...a); };
  const lastRun = { info: {} };

  /* ----------------------------- styles ------------------------------ */
  const css = `
    .${WRAP_CLASS} {
      position: absolute; top: ${CONFIG.offsetTop}px; right: ${CONFIG.offsetRight}px;
      display: flex; gap: 2px; z-index: 3; pointer-events: none;
    }
    .${BADGE_CLASS} {
      font: 500 11px/16px "Google Sans", Roboto, Arial, sans-serif;
      letter-spacing: .2px; padding: 0 4px; border-radius: 4px;
      color: ${CONFIG.textColor}; white-space: nowrap;
    }`;
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

  function ruleFor(title) {
    return CONFIG.rules.find((r) => r.match.test(title)) || null;
  }

  function isOwnNode(n) {
    return n && n.nodeType === 1 && (n.classList.contains(WRAP_CLASS) || n.classList.contains(BADGE_CLASS));
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
  }

  /* ----------------------------- render ------------------------------ */
  function setBadges(cellEl, titles) {
    let wrap = null;
    for (const ch of cellEl.children) if (ch.classList.contains(WRAP_CLASS)) { wrap = ch; break; }
    const sig = titles.join('|');
    if (!titles.length) { if (wrap) wrap.remove(); return; }
    if (wrap && wrap.dataset.sig === sig) return;
    if (getComputedStyle(cellEl).position === 'static') cellEl.style.position = 'relative';
    if (!wrap) { wrap = document.createElement('div'); wrap.className = WRAP_CLASS; cellEl.appendChild(wrap); }
    wrap.dataset.sig = sig;
    wrap.replaceChildren(...titles.map((title) => {
      const b = document.createElement('span');
      b.className = BADGE_CLASS;
      b.textContent = title;
      const rule = ruleFor(title);
      b.style.background = rule ? rule.bg : CONFIG.unmatchedColor;
      if (rule && rule.fg) b.style.color = rule.fg;
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

    cells.forEach((c, i) => {
      const titles = [];
      for (const t of ics.byDate.get(ymd(dates[i])) || []) {
        if ((ruleFor(t) || CONFIG.showUnmatched) && !titles.includes(t)) titles.push(t);
      }
      setBadges(c.el, titles);
      if (titles.length) info.badgedCells++;
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
      if (isOwnNode(m.target) || (m.target.parentElement && m.target.parentElement.closest('.' + WRAP_CLASS))) continue;
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
