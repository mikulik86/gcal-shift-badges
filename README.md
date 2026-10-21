# Google Calendar – Shift Badges

A userscript for shift workers. It shows shift codes such as `D11`, `N11`, `DOV` or `PRC` as small colored badges in the top-right corner of each day in Google Calendar's **month view** – similar to the corner info in the aCalendar Android app – and hides the normal event bars for those events, so the day stays free for your real appointments.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox) or Violentmonkey.
2. Chrome/Edge only: open `chrome://extensions`, click **Details** on Tampermonkey and switch on **Allow User Scripts**.
3. Click **[install the script](https://raw.githubusercontent.com/mikulik86/gcal-shift-badges/main/gcal-shift-badges.user.js)** and confirm in Tampermonkey.
4. Open Google Calendar in month view.

Put each shift into your calendar as an all-day event whose title is just the code (`D11`, `N11`, …). A dedicated calendar for shifts works best.

## Settings

All settings are in the `CONFIG` block at the top of the script (Tampermonkey dashboard → edit).

**Codes and colors** – `rules` decides which event titles become badges. A title matches only if the whole title fits the pattern; the first matching rule sets the color:

```js
rules: [
  { match: /^D\d+$/, bg: '#039be5' }, // D11, D8, …
  { match: /^N\d+$/, bg: '#33b679' }, // N11, …
  { match: /^DOV$/,  bg: '#e67c73' },
  { match: /^PRC$/,  bg: '#616161' },
  // add your own, e.g. { match: /^S\d+$/, bg: '#f4511e' },
],
```

**Only one calendar** – set `calendarName` to your shift calendar's name if events from other calendars could have titles that look like shift codes.

**iCal mode (cleaner look)** – by default the script reads the shift events from the page. Google still reserves the space of the hidden event bars, so other events on those days start one line lower. To avoid that:

1. Google Calendar → Settings → your shift calendar → *Integrate calendar* → copy the **Secret address in iCal format**.
2. Paste it into `icsUrl`.
3. Untick the shift calendar in the left sidebar.

The badges are then drawn from that feed (refreshed every 30 minutes, or via the Tampermonkey menu → *Shift badges: reload iCal now*). The secret address gives read access to that calendar – don't share your edited copy of the script.

> Note: when the script updates, Tampermonkey replaces the whole file, including your edited settings. Note your changes down, or switch off *Check for updates* for this script in Tampermonkey.

## Troubleshooting

Tampermonkey menu → **Shift badges: diagnose** shows what the script found on the page (view, day cells, shift events, iCal status). Please include that output when opening an issue.

## Limitations

- Month view in a desktop browser only; the Google Calendar mobile apps are not affected.
- Google Calendar's page structure is undocumented and changes from time to time, which can break the script until it is adjusted.
- iCal mode does not expand recurring events (`RRULE`); single events per day work fine.

## License

MIT
