# Phase 3 plan: Customer and admin frontend

Branch: `phase-3/frontend` (stacked on the finished Phase 2 backend). Frontend only, plus CI and
README. Contract: `docs/api.md` as it stands. **No API change is planned**: every screen below maps
to an existing endpoint. If an implementer finds a gap, they stop and the change goes into
`docs/api.md` first as a separate `docs` task (CLAUDE.md rule).

## Scope

1. **Auth** (C1): login and register pages; JWT kept in `localStorage` (key `parkit.token`);
   `AuthProvider` restores the session with `GET /api/auth/me`; protected routes by role;
   role-based nav (guest / customer / admin). Any 401 on a request that carried a token logs out
   and sends the user to `/login` with "Your session has expired"; a 401 on login itself shows
   "Invalid email or password". 429 shows "Too many attempts. Wait a minute and try again."
2. **Booking flow** (C2, C3): date, start time, hours, vehicle type, vehicle number, availability
   grid with price per slot, "Any free slot" option, under-2-hours no-cancel warning, simulated
   payment confirm, then the booking detail page with its QR.
3. **My bookings** (C4, C5): Active and Past tabs, status badges (including derived `missed` and
   the `overstayed` flag), cancel with a confirmation dialog when `can_cancel` is true.
4. **Booking detail** (C4, C6): large booking code, QR image, times in IST, amount, payment status.
5. **Admin dashboard** (A5, A7): summary cards for a date range (revenue, occupancy, counts),
   per-day breakdown, bookings for a chosen day (default today, prev/next day to see upcoming),
   status filter, overstay highlight, admin cancel.
6. **Admin slots** (A1, A2, A4): list, create, edit code/type/rates, block/unblock, delete with
   the 409 "block it instead" message surfaced.
7. **Admin settings** (A3): opening and closing time, max advance days, name, address.
8. **Admin gate** (A6): type a booking code, see the booking, check in or check out.
9. **Phone width**: every page usable at 360 px wide.
10. **Tests**: vitest + jsdom + @testing-library/react (devDependencies only) for pure helpers,
    the API client and one or two components; `npm test` added to the frontend CI job.
11. **Stretch (optional, last)**: QR scanning on the gate page with the browser `BarcodeDetector`
    API; typed code stays the default and the fallback.

**New runtime dependencies: none.** New devDependencies: `vitest`, `jsdom`,
`@testing-library/react`, `@testing-library/dom`.

### Assumptions (ambiguities resolved)

- **F1 IST without a library.** As in backend assumption A1, `Asia/Kolkata` is fixed UTC+05:30.
  Display uses `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ... })`; arithmetic
  ("today in IST", start-time options) shifts by 330 minutes and uses `getUTC*`. Every displayed
  time carries an "IST" suffix, so a visitor in another timezone is not misled.
- **F2 Token in localStorage.** Simple and survives reloads; the trade-off is that any XSS could
  read it. Mitigations: React escapes output, no `dangerouslySetInnerHTML`, no third-party
  scripts; the token expires after 7 days. An httpOnly cookie would need API changes (CSRF,
  CloudFront cookie forwarding) and is noted as future work in the README.
- **F3 Same-origin API.** `BASE` stays `${VITE_API_URL ?? ''}/api`. `qr_url` is either a relative
  `/api/files/...` path (local) or an absolute pre-signed S3 URL (AWS); `fileUrl(qr_url)` prefixes
  `VITE_API_URL` only for relative paths. A pre-signed URL lasts 15 minutes, so the detail page
  re-fetches the booking when the QR image fails to load (one retry).
- **F4 Start-time options.** For the chosen IST date: every `:00`/`:30` from `opens_at` to
  `closes_at − 1 h`; for today, only options at or after the start of the current half hour (D7).
  Hours options: 1 … whole hours left until `closes_at` (D6). Date picker: `min` = today (IST),
  `max` = today + `max_advance_days`. If today has no start left, show "Bookings for today are
  closed" and preselect tomorrow. The server stays the authority; its 400 messages are shown as is.
- **F5 "Any free slot" price.** The tile shows the amount if every free slot of that type has the
  same amount, otherwise "from ₹X" (lowest). The confirmed booking shows the real amount.
- **F6 Availability fetch.** Fetched automatically when date, start, hours and type are all set,
  with an `AbortController` cancelling stale requests; a "Refresh" button re-fetches. After a 409
  on booking, the grid re-fetches and the error explains what happened.
