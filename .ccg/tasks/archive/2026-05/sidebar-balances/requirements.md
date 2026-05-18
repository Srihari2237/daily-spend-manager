# Requirements

## User Request

- Add sidebar navigation for the different sections of the app.
- Show how much money the user has in their bank account and as cash in hand.

## Interpretation

- Add explicit sidebar links for Dashboard, Add Entry, History, Breakdown, and Balances.
- Add saved starting/current balance fields per account:
  - Cash in hand
  - Bank account balance
- Use those saved balances plus all transactions to show actual current cash and bank totals.
- Keep monthly filters for spending/income/history, but current cash and bank holdings should not be limited to the selected month.

## Constraints

- No password system yet.
- Existing data must keep working.
- No external packages.
- The configured Gemini/Claude CCG wrapper is unavailable in this environment.
