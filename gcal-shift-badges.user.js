// ==UserScript==
// @name         Google Calendar – Shift Badges
// @namespace    gcal-shift-badges
// @version      1.1.0
// @description  Shows shift codes (D11, N11, DOV, PRC …) as small colored badges in the top-right corner of each day in Google Calendar's month view, like aCalendar's corner info. Reads them from the event bars (and hides those) or from the shift calendar's iCal feed.
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

(function () {
  'use strict';

  /* ======================= SETTINGS – edit here ======================= */
  const CONFIG = {
    // Which event titles become badges, and their colors. First match wins.
    // A title matches only if the WHOLE title fits the pattern.
    rules: [
      { match: /^D\d+$/, bg: '#039be5' }, // D11, D8, …   (Google "Peacock")
      { match: /^N\d+$/, bg: '#33b679' }, // N11, …       (Google "Sage")
      { match: /^DOV$/,  bg: '#e67c73' }, // DOV          (Google "Flamingo")
      { match: /^PRC$/,  bg: '#616161' }, // PRC          (Google "Graphite")
    ],
    textColor: '#ffffff',

    // Default mode (no iCal address): badges are read from the event bars on
    // the page. true = hide those event bars.
    hideEventBars: true,

    // Default mode only: treat events as shifts only if their (hidden) chip
    // text mentions this calendar name. '' = matching titles from any calendar.
    calendarName: '',

    // --- Optional "iCal mode" -------------------------------------------
    // Set the shift calendar's "Secret address in iCal format" via the
    // Tampermonkey menu → "Shift badges: set iCal address" (kept across script
    // updates), or paste it here. In iCal mode the badges come only from that
    // feed and the event bars are left completely alone: whether the shift
    // calendar also shows as normal events is up to its tick box in the sidebar.
    icsUrl: '',
    icsRefreshMinutes: 30,
    // In iCal mode, also show titles that match no rule (in a neutral color).
    icsShowUnmatched: true,
    unmatchedColor: '#757575',

    // Badge position inside the day cell (pixels from the top/right edge).
    offsetTop: 4,
    offsetRight: 4,

    debug: false,
  };
  /* ==================================================================== */

  const PREFIX = 'gcsb';
  const HIDE_CLASS = `${PREFIX}-hide`;
  const WRAP_CLASS = `${PREFIX}-wrap`;
  const BADGE_CLASS = `${PREFIX}-badge`;

  const log = (...a) => { if (CONFIG.debug) console.log('[shift-badges]', ...a); };
  const lastRun = { info: {} };

  /* ----------------------------- styles ------------------------------ */
  const css = `
    .${HIDE_CLASS} { display: none !important; }
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

  function ruleFor(code) {
    return CONFIG.rules.find((r) => r.match.test(code)) || null;
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

  /* ---------------------- shift events from chips --------------------- */
  function chipText(chip) {
    return `${chip.getAttribute('aria-label') || ''}\n${chip.innerText || ''}`;
  }

  function codeFromText(text) {
    if (CONFIG.calendarName && !text.includes(CONFIG.calendarName)) return null;
    for (let tok of text.split(/[\n,]/)) {
      tok = tok.trim().replace(/^\d{1,2}(:\d{2})?\s*(am|pm)?\s+/i, '');
      if (tok && ruleFor(tok)) return tok;
    }
    return null;
  }

  function findChips(main) {
    const all = [...main.querySelectorAll('[data-eventid], [data-eventchip]')];
    const set = new Set(all);
    return all.filter((el) => {
      if (el.closest('[role="dialog"]')) return false;
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }

  // For each chip, pick the day cell(s) it sits in: same column, and the cell
  // that contains it or is nearest above it.
  function cellsForRect(r, cells) {
    const byCol = new Map();
    for (const c of cells) {
      const overlap = Math.min(r.right, c.r.right) - Math.max(r.left, c.r.left);
      if (overlap < Math.min(c.r.width, r.width) * 0.5) continue;
      const cy = r.top + Math.min(r.height, 20) / 2;
      let score;
      if (cy >= c.r.top && cy <= c.r.bottom) score = 0;
      else if (c.r.bottom <= r.top + 2) score = r.top - c.r.bottom + 1;
      else continue;
      const col = Math.round(c.r.left);
      const best = byCol.get(col);
      if (!best || score < best.score) byCol.set(col, { c, score });
    }
    return [...byCol.values()].map((v) => v.c);
  }

  /* --------------------------- iCal source --------------------------- */
  const ics = { byDate: new Map(), events: 0, fetchedAt: 0, error: null, loading: false };

  function parseIcsDate(prop, value) {
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
      if (name === 'DTSTART') ev.start = parseIcsDate(line, value);
      else if (name === 'DTEND') ev.end = parseIcsDate(line, value);
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

  // The iCal address: menu setting (stored, survives updates) > CONFIG.icsUrl.
  // On first run of this version, an address cached by v1.0 is adopted.
  const store = {
    get: (k, d) => (typeof GM_getValue === 'function' ? GM_getValue(k, d) : d),
    set: (k, v) => { if (typeof GM_setValue === 'function') GM_setValue(k, v); },
  };
  (function migrateIcsUrl() {
    if (store.get('icsUrl', null) !== null || CONFIG.icsUrl) return;
    const cached = store.get('icsCache', null);
    if (cached && cached.url) store.set('icsUrl', cached.url);
  })();

  function getIcsUrl() {
    const stored = store.get('icsUrl', null);
    return stored !== null ? stored : CONFIG.icsUrl;
  }

  function resetIcs() {
    ics.byDate = new Map(); ics.events = 0; ics.fetchedAt = 0; ics.error = null;
  }

  function loadIcs(force) {
    const url = getIcsUrl();
    if (!url || ics.loading) return;
    const cached = store.get('icsCache', null);
    if (cached && cached.url === url && !ics.fetchedAt) applyIcsText(cached.text, cached.t);
    const fresh = Date.now() - ics.fetchedAt < CONFIG.icsRefreshMinutes * 60e3;
    if (fresh && !force) return;
    ics.loading = true;
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      onload: (res) => {
        ics.loading = false;
        if (url !== getIcsUrl()) return; // address changed meanwhile
        if (res.status !== 200 || !/BEGIN:VCALENDAR/.test(res.responseText || '')) {
          ics.error = `HTTP ${res.status}`; log('iCal fetch failed', res.status); schedule(); return;
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
    const current = getIcsUrl();
    const input = prompt(
      'Secret address in iCal format of your shift calendar\n'
      + '(Google Calendar → Settings → the calendar → Integrate calendar).\n\n'
      + 'Leave empty to switch iCal mode off.',
      current,
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
    alert(url ? 'iCal mode on. Badges now come from the feed; event bars are left alone.'
      : 'iCal mode off. Badges are read from the event bars again.');
  }

  /* ----------------------------- render ------------------------------ */
  function setBadges(cellEl, codes) {
    let wrap = null;
    for (const ch of cellEl.children) if (ch.classList.contains(WRAP_CLASS)) { wrap = ch; break; }
    const sig = codes.join('|');
    if (!codes.length) { if (wrap) wrap.remove(); return; }
    if (wrap && wrap.dataset.sig === sig) return;
    if (getComputedStyle(cellEl).position === 'static') cellEl.style.position = 'relative';
    if (!wrap) { wrap = document.createElement('div'); wrap.className = WRAP_CLASS; cellEl.appendChild(wrap); }
    wrap.dataset.sig = sig;
    wrap.replaceChildren(...codes.map((code) => {
      const b = document.createElement('span');
      b.className = BADGE_CLASS;
      b.textContent = code;
      const rule = ruleFor(code);
      b.style.background = rule ? rule.bg : CONFIG.unmatchedColor;
      if (rule && rule.fg) b.style.color = rule.fg;
      return b;
    }));
  }

  function clearAll(root) {
    root.querySelectorAll('.' + WRAP_CLASS).forEach((w) => w.remove());
    root.querySelectorAll('.' + HIDE_CLASS).forEach((c) => c.classList.remove(HIDE_CLASS));
  }

  function render() {
    const main = document.querySelector('[role="main"]') || document.body;
    const icsUrl = getIcsUrl();
    const info = { mode: icsUrl ? 'iCal' : 'event bars', view: 'other', cells: 0, rows: 0,
      dating: '-', chips: 0, shiftChips: 0, badgedCells: 0 };
    lastRun.info = info;

    if (isOtherView()) { clearAll(main); return; }

    // Show any bars hidden earlier: in iCal mode they stay visible; in the
    // default mode they're measured and re-hidden below (no paint in between).
    main.querySelectorAll('.' + HIDE_CLASS).forEach((c) => c.classList.remove(HIDE_CLASS));

    const cells = findDayCells(main);
    info.cells = cells.length;
    info.rows = countRows(cells);
    if (cells.length < 20 || info.rows < 4) { clearAll(main); return; }
    info.view = 'month';

    const want = new Map(cells.map((c) => [c.el, []]));
    const add = (el, code) => { const l = want.get(el); if (l && !l.includes(code)) l.push(code); };

    if (!icsUrl) {
      // Default mode: read shift events from the event bars on the page.
      const chips = findChips(main);
      info.chips = chips.length;
      const shiftChips = [];
      for (const chip of chips) {
        const code = codeFromText(chipText(chip));
        if (!code) continue;
        const r = chip.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        shiftChips.push(chip);
        for (const c of cellsForRect(r, cells)) add(c.el, code);
      }
      info.shiftChips = shiftChips.length;
      if (CONFIG.hideEventBars) shiftChips.forEach((c) => c.classList.add(HIDE_CLASS));
    } else {
      // iCal mode: badges only from the feed; event bars are not touched.
      const { method, dates } = dateCells(cells);
      info.dating = method;
      if (dates) {
        info.firstDate = ymd(dates[0]);
        info.lastDate = ymd(dates[dates.length - 1]);
        cells.forEach((c, i) => {
          for (const title of ics.byDate.get(ymd(dates[i])) || []) {
            if (ruleFor(title) || CONFIG.icsShowUnmatched) add(c.el, title);
          }
        });
      }
    }

    for (const [el, codes] of want) {
      setBadges(el, codes);
      if (codes.length) info.badgedCells++;
    }
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
  setInterval(() => loadIcs(true), CONFIG.icsRefreshMinutes * 60e3);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Shift badges: diagnose', () => {
      render();
      const i = lastRun.info;
      const lines = [
        `Mode: ${i.mode}`,
        `View detected: ${i.view}`,
        `Day cells: ${i.cells} in ${i.rows} rows`,
      ];
      if (i.mode === 'iCal') {
        lines.push(`iCal: ${ics.events} events, ${ics.error ? 'error: ' + ics.error
          : 'last loaded ' + (ics.fetchedAt ? new Date(ics.fetchedAt).toLocaleString() : 'never')}`);
        lines.push(`Date mapping: ${i.dating}${i.firstDate ? ` (${i.firstDate} … ${i.lastDate})` : ''}`);
      } else {
        lines.push(`Event bars found: ${i.chips}, shift events among them: ${i.shiftChips}`);
      }
      lines.push(`Days with badges: ${i.badgedCells}`);
      console.log('[shift-badges] diagnose', i);
      alert(lines.join('\n'));
    });
    GM_registerMenuCommand('Shift badges: set iCal address', askForIcsUrl);
    GM_registerMenuCommand('Shift badges: reload iCal now', () => {
      if (!getIcsUrl()) { alert('No iCal address set.'); return; }
      loadIcs(true);
    });
  }

  schedule();
})();
