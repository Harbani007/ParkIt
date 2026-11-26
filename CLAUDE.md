# ParkIt: notes for Claude

Cloud-based parking slot booking system for one private facility (UCS531 Cloud Computing project).
Customers book slots and get a QR booking ID; the admin manages slots, rates, check-in/out and
sees occupancy and revenue. Payment is simulated.

## Source of truth
- `docs/PHASES.md`: phase plan and checklist. Read it before starting work; tick items as they land.
- `docs/api.md` (from Phase 1): API contract. Backend and frontend both follow it; change it first.
- `docs/requirements.md` (from Phase 1): user stories and business rules D1-D19. Change it before the API or schema.
- `docs/er-diagram.md`: database schema as built by the migrations.
- `docs/architecture.md`: AWS architecture and cloud specification (security, IAM, cost, deployment, demo).

## Stack
- `backend/`: Node.js 20+, Express 5, ESM, `pg` (no ORM), zod, bcryptjs, jsonwebtoken, vitest + supertest
- `frontend/`: React 19, Vite, react-router-dom 7, plain CSS (no UI framework yet)
- DB: PostgreSQL 16 (Docker locally, RDS on AWS)
- AWS: S3 + CloudFront (frontend), EC2 (API), RDS, S3 (QR/receipts), SNS optional

## Commands
```bash
docker compose up -d db                       # local Postgres
cd backend && npm run migrate && npm run seed # schema + demo data
cd backend && npm run dev | npm test
cd frontend && npm run dev | npm run build
```

## Conventions
- All API routes are under `/api`. Errors are JSON `{ error, details? }` via `HttpError`.
- SQL lives in route/service modules with parameterised queries (`$1`), never string concatenation.
- Schema changes: add a new numbered file in `backend/migrations/`; never edit an applied one.
- Money is `NUMERIC(10,2)` in the DB and a string in JSON responses; times are `TIMESTAMPTZ`, sent as ISO 8601.
- Double booking is prevented by the exclusion constraint on `bookings`; map Postgres error `23P01` to HTTP 409.
- File storage goes through `backend/src/services/storage.js` so local and S3 are interchangeable.
- Every new endpoint gets a test in `backend/test/`.
- No secrets in the repo: `.env` files are git-ignored; update `.env.example` when adding a variable.
- Keep it simple: this is a semester project and a well-finished small feature beats a half-done big one.

## Git authorship (mandatory)
- All commits, pushes and pull requests are authored as GitHub user `Harbani007`
  (`harbani.k1@gmail.com`). The repo's local git config is set to this identity.
- Never add Claude, Anthropic or any AI as author, co-author or collaborator. No
  `Co-Authored-By` trailers, no "Generated with Claude Code" lines in commits, PR titles,
  PR bodies, issues or code comments.

## Agent pipeline
`/run-phase <N>` runs a phase: planner → backend-dev / frontend-dev → tester → reviewer.
Subagents live in `.claude/agents/`. Agents never run AWS commands that create or delete
resources; `aws-deployer` writes scripts and checklists for a human to run.