- **F7 Confirmation screen.** After `POST /api/bookings` succeeds the app navigates to
  `/bookings/:code?new=1`; the detail page shows a success banner. No separate confirmation page.
- **F8 Upcoming bookings for admin.** `GET /api/admin/bookings` is per day, so the dashboard has a
  day picker with prev/next buttons; "upcoming" = moving forward a day. No new endpoint.
- **F9 Gate lookup.** The gate page loads the booking with `GET /api/bookings/:code` (admins may
  read any booking). Typed codes are normalised: uppercase, spaces removed, and `PK` + 6 chars
  without the dash becomes `PK-XXXXXX`.
- **F10 Admin cannot book.** Admin nav has no "Book" link and `/book` redirects admins to `/admin`
  (the API would answer 403).
- **F11 Money.** `formatINR("4560.00")` → `₹4,560.00` (en-IN grouping, always 2 decimals). Money is
  never summed on the client except the F5 minimum (a comparison, not arithmetic on totals).

### Routes

| Path | Access | Page file |
|---|---|---|
| `/` | all | `pages/Home.jsx` |
| `/login`, `/register` | guests (signed-in users are redirected to their home) | `pages/Login.jsx`, `pages/Register.jsx` |
| `/book` | customer | `pages/Book.jsx` |
| `/bookings` | customer | `pages/MyBookings.jsx` |
| `/bookings/:code` | customer or admin | `pages/BookingDetail.jsx` |
| `/admin` | admin | `pages/admin/Dashboard.jsx` |
| `/admin/slots` | admin | `pages/admin/Slots.jsx` |
| `/admin/settings` | admin | `pages/admin/Settings.jsx` |
| `/admin/gate` | admin (`?code=` prefills) | `pages/admin/Gate.jsx` |
| `*` | all | `pages/NotFound.jsx` |

Role home: customer → `/bookings`, admin → `/admin`. Not signed in on a protected route →
`/login?next=<path>`; wrong role → role home.

### CSS vocabulary (agreed up front so T1 and T4 can run in parallel)

Tokens in `:root`: `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`,
`--color-border`, `--color-primary`, `--color-primary-contrast`, `--color-success`,
`--color-warning`, `--color-danger`, `--color-info` (each with a `-soft` background variant),
`--radius-sm/md/lg`, `--space-1`…`--space-8`, `--font-sans`, `--font-mono`, `--text-sm/base/lg/xl/2xl`,
`--shadow-sm/md`, `--focus-ring`. Classes: `.container`, `.page-header`, `.stack`, `.row`,
`.grid`, `.card`, `.btn` + `.btn-primary|.btn-secondary|.btn-danger|.btn-ghost` + `.btn-sm`,
`.field`, `.field-hint`, `.field-error`, `.input`, `.select`, `.segmented`, `.tabs`/`.tab`,
`.badge` + `.badge-success|warning|danger|info|neutral`, `.alert` + `.alert-success|warning|danger|info`,
`.table` (stacks into cards below 640 px via `data-label` on cells), `.stat-card`, `.bar`,
`.slot-grid`/`.slot-tile` (+ `.is-selected`, `.is-unavailable`), `.code` (booking code, mono,
large, letter-spaced), `.qr`, `.empty-state`, `.spinner`, `.skeleton`, `.dialog`, `.nav`,
`.nav-toggle`, `.visually-hidden`, `.no-print` (hidden under `@media print`). Focus: `:focus-visible { outline: var(--focus-ring) }` on
every interactive element. Contrast at least WCAG AA.

## Tasks

All `frontend-dev` paths are under `frontend/` unless written from the repo root.

**T1. Design tokens and base styles** (frontend-dev)
Files: `src/index.css`, `index.html`.
Done: `index.css` defines every token and class in the CSS vocabulary above, system font stack
(no web fonts), base element styles, visible focus ring, `prefers-reduced-motion` respected, and
layout that does not overflow horizontally at 360 px; `index.html` has `lang="en"`, title
"ParkIt: book parking ahead", meta description and `theme-color`, an inline SVG favicon (data
URI). `npm run build` passes. Depends on: none.

