# Implementation Plan

## Phase 1: App Skeleton

- Create `package.json` with scripts.
- Create `server.js` for HTTP routing, static file serving, API routes, session cookies, and JSON persistence.
- Create `data/database.json` seed file.
- Create `public/` assets for frontend.

## Phase 2: Backend/API

- `POST /api/login`: create or select user by display name.
- `POST /api/logout`: clear session.
- `GET /api/session`: return active user.
- `GET /api/transactions`: list current user's transactions.
- `POST /api/transactions`: create transaction.
- `PUT /api/transactions/:id`: update current user's transaction.
- `DELETE /api/transactions/:id`: delete current user's transaction.
- `GET /api/summary`: return totals, breakdowns, and recent transactions.

## Phase 3: Frontend

- Build passwordless login view.
- Build dashboard with balance, spending, income, cash, online, bank totals.
- Build responsive add/edit transaction form.
- Build transaction table/list with filters.
- Build simple breakdown views.

## Phase 4: Verification

- Add a small Node test script for API behavior.
- Run test script.
- Start local server and report the URL.

## Phase 5: Closure

- Update CCG review notes.
- Archive task directory if possible.
- Since the workspace is not a Git repository, skip the required archive commit and report that limitation.
