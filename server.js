const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const DEFAULT_DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "data", "database.json");
const DEFAULT_PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_COOKIE = "daily_spend_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const TRANSACTION_TYPES = new Set(["expense", "income", "withdrawal", "deposit"]);
const PAYMENT_METHODS = new Set(["cash", "online", "bank"]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function emptyDatabase() {
  return {
    users: [],
    transactions: [],
    sessions: {}
  };
}

function ensureDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(emptyDatabase(), null, 2));
  }
}

function readDatabase(dbPath) {
  ensureDatabase(dbPath);
  const raw = fs.readFileSync(dbPath, "utf8");
  const parsed = raw.trim() ? JSON.parse(raw) : emptyDatabase();
  return {
    users: Array.isArray(parsed.users) ? parsed.users.map(normalizeUserRecord) : [],
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {}
  };
}

function writeDatabase(dbPath, db) {
  const tmpPath = `${dbPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2));
  fs.renameSync(tmpPath, dbPath);
}

function cleanupSessions(db) {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [token, session] of Object.entries(db.sessions)) {
    const createdAt = Date.parse(session.createdAt || "");
    if (!session.userId || Number.isNaN(createdAt) || createdAt < cutoff) {
      delete db.sessions[token];
    }
  }
}

function parseCookies(header) {
  const cookies = {};
  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) {
      continue;
    }
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  return parts.join("; ");
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function sendNoContent(res, headers = {}) {
  res.writeHead(204, headers);
  res.end();
}

function normalizeDisplayName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function normalizeUserRecord(user) {
  return {
    ...user,
    openingCash: roundMoney(user.openingCash),
    openingBank: roundMoney(user.openingBank)
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    createdAt: user.createdAt,
    openingCash: roundMoney(user.openingCash),
    openingBank: roundMoney(user.openingBank)
  };
}

function getActiveUser(req, db) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token || !db.sessions[token]) {
    return { user: null, token: null };
  }

  const session = db.sessions[token];
  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) {
    delete db.sessions[token];
    return { user: null, token: null };
  }

  session.lastSeenAt = nowIso();
  return { user, token };
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function parseDateInput(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }

  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return raw;
}

function cleanText(value, fallback, maxLength) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
  return cleaned || fallback;
}

function validateBalanceAmount(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) {
    throw new Error(`Enter a valid ${label} amount`);
  }
  return roundMoney(amount);
}

function validateTransaction(input) {
  const type = String(input.type || "").trim().toLowerCase();
  if (!TRANSACTION_TYPES.has(type)) {
    throw new Error("Choose a valid transaction type");
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) {
    throw new Error("Enter a valid amount greater than zero");
  }

  const date = parseDateInput(input.date);
  if (!date) {
    throw new Error("Choose a valid date");
  }

  const paymentMethod = String(input.paymentMethod || "").trim().toLowerCase();
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new Error("Choose a valid payment method");
  }

  const fallbackCategory = type === "withdrawal" || type === "deposit" ? "Transfer" : "General";

  return {
    date,
    type,
    amount: Math.round(amount * 100) / 100,
    category: cleanText(input.category, fallbackCategory, 50),
    paymentMethod,
    note: cleanText(input.note, "", 200)
  };
}

function transactionImpact(transaction) {
  const amount = Number(transaction.amount) || 0;
  const method = transaction.paymentMethod;
  const impact = { cash: 0, bank: 0 };

  if (transaction.type === "expense") {
    if (method === "cash") {
      impact.cash -= amount;
    } else {
      impact.bank -= amount;
    }
  }

  if (transaction.type === "income") {
    if (method === "cash") {
      impact.cash += amount;
    } else {
      impact.bank += amount;
    }
  }

  if (transaction.type === "withdrawal") {
    impact.cash += amount;
    impact.bank -= amount;
  }

  if (transaction.type === "deposit") {
    impact.cash -= amount;
    impact.bank += amount;
  }

  return impact;
}

function isWithinRange(transaction, filters) {
  if (filters.from && transaction.date < filters.from) {
    return false;
  }
  if (filters.to && transaction.date > filters.to) {
    return false;
  }
  if (filters.type && filters.type !== "all" && transaction.type !== filters.type) {
    return false;
  }
  if (
    filters.paymentMethod &&
    filters.paymentMethod !== "all" &&
    transaction.paymentMethod !== filters.paymentMethod
  ) {
    return false;
  }
  if (filters.query) {
    const haystack = `${transaction.category} ${transaction.note} ${transaction.type} ${transaction.paymentMethod}`.toLowerCase();
    if (!haystack.includes(filters.query.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function filtersFromUrl(url) {
  const month = url.searchParams.get("month");
  const filters = {
    from: url.searchParams.get("from") || "",
    to: url.searchParams.get("to") || "",
    type: url.searchParams.get("type") || "all",
    paymentMethod: url.searchParams.get("paymentMethod") || "all",
    query: url.searchParams.get("q") || ""
  };

  if (/^\d{4}-\d{2}$/.test(month || "")) {
    filters.from = `${month}-01`;
    const [year, monthIndex] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
    filters.to = `${month}-${String(lastDay).padStart(2, "0")}`;
  }

  return filters;
}

function sortTransactions(transactions) {
  return [...transactions].sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

function addAmount(bucket, key, amount) {
  bucket[key] = Math.round(((bucket[key] || 0) + amount) * 100) / 100;
}

function summarizeTransactions(transactions) {
  const totals = {
    spending: 0,
    income: 0,
    withdrawn: 0,
    deposited: 0,
    cashBalance: 0,
    bankBalance: 0,
    net: 0
  };
  const byCategory = {};
  const byPaymentMethod = {};
  const byType = {};

  for (const transaction of transactions) {
    const amount = Number(transaction.amount) || 0;
    const impact = transactionImpact(transaction);

    totals.cashBalance += impact.cash;
    totals.bankBalance += impact.bank;

    if (transaction.type === "expense") {
      totals.spending += amount;
      addAmount(byCategory, transaction.category, amount);
      addAmount(byPaymentMethod, transaction.paymentMethod, amount);
    }
    if (transaction.type === "income") {
      totals.income += amount;
    }
    if (transaction.type === "withdrawal") {
      totals.withdrawn += amount;
    }
    if (transaction.type === "deposit") {
      totals.deposited += amount;
    }

    addAmount(byType, transaction.type, amount);
  }

  totals.cashBalance = Math.round(totals.cashBalance * 100) / 100;
  totals.bankBalance = Math.round(totals.bankBalance * 100) / 100;
  totals.spending = Math.round(totals.spending * 100) / 100;
  totals.income = Math.round(totals.income * 100) / 100;
  totals.withdrawn = Math.round(totals.withdrawn * 100) / 100;
  totals.deposited = Math.round(totals.deposited * 100) / 100;
  totals.net = Math.round((totals.income - totals.spending) * 100) / 100;

  return {
    totals,
    byCategory,
    byPaymentMethod,
    byType,
    recent: sortTransactions(transactions).slice(0, 5)
  };
}

function summarizeBalances(user, transactions) {
  const movement = summarizeTransactions(transactions).totals;
  const cashInHand = roundMoney(roundMoney(user.openingCash) + movement.cashBalance);
  const bankAccount = roundMoney(roundMoney(user.openingBank) + movement.bankBalance);

  return {
    openingCash: roundMoney(user.openingCash),
    openingBank: roundMoney(user.openingBank),
    cashInHand,
    bankAccount,
    totalAvailable: roundMoney(cashInHand + bankAccount),
    cashMovement: movement.cashBalance,
    bankMovement: movement.bankBalance
  };
}

function extractTransactionId(pathname) {
  const match = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function requireUser(req, res, db) {
  const { user, token } = getActiveUser(req, db);
  if (!user) {
    sendJson(res, 401, { error: "Login required" });
    return null;
  }
  return { user, token };
}

async function handleApi(req, res, url, dbPath) {
  const db = readDatabase(dbPath);
  cleanupSessions(db);

  if (req.method === "GET" && url.pathname === "/api/users") {
    writeDatabase(dbPath, db);
    sendJson(res, 200, { users: db.users.map(publicUser).sort((a, b) => a.name.localeCompare(b.name)) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const input = await readRequestJson(req);
    const name = normalizeDisplayName(input.name);
    if (!name) {
      sendJson(res, 400, { error: "Enter an account name" });
      return;
    }

    let user = db.users.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!user) {
      user = {
        id: createId("usr"),
        name,
        openingCash: 0,
        openingBank: 0,
        createdAt: nowIso()
      };
      db.users.push(user);
    }

    const token = createId("sess");
    db.sessions[token] = {
      userId: user.id,
      createdAt: nowIso(),
      lastSeenAt: nowIso()
    };
    writeDatabase(dbPath, db);
    sendJson(res, 200, { user: publicUser(user) }, { "Set-Cookie": buildCookie(SESSION_COOKIE, token) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const cookies = parseCookies(req.headers.cookie || "");
    if (cookies[SESSION_COOKIE]) {
      delete db.sessions[cookies[SESSION_COOKIE]];
    }
    writeDatabase(dbPath, db);
    sendNoContent(res, { "Set-Cookie": buildCookie(SESSION_COOKIE, "", { maxAge: 0 }) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const active = getActiveUser(req, db);
    writeDatabase(dbPath, db);
    sendJson(res, 200, {
      authenticated: Boolean(active.user),
      user: active.user ? publicUser(active.user) : null
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/profile") {
    const active = requireUser(req, res, db);
    if (!active) {
      return;
    }
    const userTransactions = db.transactions.filter((transaction) => transaction.userId === active.user.id);
    writeDatabase(dbPath, db);
    sendJson(res, 200, {
      user: publicUser(active.user),
      balances: summarizeBalances(active.user, userTransactions)
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/profile") {
    const active = requireUser(req, res, db);
    if (!active) {
      return;
    }
    const input = await readRequestJson(req);
    active.user.openingCash = validateBalanceAmount(input.openingCash, "cash in hand");
    active.user.openingBank = validateBalanceAmount(input.openingBank, "bank account");
    active.user.updatedAt = nowIso();
    const userTransactions = db.transactions.filter((transaction) => transaction.userId === active.user.id);
    writeDatabase(dbPath, db);
    sendJson(res, 200, {
      user: publicUser(active.user),
      balances: summarizeBalances(active.user, userTransactions)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/transactions") {
    const active = requireUser(req, res, db);
    if (!active) {
      return;
    }
    const filters = filtersFromUrl(url);
    const transactions = sortTransactions(
      db.transactions.filter((transaction) => transaction.userId === active.user.id && isWithinRange(transaction, filters))
    );
    writeDatabase(dbPath, db);
    sendJson(res, 200, { transactions });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/transactions") {
    const active = requireUser(req, res, db);
    if (!active) {
      return;
    }
    const input = await readRequestJson(req);
    const cleaned = validateTransaction(input);
    const createdAt = nowIso();
    const transaction = {
      id: createId("txn"),
      userId: active.user.id,
      ...cleaned,
      createdAt,
      updatedAt: createdAt
    };
    db.transactions.push(transaction);
    writeDatabase(dbPath, db);
    sendJson(res, 201, { transaction });
    return;
  }

  const transactionId = extractTransactionId(url.pathname);
  if (transactionId && req.method === "PUT") {
    const active = requireUser(req, res, db);
    if (!active) {
      return;
    }
    const index = db.transactions.findIndex(
      (transaction) => transaction.id === transactionId && transaction.userId === active.user.id
    );
    if (index === -1) {
      sendJson(res, 404, { error: "Transaction not found" });
      return;
    }

    const input = await readRequestJson(req);
    const cleaned = validateTransaction(input);
    const updated = {
      ...db.transactions[index],
      ...cleaned,
      updatedAt: nowIso()
    };
    db.transactions[index] = updated;
    writeDatabase(dbPath, db);
    sendJson(res, 200, { transaction: updated });
    return;
  }

  if (transactionId && req.method === "DELETE") {
    const active = requireUser(req, res, db);
    if (!active) {
      return;
    }
    const originalLength = db.transactions.length;
    db.transactions = db.transactions.filter(
      (transaction) => !(transaction.id === transactionId && transaction.userId === active.user.id)
    );
    if (db.transactions.length === originalLength) {
      sendJson(res, 404, { error: "Transaction not found" });
      return;
    }
    writeDatabase(dbPath, db);
    sendNoContent(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/summary") {
    const active = requireUser(req, res, db);
    if (!active) {
      return;
    }
    const filters = filtersFromUrl(url);
    const userTransactions = db.transactions.filter((transaction) => transaction.userId === active.user.id);
    const transactions = userTransactions.filter((transaction) => isWithinRange(transaction, filters));
    const summary = summarizeTransactions(transactions);
    summary.balances = summarizeBalances(active.user, userTransactions);
    writeDatabase(dbPath, db);
    sendJson(res, 200, { summary });
    return;
  }

  writeDatabase(dbPath, db);
  sendJson(res, 404, { error: "API route not found" });
}

function sendStatic(req, res, url, publicDir) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    sendJson(res, 400, { error: "Invalid path" });
    return;
  }

  const requestPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const publicRoot = path.resolve(publicDir);
  const filePath = path.resolve(publicRoot, requestPath);

  if (!filePath.startsWith(publicRoot)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (pathname !== "/") {
        const fallback = path.join(publicRoot, "index.html");
        fs.readFile(fallback, (fallbackError, fallbackContent) => {
          if (fallbackError) {
            sendJson(res, 404, { error: "File not found" });
            return;
          }
          res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
          res.end(fallbackContent);
        });
        return;
      }
      sendJson(res, 404, { error: "File not found" });
      return;
    }

    const extension = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    res.end(content);
  });
}

function createServer(options = {}) {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const publicDir = options.publicDir || DEFAULT_PUBLIC_DIR;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    // Global CORS handling
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Set-Cookie");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url, dbPath);
        return;
      }
      sendStatic(req, res, url, publicDir);
    } catch (error) {
      const status = error.message === "Invalid JSON body" || error.message === "Request body is too large" ? 400 : 500;
      sendJson(res, status, { error: error.message || "Server error" });
    }
  });
}

function getLanAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const details of interfaces || []) {
      if (details.family === "IPv4" && !details.internal) {
        addresses.push(details.address);
      }
    }
  }
  return addresses;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  const server = createServer();

  server.listen(port, host, () => {
    console.log(`Daily Spend Manager running at http://localhost:${port}`);
    for (const address of getLanAddresses()) {
      console.log(`Same Wi-Fi: http://${address}:${port}`);
    }
  });
}

module.exports = {
  createServer,
  summarizeTransactions,
  summarizeBalances,
  transactionImpact
};
