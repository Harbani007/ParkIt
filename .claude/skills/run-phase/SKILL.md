---
name: run-phase
description: Run one ParkIt project phase end to end through the agent pipeline (plan, implement, test, review). Use when the user says "run phase N", "start phase N", or "/run-phase N".
argument-hint: <phase number>
---

# Run a ParkIt phase

Phase to run: `$ARGUMENTS` (if empty, use the first phase in `docs/PHASES.md` with unchecked items).

## 1. Prepare
- Read `docs/PHASES.md` for this phase. If every item is checked, say so and stop.
- Make sure the working tree is clean, then create a branch from `main`:
  `git switch main && git pull && git switch -c phase-<N>/<short-slug>`.

## 2. Plan
- Run the `planner` subagent for phase N.
- Show the user the plan summary and the path to `docs/phases/phase-<N>.md`.
- **Stop and wait for the user to approve or edit the plan.**

## 3. Implement
- Go through the plan's tasks in dependency order.
- Tasks in the same parallel group that belong to different owners (for example `backend-dev`
  and `frontend-dev`) run as subagents at the same time; tasks touching the same files never do.
- Phase 4 tasks go to `aws-deployer`. Doc-only tasks you can do yourself.
- After each agent returns, check its report. If it left something undone, run it again with
  the specific gap, at most twice, then raise it with the user.
- Commit after each completed group with a message naming the tasks. Commits are authored as
  Harbani007 with no AI co-author trailer or attribution line (see `CLAUDE.md`).

## 4. Test
- Run the `tester` subagent. For each failure, send it to the owning dev agent with the
  reproduction steps, then re-run the tester. Stop after three rounds and report what still fails.

## 5. Review
- Run the `reviewer` subagent. Fix blocking issues through the dev agents; re-run tests after.

## 6. Close out
- Tick the finished items in `docs/PHASES.md` and commit.
- Push the branch and open a pull request to `main` describing what the phase delivered, test
  evidence, and anything deferred. Ask before pushing if the user has not said to.
- Tell the user what is done, what is not, and what the next phase is.
