# ParkIt

**Cloud-Based Parking Slot Booking and Management System** (UCS531 Cloud Computing project)

ParkIt lets the owner of a private parking facility rent out spare slots. Customers register, check
slot availability for a date and time, see the price, book a slot, and get a QR booking ID. The owner
(admin) manages slots, rates and opening hours, blocks or unblocks slots, checks vehicles in and out,
and sees occupancy and revenue. Payment is simulated in this version.

## Architecture (AWS)

| Layer | Local dev | AWS |
|---|---|---|
| Frontend (React + Vite) | `npm run dev` on :5173 | S3 bucket served through CloudFront (HTTPS) |
| API (Node.js + Express) | `npm run dev` on :4000 | EC2 instance (PM2 behind Nginx) |
| Database (PostgreSQL) | Docker container | Amazon RDS for PostgreSQL |
| QR codes and receipts | `backend/uploads/` | Separate private S3 bucket |
| Notifications (optional) | logged to console | Amazon SNS |

See [docs/architecture.md](docs/architecture.md) for the diagram and request flow.

## Repository layout

```
backend/    Express REST API, SQL migrations, tests
frontend/   React (Vite) single-page app
infra/      AWS deployment scripts and notes (Phase 4)
docs/       Phase plan, architecture, report material
.claude/    Agent pipeline (subagents + /run-phase skill)
```

## Running locally

Requirements: Node.js 20+, Docker.

```bash
# 1. Database
docker compose up -d db

# 2. API
cd backend
cp .env.example .env
npm install
npm run migrate
npm run dev          # http://localhost:4000/api/health

# 3. Frontend (new terminal)
cd frontend
cp .env.example .env
npm install
npm run dev          # http://localhost:5173
```

## Project phases

The work is split into phases; progress is tracked in [docs/PHASES.md](docs/PHASES.md).

| Phase | Focus | Course deliverable |
|---|---|---|
| 0 | Scaffold, tooling, agent pipeline | Source repo with README |
| 1 | Requirements and database design | Project proposal, ER diagram |
| 2 | Backend API with JWT auth | Working implementation |
| 3 | Customer and admin frontend | Working implementation |
| 4 | AWS deployment | Cloud deployment, architecture diagram |
| 5 | Testing, report, presentation | Report (max 5 pages), demo |

## Team

| Name | Roll number |
|---|---|
| _add team members_ | |
