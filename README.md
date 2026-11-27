# ParkIt

**Cloud-Based Parking Slot Booking and Management System** (UCS531 Cloud Computing project)

ParkIt is a marketplace for private parking in Delhi NCR. A home owner whose driveway sits empty
while they are at the office lists it as a **host**: house address, locality, the hours it is free
and the price. A driver heading to that area (say from Noida to Lajpat Nagar) searches by locality,
books a spot by the hour and gets a QR booking code; the exact address is shown only after booking.
Each host manages their own spaces (check-in at the gate, spots, hours, earnings), and the platform
admin can manage every space. Payment is simulated in this version.

## Features

- **Marketplace:** any user can list a space and becomes its host; drivers search spaces by
  locality; the house address stays private until a booking is made.
- **Hosts:** a dashboard per space with earnings, occupancy and bookings; gate check-in and
  check-out; spots and rates; hours and listing details.
- **Customers:** register and log in; book in three steps (date, time and vehicle type → slot grid
  with prices, or "any free slot" → simulated payment); QR code and booking code; my bookings with
  cancellation up to 2 hours before the start.
- **Admin:** dashboard with revenue, occupancy and booking counts; slot management (rates, block,
  unblock); opening hours; gate page to check cars in and out by booking code.
- **No double booking:** PostgreSQL exclusion constraints refuse overlapping bookings for the same
  slot or vehicle, even when two requests arrive at the same moment.
- **"Any free slot"** assigns the least-used free slot of the last 30 days, spreading use evenly.
- **Booking emails** (optional): Amazon SNS emails each customer when a booking is confirmed or
  cancelled, using a filter policy so customers only receive their own bookings.

## Architecture (AWS)

The demo runs in the **AWS Academy Cloud Foundations Sandbox** (us-east-1). One **CloudFormation**
template builds everything:

| Layer | Local development | AWS (sandbox) |
|---|---|---|
| Website (React + Vite) | Vite dev server on :5173 | Nginx on **EC2** serves the built site |
| API (Node.js + Express) | `npm run dev` on :4000 | Node.js on the same **EC2** (systemd), behind Nginx |
| Database (PostgreSQL) | Docker container | **Amazon RDS for PostgreSQL** (private, backups on) |
| QR code images | `backend/uploads/` | Private **Amazon S3** bucket, pre-signed links |
| Booking emails | off | **Amazon SNS** topic (optional, `BookingEmails = yes`) |
| Infrastructure | `docker compose` | **AWS CloudFormation** (`infra/parkit-sandbox.yaml`) |
| Permissions | none | IAM role through `LabInstanceProfile` (no access keys) |

Diagram, request flow and the fuller production design (CloudFront, HTTPS, SSM, CloudWatch, SNS):
[docs/architecture.md](docs/architecture.md).

## Deploying to AWS

Follow [infra/SANDBOX-DEPLOY.md](infra/SANDBOX-DEPLOY.md). In short:

1. Start the AWS Academy sandbox and open the console (us-east-1).
2. CloudFormation → Create stack → upload `infra/parkit-sandbox.yaml`.
3. Type a database password and an admin password (and choose whether to send booking emails),
   then create the stack.
4. After about 15 minutes, open the `WebsiteURL` output.

The sandbox deletes everything when the session ends, so the stack is created again before each demo.

## Repository layout

```
backend/    Express REST API, SQL migrations, tests (Vitest + Supertest)
frontend/   React (Vite) single-page app, tests (Vitest + Testing Library)
infra/      CloudFormation template and deployment guides
docs/       Requirements, API contract, ER diagram, architecture, phase plans, viva notes
```

Key documents: [requirements](docs/requirements.md), [API contract](docs/api.md),
[ER diagram](docs/er-diagram.md), [phase plan](docs/PHASES.md).

## Running locally

Requirements: Node.js 22, Docker.

```bash
# 1. Database (PostgreSQL 16 on localhost:5433)
docker compose up -d db

# 2. API
cd backend
cp .env.example .env
npm install
npm run migrate
npm run seed         # one facility, four slots, admin@parkit.local / admin12345 (development only)
npm run dev          # http://localhost:4000/api/health

# 3. Frontend (new terminal)
cd frontend
cp .env.example .env
npm install
npm run dev          # http://localhost:5173
```

## Tests

```bash
cd backend && npm test     # about 210 tests against a real PostgreSQL database
cd frontend && npm test    # about 90 tests
```

GitHub Actions runs both suites, plus the frontend build, on every push and pull request.

## Project phases

Progress is tracked in [docs/PHASES.md](docs/PHASES.md).

| Phase | Focus | Course deliverable |
|---|---|---|
| 0 | Scaffold and tooling | Source repo with README |
| 1 | Requirements and database design | Project proposal, ER diagram |
| 2 | Backend API with JWT auth | Working implementation |
| 3 | Customer and admin frontend | Working implementation |
| 4 | AWS deployment | Cloud deployment, architecture diagram |
| 5 | Testing, report, presentation | Report (max 5 pages), demo |

## Team

| Name | Roll number |
|---|---|
| Harbani Kaur | 1024030848 |
