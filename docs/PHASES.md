# ParkIt phase plan

Each phase ends with a working, committed state on its own branch (`phase-N/<slug>`) merged into
`main`. The `/run-phase` skill in `.claude/skills/` drives a phase through the agent pipeline; this
file is the single source of truth for what is done. Tick boxes as work lands.

---

## Phase 0: Scaffold
Goal: a repo anyone on the team can clone and run in minutes.

- [x] Monorepo layout: `backend/`, `frontend/`, `infra/`, `docs/`
- [x] Express API with `/api/health`, error handling, config from env
- [x] Migration runner and draft schema (`backend/migrations/001_initial_schema.sql`)
- [x] Seed script (one facility, four slots, dev admin)
- [x] React + Vite shell with routes and API client, dev proxy to `/api`
- [x] Local Postgres via `docker compose`
- [x] CI: backend tests and frontend build on every push
- [x] Agent pipeline: subagents in `.claude/agents/`, `/run-phase` skill

**Done when:** `docker compose up -d db`, `npm run migrate`, `npm run dev` in both apps shows
"API: ok (database up)" on the home page.

---

## Phase 1: Requirements and database design
Deliverable: project proposal (problem statement, objectives), ER diagram.

- [x] `docs/requirements.md`: user stories for customer and admin, with acceptance criteria
- [x] Pricing rules written down: hourly vs daily rate, rounding, minimum duration
- [x] Booking rules: bookable window (opening hours), max advance days, cancellation policy
- [x] Review and finalise the schema; new changes go in `002_*.sql`, never edit `001`
- [x] ER diagram in `docs/er-diagram.md` (Mermaid)
- [x] API contract in `docs/api.md`: every endpoint, request, response, error codes

**Done when:** requirements, pricing rules and API contract are agreed by the team, and the schema
migrates cleanly on an empty database.

---

## Phase 2: Backend API with JWT authentication
Deliverable: working implementation (server side).

- [x] Auth: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`; bcrypt + JWT
- [x] Middleware: `requireAuth`, `requireRole('admin')`, zod request validation
- [x] Slots: list, availability with price for a date and time range (D16: no separate quote endpoint)
- [x] Bookings: create (simulated payment row), list mine, get one, cancel
- [x] Double booking prevented by the DB exclusion constraint; API maps it to 409
- [x] QR code generation (`qrcode` package) stored through the storage adapter, local driver
- [x] Admin: CRUD slots, set rates and opening hours, block/unblock, list bookings by day
- [x] Admin: check-in and check-out by booking code; occupancy and revenue summary
- [x] Slot auto-assignment: "any free slot" picks the least-used free slot (D18)
- [x] Integration tests against a real Postgres (CI service container)
- [ ] Early cloud milestone: smoke deploy so `/api/health` answers through CloudFront → EC2 → RDS
      (proves the AWS path long before the final demo; steps in `docs/architecture.md` §8)

**Done when:** every endpoint in `docs/api.md` is implemented and covered by a test, and CI is green.

---

## Phase 3: Customer and admin frontend
Deliverable: working implementation (client side).

- [x] Auth pages, token storage, protected routes, role-based nav
- [x] Booking flow: pick date and duration, see free slots and price, confirm, show QR
- [x] My bookings: active and past, cancel
- [x] Admin dashboard: today's and upcoming bookings, occupancy and revenue cards
- [x] Admin slot management: create/edit, rates, block/unblock, opening hours
- [x] Admin check-in/check-out by booking code (typed; scanning the QR with a camera is a stretch goal)
- [ ] Works at phone width (built responsive; still to check every page at 360 px in a browser)

**Done when:** a customer can book end to end and an admin can check that booking in and out,
all through the UI.

---

## Phase 4: AWS deployment
Deliverable: cloud deployment with demonstration, system architecture diagram.

The project is demonstrated in the **AWS Academy Cloud Foundations Sandbox** (us-east-1, wiped
after every 3-hour session, no IAM role creation). So the demo deployment is one CloudFormation
template that rebuilds everything in about 15 minutes. The fuller production design below stays
documented in `docs/architecture.md` as the next step.

### Sandbox deployment (what we demo)
- [x] S3 storage driver for QR images with pre-signed URLs; credentials from the EC2 instance role
- [x] CloudFormation template `infra/parkit-sandbox.yaml`: security groups, RDS PostgreSQL (private,
      single-AZ, backups on), private encrypted S3 bucket, EC2 with `LabInstanceProfile` that installs
      and starts the app (Nginx + Node.js under systemd) and signals CloudFormation when healthy
- [x] Beginner guide `infra/SANDBOX-DEPLOY.md` and viva notes `docs/viva-notes.md`
- [ ] Stack created in the sandbox and a booking made through the website URL (needs a human run)
- [ ] Screenshots for the report: stack resources and outputs, EC2, RDS, S3 object, website

### Production design (documented, not deployed in the sandbox)
- [ ] RDS PostgreSQL (free tier, `db.t3.micro` or `db.t4g.micro`), automated backups on, not public
- [ ] EC2 (free tier) running the API with PM2 behind Nginx; security group allows 80 from CloudFront only and 22 from the team's IP
- [ ] S3 bucket for the frontend build, served by CloudFront with Origin Access Control
- [ ] CloudFront second origin: `/api/*` forwarded to EC2, so the whole app is HTTPS on one domain
      (avoids mixed-content errors from an HTTPS page calling an HTTP API)
- [ ] Private S3 bucket for QR codes and receipts; S3 storage driver with pre-signed URLs;
      EC2 instance role grants access (no access keys on the server)
- [ ] Secrets in SSM Parameter Store, loaded at start-up (no `.env` on the server)
- [ ] Verified TLS to RDS: `pool.js` uses the AWS RDS CA bundle (`global-bundle.pem`) instead of
      `rejectUnauthorized: false`
- [ ] S3 lifecycle rule expiring QR files of finished bookings
- [ ] CloudWatch dashboard (EC2 CPU, RDS connections, CloudFront 5xx) and alarms, with screenshots
      for the report
- [ ] Optional: SNS topic for booking confirmation notifications
- [ ] Deploy scripts in `infra/` and a GitHub Actions deploy workflow
- [ ] Billing alarm set before anything else is created
- [ ] Final architecture diagram in `docs/architecture.md`

**Done when:** the CloudFront URL serves the app and a booking made there is stored in RDS with
its QR code in S3.

---

## Phase 5: Testing, report and presentation
Deliverables: project report (max 5 pages), final presentation and live demo.

- [ ] Manual test pass of every user story on the deployed app; fix what breaks
- [ ] Seed realistic demo data on AWS
- [ ] Report (max 5 pages): problem, objectives, architecture, cloud services and why, results,
      screenshots, future scope
- [ ] Slide deck and a rehearsed demo script with a fallback recording
- [ ] README final pass: live URL, screenshots, team table
