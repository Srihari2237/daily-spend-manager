const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createServer } = require("../server");

function createClient(baseUrl) {
  let cookie = "";

  return {
    async request(route, options = {}) {
      const headers = {
        ...(options.headers || {})
      };

      let body = options.body;
      if (body && typeof body !== "string") {
        body = JSON.stringify(body);
        headers["Content-Type"] = "application/json";
      }
      if (cookie) {
        headers.Cookie = cookie;
      }

      const response = await fetch(`${baseUrl}${route}`, {
        method: options.method || "GET",
        headers,
        body
      });

      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        cookie = setCookie.split(";")[0];
      }

      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      return payload;
    }
  };
}

async function startTestServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-spend-manager-"));
  const dbPath = path.join(tempDir, "database.json");
  const server = createServer({ dbPath, publicDir: path.join(__dirname, "..", "public") });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    server,
    tempDir,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function main() {
  const { server, tempDir, baseUrl } = await startTestServer();
  const alice = createClient(baseUrl);
  const bob = createClient(baseUrl);

  try {
    const anonymousSession = await alice.request("/api/session");
    assert.equal(anonymousSession.authenticated, false);

    const login = await alice.request("/api/login", {
      method: "POST",
      body: { name: "Alice" }
    });
    assert.equal(login.user.name, "Alice");

    const emptyProfile = await alice.request("/api/profile");
    assert.equal(emptyProfile.balances.cashInHand, 0);
    assert.equal(emptyProfile.balances.bankAccount, 0);

    const savedProfile = await alice.request("/api/profile", {
      method: "PUT",
      body: {
        openingCash: 500,
        openingBank: 1500
      }
    });
    assert.equal(savedProfile.balances.cashInHand, 500);
    assert.equal(savedProfile.balances.bankAccount, 1500);

    const expense = await alice.request("/api/transactions", {
      method: "POST",
      body: {
        date: "2026-05-18",
        type: "expense",
        amount: 120,
        paymentMethod: "cash",
        category: "Food",
        note: "Lunch"
      }
    });

    await alice.request("/api/transactions", {
      method: "POST",
      body: {
        date: "2026-05-18",
        type: "income",
        amount: 1000,
        paymentMethod: "online",
        category: "Work",
        note: "Project"
      }
    });

    await alice.request("/api/transactions", {
      method: "POST",
      body: {
        date: "2026-05-18",
        type: "withdrawal",
        amount: 200,
        paymentMethod: "bank",
        category: "Transfer",
        note: "ATM"
      }
    });

    const summary = await alice.request("/api/summary?month=2026-05");
    assert.equal(summary.summary.totals.spending, 120);
    assert.equal(summary.summary.totals.income, 1000);
    assert.equal(summary.summary.totals.withdrawn, 200);
    assert.equal(summary.summary.totals.cashBalance, 80);
    assert.equal(summary.summary.totals.bankBalance, 800);
    assert.equal(summary.summary.balances.cashInHand, 580);
    assert.equal(summary.summary.balances.bankAccount, 2300);
    assert.equal(summary.summary.balances.totalAvailable, 2880);

    const updated = await alice.request(`/api/transactions/${expense.transaction.id}`, {
      method: "PUT",
      body: {
        date: "2026-05-18",
        type: "expense",
        amount: 150,
        paymentMethod: "cash",
        category: "Food",
        note: "Lunch and tea"
      }
    });
    assert.equal(updated.transaction.amount, 150);

    await alice.request(`/api/transactions/${expense.transaction.id}`, { method: "DELETE" });
    const afterDelete = await alice.request("/api/transactions?month=2026-05");
    assert.equal(afterDelete.transactions.length, 2);

    await bob.request("/api/login", {
      method: "POST",
      body: { name: "Bob" }
    });
    const bobTransactions = await bob.request("/api/transactions?month=2026-05");
    assert.equal(bobTransactions.transactions.length, 0);

    const staticPage = await fetch(`${baseUrl}/`);
    assert.equal(staticPage.status, 200);
    assert.match(await staticPage.text(), /Daily Spend Manager/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log("API tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