**T2. Test tooling and pure helpers** (frontend-dev)
Files: `package.json`, `package-lock.json`, `vite.config.js` (add `test: { environment: 'jsdom' }`),
repo-root `.github/workflows/ci.yml` (add `- run: npm test` after build in the frontend job),
`src/lib/time.js`, `src/lib/money.js`, `src/lib/status.js`, `src/lib/codes.js`, and
`src/lib/*.test.js`.
Done: `npm test` runs `vitest run` and passes; helpers exported and tested:
- `time.js`: `todayIST(now)`, `addDaysIST(date, n)`, `startsAtISO(date, 'HH:MM')` →
  `YYYY-MM-DDTHH:MM:00+05:30`, `startTimeOptions(facility, date, now)`, `hourOptions(facility, 'HH:MM')`,
  `isWithinCancelWindow(startsAtISO, now)` (true when start − now < 2 h), `formatDate`,
  `formatTime`, `formatDateTime`, `formatTimeRange(starts, ends)` (e.g. "Tue, 1 Dec 2026 ·
  10:00 – 13:00 IST"). Tests cover: today filtering at 10:10 → first option 10:00; `opens_at
  06:30`; `closes_at 23:00` → last start 22:00; hours list shrinks near closing; a UTC instance
  near midnight maps to the right IST date.
- `money.js`: `formatINR(string)`; tests for `"0.00"`, `"280.00"`, `"4560.00"` → `₹4,560.00`, `null` → `—`.
- `status.js`: `statusLabel(status)` and `statusTone(status)` for all five statuses
  (`missed` → danger, `checked_in` → info, `completed` → success, `cancelled` → neutral,
  `confirmed` → primary/info); tested.
- `codes.js`: `normaliseBookingCode(input)`, `normaliseVehicleNumber(input)`,
  `isValidVehicleNumber(normalised)` (`^[A-Z0-9]{4,12}$`, D9); tested.
Depends on: none.

**T3. API client, endpoints and auth** (frontend-dev)
Files: `src/api/client.js`, `src/api/parkit.js`, `src/auth/AuthContext.jsx`, `src/auth/RequireRole.jsx`.
Done:
- `client.js`: `api(path, { method, body, signal })` keeps working for `Home.jsx`; adds the
  `Authorization` header from a registered token getter; throws `ApiError { status, message,
  details }`; 204 returns `null`; network failure → `ApiError(0, "Cannot reach the server. Check
  your connection.")`; 429 → the friendly message in Scope 1; 401 on a request that carried a token
  calls a registered `onUnauthorized` callback. Exports `fileUrl(url)` (F3).
- `parkit.js`: one function per endpoint in `docs/api.md` (`login`, `register`, `me`,
  `getFacility`, `getAvailability`, `createBooking`, `myBookings(scope)`, `getBooking`,
  `cancelBooking`, `adminSlots`, `createSlot`, `updateSlot`, `deleteSlot`, `updateFacility`,
  `adminBookings(date, status)`, `checkIn`, `checkOut`, `summary(from, to)`), codes URL-encoded.
- `AuthContext.jsx`: `AuthProvider` + `useAuth()` exposing `{ user, status: 'loading'|'ready',
  login, register, logout }`; token in `localStorage['parkit.token']`; on start with a token calls
  `me()`; registers the token getter and `onUnauthorized` (logout + navigate to `/login` with a
  "session expired" notice in router state).
- `RequireRole.jsx`: `<RequireRole roles={['customer']}>`; spinner while `loading`; redirects
  per the Routes section.
`npm run build` passes. Depends on: none.

**T4. Shared UI components** (frontend-dev)
Files: `src/components/Field.jsx`, `Alert.jsx`, `Spinner.jsx`, `EmptyState.jsx`,
`StatusBadge.jsx`, `ConfirmDialog.jsx`, `BookingSummary.jsx`, `PageHeader.jsx` (all in
`src/components/`).
Done: `Field` renders `<label for>` + control + hint + error linked with `aria-describedby`,
`aria-invalid` when in error; `Alert` uses `role="alert"` for danger and `role="status"` otherwise;
`ConfirmDialog` uses native `<dialog>` with `showModal()`, focus returns to the trigger, Escape
closes, confirm button shows a busy state; `StatusBadge` shows the label and tone from
`lib/status.js` plus an extra "Overstayed" warning badge when `overstayed`; `BookingSummary`
shows code (`.code`), slot, vehicle, IST time range, hours, amount (`formatINR`) and status, and
renders as a card; `Spinner` has an accessible label. Uses only the CSS vocabulary classes.
Depends on: T2.

**T5. App shell, routing and page stubs** (frontend-dev)
Files: `src/main.jsx`, `src/App.jsx`, `src/pages/Home.jsx`, `src/pages/NotFound.jsx`, delete
`src/pages/Placeholder.jsx`, and create stub files (a heading only) for every other page in the
Routes table.
Done: `AuthProvider` wraps the app inside `BrowserRouter`; routes match the Routes table with
`RequireRole`; nav shows Guest: Book a slot, Log in, Register / Customer: Book a slot, My
bookings, name + Log out / Admin: Dashboard, Gate, Slots, Settings, Log out; nav collapses behind
a `.nav-toggle` button (`aria-expanded`, `aria-controls`) below 640 px; a skip-to-content link;
page `<title>` set per page via `document.title`. Home: hero, three-step "how it works", facility
name, address and hours from `GET /api/facility`, role-aware call to action, small API status
line in the footer. NotFound has a link home. `npm run build` passes. Depends on: T3.

**T6. Login and register pages** (frontend-dev)
Files: `src/pages/Login.jsx`, `src/pages/Register.jsx`.
Done: labelled fields with `autocomplete` (`email`, `current-password`, `new-password`, `name`,
`tel`); client checks (email format, password 8+ chars, phone 10–15 digits if given) before
sending; server `details` mapped to field errors; submit button disabled with spinner while
pending; 401/409/429 messages shown in an `Alert`; "session expired" notice from router state;
success goes to `?next=` or role home; links between the two pages; demo admin hint shown only
when `import.meta.env.DEV`. Depends on: T3, T4, T5.

**T7. Booking flow** (frontend-dev)
Files: `src/pages/Book.jsx`, `src/components/SlotGrid.jsx`.
Done:
- Step 1 "When and what": date input (min/max per F4), start-time `<select>` from
  `startTimeOptions`, hours `<select>` from `hourOptions` (shows end time, e.g. "3 h (until
  13:00)"), vehicle type as a `.segmented` radio group (Car / Bike), facility hours shown as hint.
- Step 2 "Choose a slot": `SlotGrid` is a `<fieldset>` of radio tiles: first tile "Any free slot"
  (F5), then each slot with code, available or booked, and `formatINR(amount)`; booked tiles are
  disabled; loading skeleton; empty state when no slot of that type exists; "Refresh" button.
- Step 3 "Vehicle and pay": vehicle number input with live normalised preview and D9 validation;
  summary (date, IST range, hours, slot or "Assigned on booking", amount, "Simulated payment");
  if `isWithinCancelWindow` a warning `Alert`: "This booking starts in under 2 hours and cannot
  be cancelled."; button "Pay ₹X and book".
- On 201 navigate to `/bookings/<code>?new=1`; on 409 show the server message and re-fetch the
  grid; on 400 show the server message next to the form.
- Single column at 360 px; tiles wrap. Depends on: T3, T4, T5.

**T8. My bookings page** (frontend-dev)
Files: `src/pages/MyBookings.jsx`.
Done: Active / Past tabs (`role="tablist"`, state in `?scope=`), list of `BookingSummary` cards
newest-relevant first (API order), each linking to the detail page; Cancel button only when
`can_cancel`, otherwise for `confirmed` bookings a muted note "Cancellation closed (under 2 hours
to start)"; `ConfirmDialog` with "Your simulated payment of ₹X will be refunded"; after cancel
the list re-fetches and a success `Alert` shows; loading, error (with retry) and empty states
(empty Active has a "Book a slot" button). Depends on: T3, T4, T5.

**T9. Booking detail page** (frontend-dev)
Files: `src/pages/BookingDetail.jsx`.
Done: large `.code` booking code with a Copy button (`navigator.clipboard`, falls back silently);
QR image from `fileUrl(qr_url)` with alt "QR code for booking PK-XXXXXX", one re-fetch on image
error (F3), "QR not available" for cancelled; status badge, overstayed badge, IST times, hours,
slot, vehicle, amount, payment status (paid / refunded), check-in and check-out times when set;
`?new=1` shows "Booking confirmed" success banner; customer sees Cancel when `can_cancel`;
admin sees "Open at gate" linking to `/admin/gate?code=`; 404 shows "Booking not found" with a
link back. Print-friendly: nav and buttons carry `.no-print` (the CSS rule is T1's).
Depends on: T3, T4, T5.

**T10. Admin dashboard** (frontend-dev)
Files: `src/pages/admin/Dashboard.jsx`, `src/components/admin/SummaryPanel.jsx`.
Done: `SummaryPanel` has range presets (Today, Last 7 days, This month) and custom from/to date
inputs (validated `to ≥ from`), cards for Revenue (`formatINR`), Occupancy (`%` with one
decimal), and counts (Upcoming, Checked in, Completed, Missed, Cancelled), plus a per-day table
with a CSS `.bar` for occupancy. Dashboard bookings section: day picker with Prev / Today / Next,
status filter `<select>`, table (time range IST, code, customer name + phone, vehicle, slot,
amount, status + overstayed badge) that stacks at phone width; row actions: "Open at gate" link,
and Cancel (with `ConfirmDialog`) when `can_cancel`; loading/empty/error states. Depends on:
T3, T4, T5.

**T11. Admin slots page** (frontend-dev)
Files: `src/pages/admin/Slots.jsx`, `src/components/admin/SlotForm.jsx`.
Done: table of all slots (code, type, hourly, daily, Blocked/Active badge) ordered by code;
"Add slot" opens `SlotForm` (code, type, hourly rate, daily rate, client validation ≥ 0, 2
decimals); Edit uses the same form and sends only changed fields; Block/Unblock toggles
`is_blocked` with a note "Existing bookings are kept"; Delete with `ConfirmDialog`; the 409
"Slot has bookings; block it instead" and "Slot code already used" / "type cannot change" messages
appear in an `Alert` (delete offers a "Block instead" button). Depends on: T3, T4, T5.

**T12. Admin settings page** (frontend-dev)
Files: `src/pages/admin/Settings.jsx`.
Done: form prefilled from `GET /api/facility`: name, address, opens at / closes at (`<select>`
of `:00`/`:30` values 00:00–23:30), max advance days (1–365); client check `closes_at > opens_at`;
sends only changed fields with `PATCH /api/admin/facility`; success `Alert`; 400 details mapped
to fields; timezone shown read-only as "Asia/Kolkata (IST)". Depends on: T3, T4, T5.

**T13. Admin gate (check-in/out by code)** (frontend-dev)
Files: `src/pages/admin/Gate.jsx`.
Done: one large code input (`autocapitalize="characters"`, `inputmode="text"`, autofocus) with
`normaliseBookingCode`; Find loads the booking (`?code=` prefills and loads); shows
`BookingSummary`; primary action is "Check in" when `confirmed`, "Check out" when `checked_in`,
otherwise a note explaining why nothing can be done (completed / cancelled / missed); the 409
"Too early: check-in opens 15 minutes before the start" message shown as a warning; after a
successful action a success `Alert` with the time, overstayed badge on check-out when flagged,
and the input cleared and refocused for the next car; 404 "No booking with that code".
Depends on: T2, T3, T4, T5.

**T14. Component and client tests** (frontend-dev)
Files: `src/api/client.test.js`, `src/components/StatusBadge.test.jsx`,
`src/auth/RequireRole.test.jsx`.
Done: client tests stub `fetch` and check the Bearer header, `ApiError` status/details, 204 →
null, 429 message, network error message, and that `onUnauthorized` fires on a 401 only when a
token was sent; StatusBadge renders label and overstayed badge; RequireRole redirects a guest to
`/login?next=` and a customer away from an admin route (using `MemoryRouter` and a test auth
value). `npm test` passes. Depends on: T2, T3, T4.

**T15. README and docs** (docs)
Files: repo-root `README.md`, `docs/PHASES.md`.
Done: README has a "Using the app" section (customer flow, admin flow, demo admin from the seed,
pages list), `npm test` for the frontend, and the localStorage token trade-off (F2) under known
limitations; PHASES.md Phase 3 boxes ticked only for items the tester verified. Depends on: T6–T13
and the test pass.

**T16. Stretch: scan QR at the gate** (frontend-dev, optional)
Files: `src/components/admin/QrScanner.jsx`, `src/pages/admin/Gate.jsx`.
Done: "Scan QR" button appears only when `'BarcodeDetector' in window` and
`navigator.mediaDevices?.getUserMedia` exist (secure context: localhost or the CloudFront HTTPS
domain); opens the rear camera (`facingMode: 'environment'`) in a `<dialog>`, detects `qr_code`
about 4 times a second, on a match fills the input, stops every camera track and runs Find;
camera-denied and unsupported cases show a message and leave the typed input working. No new
dependency. Depends on: T13. Skip if time is short.

## Parallel groups

No two tasks in the same group share a file.

| Group | Tasks | Notes |
|---|---|---|
| A (foundation) | T1, T2, T3 | Disjoint files; T1 follows the CSS vocabulary, T3 needs nothing from T2. |
| B | T4, T5 | T4 needs T2; T5 needs T3. |
| C (pages) | T6, T7, T8, T9, T10, T11, T12, T13, T14 | Each owns its page/component files; all import shared modules read-only. |
| D | T15 | After the test pass. |
| E (optional) | T16 | Last; edits `Gate.jsx`, so never alongside T13. |

If a page task needs a new shared CSS class or helper, it does not edit `index.css` or `lib/`;
it uses a page-local class name in its own JSX with inline styles kept minimal, and reports the
need so a follow-up task folds it into T1's file.

## Test plan

**Automated (tester runs):** `cd frontend && npm ci && npm test && npm run build` pass;
`cd backend && npm test` still passes (no backend change). CI frontend job runs both commands.

**Manual end to end in a real browser** against `docker compose up -d db`, `npm run migrate &&
npm run seed`, backend `npm run dev`, frontend `npm run dev` (http://localhost:5173). Run at
desktop width and again at 360 × 740 (devtools device mode) for steps 1–14.

1. Home loads, shows facility hours from the API and "API: ok (database up)"; nav shows guest links.
2. Register with a short password → field error, no request; valid details → signed in as
   customer, nav shows Book / My bookings / Log out. Registering the same email again → 409 message.
3. Log out, log in with a wrong password → "Invalid email or password"; 11 rapid wrong attempts
   → the 429 message. Log in correctly → lands on `/bookings` (or `?next=`).
4. Reload the page: still signed in. Edit `localStorage['parkit.token']` to garbage and navigate
   → logged out, sent to `/login` with "session expired".
5. As customer open `/admin` → redirected to `/bookings`; as guest open `/book` → `/login?next=/book`.
6. Book: today's start list starts at the current half hour; last start is 1 h before closing;
   hours list shrinks near closing; date max = today + max advance days. Grid shows prices that
   match `min(hours × hourly, daily)` (e.g. car 8 h → ₹300.00).
7. Pick a start under 2 h away → no-cancel warning shown. Pick a later start, a specific slot,
   vehicle "dl 3c ab-1234" → preview `DL3CAB1234`; book → detail page with "Booking confirmed",
   `PK-XXXXXX` code, QR image visible, IST times, amount ₹, payment paid.
8. Book the same slot and time again with a different vehicle → that tile is shown booked; force
   a clash with two tabs (both show it free, book in one then the other) → 409 message, grid refreshes.
9. Same vehicle overlapping time → 409 vehicle message. Fourth active booking → 409 "3 active".
10. "Any free slot" → booking created on a slot the server chose; amount shown.
11. My bookings: Active lists them; cancel one (≥ 2 h away) via the dialog → moves to Past as
    Cancelled, refund noted; a booking under 2 h has no Cancel button and shows the note.
12. Detail page of another customer's code (log in as a second customer, open the URL) → "Booking
    not found".
13. Admin (seeded `admin@parkit.local`): nav shows admin links only; `/book` redirects to `/admin`.
    Dashboard shows today's bookings with customer names; summary for Today / Last 7 days shows
    revenue in ₹ with 2 decimals and occupancy %; Next day shows upcoming bookings.
14. Gate: type the code from step 7 in lowercase without the dash → found. For a booking more
    than 15 min away, Check in → "Too early" warning. For one starting now (book a start at the
    current half hour), Check in → success; customer's detail shows Checked in; Check out → Completed.
15. Slots: add `A-05` car ₹40/₹300 → appears; duplicate code → 409 message; edit hourly rate →
    saved, earlier bookings keep their amount; block it → disappears from the customer grid;
    unblock → back; delete a booked slot → "block it instead" message; delete the new unused slot → gone.
16. Settings: set closes_at before opens_at → client error; set 07:00–22:00 → saved; the booking
    page now offers 07:00–21:00 starts. Restore 06:00–23:00.
17. Derived states: with a past `confirmed` booking (create one by setting a start at the current
    half hour with 1 h, then wait, or use psql to move `starts_at`/`ends_at` back), it shows
    Missed in Past and on the dashboard; check in a booking and move its `ends_at` into the past →
    Overstayed badge on dashboard and detail.
18. Quality: keyboard only (Tab / Shift+Tab / Enter / Space / Escape) completes login, booking and
    check-in with a visible focus ring; every input has a label; no horizontal scroll at 360 px;
    no console errors; Lighthouse accessibility score reported (aim ≥ 90).
19. Build check: after `npm run build`, `dist/` holds only static files (no `.env` values, no
    tokens), and asset paths are root-relative so CloudFront can serve them.
20. Stretch (only if T16 done): on a phone or laptop camera in Chrome over localhost, Scan QR
    reads the QR from step 7 and fills the code; in Firefox (no BarcodeDetector) the button is absent.
