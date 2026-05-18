# Daily Spend Manager

A responsive web app for tracking daily spending, income, cash withdrawals, and bank deposits across desktop and phone.

The dashboard shows current cash in hand and bank account balance. Set your starting cash and bank balance in the Balances section, then entries will update those totals.

## Run

```bash
npm start
```

Open `http://localhost:3000` on the computer running the app.

For phone access, keep the phone on the same Wi-Fi network and open the `Same Wi-Fi` URL printed by the server.

## Test

```bash
npm test
```

## Data

The app stores accounts, sessions, and transactions in `data/database.json`.

Login is passwordless. Anyone who can reach the running server can open or create an account by name, so deploy it only somewhere you trust unless proper authentication is added later.
