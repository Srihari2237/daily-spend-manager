# Review

## Verification

- `node --check server.js` passed.
- `node --check tests/api.test.js` passed.
- `npm.cmd test` passed.
- `GET http://localhost:3000/` returned `200` and included sidebar section links.
- `GET http://localhost:3000/api/session` returned `200`.

## Changes Reviewed

- Added per-account saved starting balances: `openingCash` and `openingBank`.
- Added `GET /api/profile` and `PUT /api/profile`.
- Added all-time balance calculation to `/api/summary`.
- Added sidebar navigation links for Dashboard, Balances, Add Entry, History, and Breakdowns.
- Added a Balances section for entering starting cash and bank balance.
- Updated summary cards to show actual cash in hand, bank account, and total available.

## Limitations

- The configured Gemini/Claude CCG wrapper is unavailable because `~/.claude/bin/codeagent-wrapper` does not exist in this environment.
- Browser visual automation is unavailable in this session because the required Node REPL browser execution tool is not exposed.
- The workspace is not a Git repository, so `git diff` and the required archive commit cannot be performed.
