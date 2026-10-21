# Google Calendar – Shift Badges

A userscript for shift workers. It shows shift codes such as `D11`, `N11`, `DOV` or `PRC` as small colored badges in the top-right corner of each day in Google Calendar's **month view** – similar to the corner info in the aCalendar Android app.

The badges come from your shift calendar's iCal feed. The calendar's normal event bars are not touched: tick or untick the shift calendar in Google Calendar's left sidebar, whichever you prefer.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox) or Violentmonkey.
2. Chrome/Edge only: open `chrome://extensions`, click **Details** on Tampermonkey and switch on **Allow User Scripts**.
3. Click **[install the script](https://raw.githubusercontent.com/mikulik86/gcal-shift-badges/main/gcal-shift-badges.user.js)** and confirm in Tampermonkey.

## Set up

1. Put each shift into a dedicated Google calendar as an all-day event whose title is just the code (`D11`, `N11`, …).
2. Google Calendar → Settings → that calendar → *Integrate calendar* → copy the **Secret address in iCal format**.
3. Open Google Calendar in month view, click the Tampermonkey icon → **Shift badges: set iCal address** → paste → OK.

The address is stored by Tampermonkey, so script updates keep it. To remove it, set an empty address. The secret address gives read access to that calendar – don't share it.

Edit your shifts as usual (in the web calendar or any app synced with it). The script reloads the feed every 30 minutes, or right away via **Shift badges: reload now**. Google can take a while to publish changes in the iCal feed.

## Settings

Colors and options are in the `CONFIG` block at the top of the script (Tampermonkey dashboard → edit).

**Codes and colors** – `rules` decides the badge color by event title. A title matches only if the whole title fits the pattern; the first matching rule wins:

```js
rules: [
  { match: /^D\d+$/, bg: '#039be5' }, // D11, D8, …
  { match: /^N\d+$/, bg: '#33b679' }, // N11, …
  { match: /^DOV$/,  bg: '#e67c73' },
  { match: /^PRC$/,  bg: '#616161' },
  // add your own, e.g. { match: /^S\d+$/, bg: '#f4511e' },
],
```

Titles that match no rule are shown in grey; set `showUnmatched: false` to skip them.

> When the script updates, Tampermonkey replaces the whole file, including edits in `CONFIG`. Note your changes down, or switch off *Check for updates* for this script. The iCal address is not affected.

## Troubleshooting

Tampermonkey menu → **Shift badges: diagnose** shows whether an address is set, the feed status, and what the script found on the page. Please include that output when opening an issue.

## Limitations

- Month view in a desktop browser only; the Google Calendar mobile apps are not affected.
- Google Calendar's page structure is undocumented and changes from time to time, which can break the script until it is adjusted.
- Recurring events (`RRULE`) in the feed are not expanded; one event per shift works fine.

## License

MIT
