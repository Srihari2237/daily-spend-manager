# Daily Spend Manager Requirements

## Goal

Build a responsive web app for tracking daily money activity from both desktop and phone. The app is for two people who each need a separate account.

## Users

- Primary user
- Friend

## Login

- No password required.
- A user can create or select an account by entering a display name.
- Each account has separate transaction data.
- This is convenience login, not strong security.

## Core Data Fields

A transaction should store:

- Date
- Type: expense, income, withdrawal, deposit
- Amount
- Category
- Payment method: cash, online, bank
- Description or note
- User/account owner
- Created and updated timestamps

## Main Screens

- Login/account picker
- Dashboard summary
- Add/edit transaction
- Transaction history with filters
- Category and payment-method breakdown

## Persistence

- Store data on the backend in a JSON database file.
- Desktop and phone can retrieve the same data when they connect to the same running server.
- Later deployment can put the same app on a hosted server for internet-wide sync.

## Chosen Stack

- Backend: Node.js built-in HTTP server, file-system JSON persistence
- Frontend: responsive vanilla HTML, CSS, and JavaScript
- No external packages, so the app can run without package installation

## External Model Collaboration

The configured CCG wrapper for Gemini/Claude is not available in this environment (`~/.claude/bin/codeagent-wrapper` is missing). Frontend and backend work will be implemented locally by Codex in this session.

