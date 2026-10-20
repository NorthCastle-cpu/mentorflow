# MentorFlow (web)

Offline-first Progressive Web App for tutors and mentors: students, sessions (month calendar + TimeTree Quick Import),
My Tasks / Homework kanban, money dashboard with month-end checklists per invoice method (Guidewell PDF invoice,
Luba Jones hours CSV, direct-to-parent email), expenses, global search and keyboard shortcuts.

* **No backend.** All data is stored in the browser's IndexedDB on your device. Use **More → Back up now** regularly
  (on iPad this opens the share sheet → *Save to Files* / iCloud Drive) and **Restore from backup** to move data.
* **Install on iPad:** open the site in Safari → Share → *Add to Home Screen*. Runs full-screen and offline.
* **Install on Windows:** Edge/Chrome → ⋯ → Apps → *Install this site as an app*.

## Develop

```bash
npm install          # only needed for tests (Playwright) – the app itself has no runtime dependencies
npm run build        # src/ → dist/ (stamps the service-worker cache version)
npm run serve        # http://localhost:8080
node tests/parser.test.mjs
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
src/js/export.js     CSV, Guidewell PDF/printable invoice, Luba Jones CSV, parent email
src/js/sync.js       sync-provider abstraction (local only; Notion stub)
src/js/views/*.js    Today, Students, Sessions, Tasks, Money, Expenses, More
```

Sample data (More → Load sample data) is entirely fictional and can be removed with *Clear sample data*.
