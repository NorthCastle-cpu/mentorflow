# MentorFlow (web)

Offline-first Progressive Web App for tutors and mentors: students, sessions (month calendar + TimeTree Quick Import),
My Tasks / Homework kanban, money dashboard with month-end checklists per invoice method (Guidewell PDF invoice,
Luba Jones hours CSV, direct-to-parent email), expenses, global search and keyboard shortcuts.

* **Local-first.** All data is stored in the browser's IndexedDB on your device. On Cloudflare (branch `cloudflare`,
  see [CLOUDFLARE.md](CLOUDFLARE.md)) it also syncs to a private D1 database behind Cloudflare Access. On GitHub Pages
  there is no backend. Use **More → Back up now** regularly
  (on iPad this opens the share sheet → *Save to Files* / iCloud Drive) and **Restore from backup** to move data.
* **Install on iPad:** open the site in Safari → Share → *Add to Home Screen*. Runs full-screen and offline.
* **Install on Windows:** Edge/Chrome → ⋯ → Apps → *Install this site as an app*.

## Calendar export (.ics → iPad Calendar → TimeTree)

Today has an **Add … lessons to Calendar** button with a range choice (*Today*, *Last 3 days*, *Last 7 days*,
*All lessons*), plus *Add everything new since last time* when the last export was before today. Each session can also
be added on its own (session sheet), and **More › Calendar** exports all upcoming lessons and has the reminder toggle
(30-minute alert, **off by default**).

* RFC 5545 output: `VTIMEZONE` Europe/London, `DTSTART/DTEND;TZID=Europe/London`, stable `UID:<sessionId>@mentorflow`,
  `SEQUENCE` bumped on every edit (so re-adding updates the event where Calendar supports it), `STATUS:CANCELLED` for
  cancelled lessons, title always `{Student full name} – {Topic/Subject}` (the old TimeTree label field is ignored), description = channel + notes (never rates or money).
* Exported sessions show a calendar-check badge until they are edited again.
* **Delivery:** on iPhone/iPad the file is opened directly as a `text/calendar` blob (no `download` attribute, no
  charset parameter), which Safari hands to its Calendar preview with **Add All**. A follow-up sheet offers
  **Share / Save to Files** (Web Share API with the .ics file) in case the preview does not appear – e.g. in some
  Home Screen app versions – after which tapping the file in Files shows **Add All**. Other platforms download the .ics.
* TimeTree shows device-calendar events on its home calendar only (Settings › TimeTree › Calendars → Full Access).

## Develop

```bash
npm install          # only needed for tests (Playwright) – the app itself has no runtime dependencies
npm run build        # src/ → dist/ (stamps the service-worker cache version)
npm run serve        # http://localhost:8080
node tests/parser.test.mjs
node tests/calendar.test.mjs   # validates .ics with ical.js + python icalendar
node tests/e2e.mjs all   # expects dist served at http://localhost:8080/mentorflow/ (see BASE_URL)
```

Plain ES modules, no framework. jsPDF is vendored in `src/vendor/` (MIT, see `jspdf.LICENSE`).
All asset paths are relative, so the site works from any subpath (e.g. GitHub Pages `/mentorflow/`).

## Layout

```
src/index.html, manifest.webmanifest, sw.js, icons/, css/app.css
src/js/app.js        shell, router, actions, search, shortcuts
src/js/store.js      data model, derived money stats, backup, sample data
src/js/db.js         IndexedDB wrapper
src/js/parser.js     Quick Import parser (TimeTree / free text)
src/js/export.js     CSV, Luba Jones CSV, Guidewell invoice PDF/.docx (share sheet or download), payment requests
src/js/billing.js    pure billing helpers (nearest-15-minute rounding, formats, ordinals)
src/js/invoice.js    Guidewell invoice data (Private Lessons / Schools Courses / Admin, numbering, totals)
src/js/invoice-pdf.js  invoice PDF layout (jsPDF, on-device) · src/js/docx.js  editable .docx copy (no libraries)
src/js/payreq.js     Direct-parent payment request email (editable template with placeholders)
src/js/invoice-ui.js Guidewell invoice sheet + Request payment sheet
src/js/sync.js       sync-provider abstraction (local only; Notion stub)
src/js/views/*.js    Today, Students, Sessions, Tasks, Money, Expenses, More
```

### Guidewell invoice & parent payment requests

* **Money → Guidewell invoice** (also in the month-end checklist and More › Guidewell invoice): pick the month, check the
  suggested invoice number (last issued + 1; #68 for October 2026 if nothing was issued yet) and date (1st of next month),
  add extra Admin / Schools Courses lines, then **Create PDF** (iOS share sheet, or download) or **Editable copy (.docx)**
  (opens in Pages). Built on-device, works offline. The issued number and the extra lines sync privately (meta `gwinv-YYYY-MM`).
* Sections: *Private Lessons* (Guidewell sessions grouped by student + subject, default £75/h unless the student/session
  has a rate), *Schools Courses* (students marked “School / group course”, own rate, plus admin time lines; only shown when
  non-empty) and *Admin* (manual lines + “Lesson admin” = lessons × 5 min @ £20/h). No-shows and late cancels are billed;
  tick **Don’t bill** on a session to leave it out. Every session is billed to the **nearest 15 minutes** (50 → 0.75 h,
  55 → 1 h) – on invoices, parent emails and Money totals.
* **Money → Direct → Request payment** opens an editable email preview and a `mailto:` draft for the parent (Sarah presses
  Send in Mail; the app never sends). The text comes from the template in More › Payment request email.
* Bank details are **not** separate settings any more: they live in the free-text *Invoice footer / payment details* and
  in the payment email template, both shipped with a `[your bank details here]` placeholder. Nothing real is in the repo.

Sample data (More → Load sample data) is entirely fictional and can be removed with *Clear sample data*.
