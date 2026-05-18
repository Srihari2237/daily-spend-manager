const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { MongoClient, ObjectId } = require("mongodb");

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/daily-spend";
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

let client;
let db;

async function connectToDatabase() {
  if (db) return db;
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db();
  console.log("Connected to MongoDB");
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
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
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    createdAt: user.createdAt,
    openingCash: roundMoney(user.openingCash),
    openingBank: roundMoney(user.openingBank)
  };
}

async function getActiveUser(req, dbInstance) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return { user: null, token: null };

  const session = await dbInstance.collection("sessions").findOne({ token });
  if (!session || new Date(session.createdAt).getTime() < Date.now() - SESSION_TTL_MS) {
    if (session) await dbInstance.collection("sessions").deleteOne({ token });
    return { user: null, token: null };
  }

  const user = await dbInstance.collection("users").findOne({ _id: session.userId });
  if (!user) {
    await dbInstance.collection("sessions").deleteOne({ token });
    return { user: null, token: null };
  }

  await dbInstance.collection("sessions").updateOne({ token }, { $set: { lastSeenAt: nowIso() } });
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
      try { resolve(JSON.parse(body)); } catch (e) { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function parseDateInput(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : raw;
}

function cleanText(value, fallback, maxLength) {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
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
  if (!TRANSACTION_TYPES.has(type)) throw new Error("Choose a valid transaction type");

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) {
    throw new Error("Enter a valid amount greater than zero");
  }

  const date = parseDateInput(input.date);
  if (!date) throw new Error("Choose a valid date");

  const paymentMethod = String(input.paymentMethod || "").trim().toLowerCase();
  if (!PAYMENT_METHODS.has(paymentMethod)) throw new Error("Choose a valid payment method");

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
    if (method === "cash") impact.cash -= amount;
    else impact.bank -= amount;
  } else if (transaction.type === "income") {
    if (method === "cash") impact.cash += amount;
    else impact.bank += amount;
  } else if (transaction.type === "withdrawal") {
    impact.cash += amount;
    impact.bank -= amount;
  } else if (transaction.type === "deposit") {
    impact.cash -= amount;
    impact.bank += amount;
  }
  return impact;
}

function addAmount(bucket, key, amount) {
  bucket[key] = Math.round(((bucket[key] || 0) + amount) * 100) / 100;
}

function summarizeTransactions(transactions) {
  const totals = { spending: 0, income: 0, withdrawn: 0, deposited: 0, cashBalance: 0, bankBalance: 0, net: 0 };
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
    if (transaction.type === "income") totals.income += amount;
    if (transaction.type === "withdrawal") totals.withdrawn += amount;
    if (transaction.type === "deposit") totals.deposited += amount;
    addAmount(byType, transaction.type, amount);
  }

  ["cashBalance", "bankBalance", "spending", "income", "withdrawn", "deposited"].forEach(k => totals[k] = roundMoney(totals[k]));
  totals.net = roundMoney(totals.income - totals.spending);

  return { totals, byCategory, byPaymentMethod, byType };
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

async function requireUser(req, res, dbInstance) {
  const { user, token } = await getActiveUser(req, dbInstance);
  if (!user) {
    sendJson(res, 401, { error: "Login required" });
    return null;
  }
  return { user, token };
}

async function handleApi(req, res, url) {
  const dbInstance = await connectToDatabase();

  if (req.method === "GET" && url.pathname === "/api/users") {
    const users = await dbInstance.collection("users").find().sort({ name: 1 }).toArray();
    sendJson(res, 200, { users: users.map(publicUser) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const input = await readRequestJson(req);
    const name = normalizeDisplayName(input.name);
    if (!name) return sendJson(res, 400, { error: "Enter an account name" });

    let user = await dbInstance.collection("users").findOne({ name: { $regex: new RegExp(`^${name}$`, "i") } });
    if (!user) {
      const result = await dbInstance.collection("users").insertOne({
        name,
        openingCash: 0,
        openingBank: 0,
        createdAt: nowIso()
      });
      user = await dbInstance.collection("users").findOne({ _id: result.insertedId });
    }

    const token = crypto.randomUUID();
    await dbInstance.collection("sessions").insertOne({
      token,
      userId: user._id,
      createdAt: nowIso(),
      lastSeenAt: nowIso()
    });
    sendJson(res, 200, { user: publicUser(user) }, { "Set-Cookie": buildCookie(SESSION_COOKIE, token) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const cookies = parseCookies(req.headers.cookie || "");
    if (cookies[SESSION_COOKIE]) {
      await dbInstance.collection("sessions").deleteOne({ token: cookies[SESSION_COOKIE] });
    }
    sendNoContent(res, { "Set-Cookie": buildCookie(SESSION_COOKIE, "", { maxAge: 0 }) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const active = await getActiveUser(req, dbInstance);
    sendJson(res, 200, {
      authenticated: Boolean(active.user),
      user: active.user ? publicUser(active.user) : null
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/profile") {
    const active = await requireUser(req, res, dbInstance);
    if (!active) return;
    const userTransactions = await dbInstance.collection("transactions").find({ userId: active.user._id }).toArray();
    sendJson(res, 200, {
      user: publicUser(active.user),
      balances: summarizeBalances(active.user, userTransactions)
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/profile") {
    const active = await requireUser(req, res, dbInstance);
    if (!active) return;
    const input = await readRequestJson(req);
    const updates = {
      openingCash: validateBalanceAmount(input.openingCash, "cash in hand"),
      openingBank: validateBalanceAmount(input.openingBank, "bank account"),
      updatedAt: nowIso()
    };
    await dbInstance.collection("users").updateOne({ _id: active.user._id }, { $set: updates });
    const updatedUser = { ...active.user, ...updates };
    const userTransactions = await dbInstance.collection("transactions").find({ userId: active.user._id }).toArray();
    sendJson(res, 200, {
      user: publicUser(updatedUser),
      balances: summarizeBalances(updatedUser, userTransactions)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/transactions") {
    const active = await requireUser(req, res, dbInstance);
    if (!active) return;
    
    const query = { userId: active.user._id };
    const month = url.searchParams.get("month");
    if (/^\d{4}-\d{2}$/.test(month || "")) {
      query.date = { $regex: `^${month}` };
    }
    const type = url.searchParams.get("type");
    if (type && type !== "all") query.type = type;
    const method = url.searchParams.get("paymentMethod");
    if (method && method !== "all") query.paymentMethod = method;
    const q = url.searchParams.get("q");
    if (q) {
      query.$or = [
        { category: { $regex: q, $options: "i" } },
        { note: { $regex: q, $options: "i" } }
      ];
    }

    const transactions = await dbInstance.collection("transactions")
      .find(query)
      .sort({ date: -1, createdAt: -1 })
      .toArray();

    sendJson(res, 200, { transactions: transactions.map(t => ({ ...t, id: t._id.toString() })) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/transactions") {
    const active = await requireUser(req, res, dbInstance);
    if (!active) return;
    const input = await readRequestJson(req);
    const cleaned = validateTransaction(input);
    const createdAt = nowIso();
    const result = await dbInstance.collection("transactions").insertOne({
      userId: active.user._id,
      ...cleaned,
      createdAt,
      updatedAt: createdAt
    });
    sendJson(res, 201, { transaction: { ...cleaned, id: result.insertedId.toString() } });
    return;
  }

  const txnMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (txnMatch) {
    const txnId = txnMatch[1];
    const active = await requireUser(req, res, dbInstance);
    if (!active) return;

    if (req.method === "PUT") {
      const input = await readRequestJson(req);
      const cleaned = validateTransaction(input);
      const result = await dbInstance.collection("transactions").findOneAndUpdate(
        { _id: new ObjectId(txnId), userId: active.user._id },
        { $set: { ...cleaned, updatedAt: nowIso() } },
        { returnDocument: "after" }
      );
      if (!result.value) return sendJson(res, 404, { error: "Transaction not found" });
      sendJson(res, 200, { transaction: { ...result.value, id: result.value._id.toString() } });
      return;
    }

    if (req.method === "DELETE") {
      const result = await dbInstance.collection("transactions").deleteOne({ _id: new ObjectId(txnId), userId: active.user._id });
      if (result.deletedCount === 0) return sendJson(res, 404, { error: "Transaction not found" });
      sendNoContent(res);
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/summary") {
    const active = await requireUser(req, res, dbInstance);
    if (!active) return;
    
    const query = { userId: active.user._id };
    const month = url.searchParams.get("month");
    if (/^\d{4}-\d{2}$/.test(month || "")) {
      query.date = { $regex: `^${month}` };
    }

    const [userTransactions, filteredTransactions] = await Promise.all([
      dbInstance.collection("transactions").find({ userId: active.user._id }).toArray(),
      dbInstance.collection("transactions").find(query).toArray()
    ]);

    const summary = summarizeTransactions(filteredTransactions);
    summary.balances = summarizeBalances(active.user, userTransactions);
    sendJson(res, 200, { summary });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

function sendStatic(req, res, url, publicDir) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (e) { return sendJson(res, 400, { error: "Invalid path" }); }
  const requestPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const publicRoot = path.resolve(publicDir);
  const filePath = path.resolve(publicRoot, requestPath);
  if (!filePath.startsWith(publicRoot)) return sendJson(res, 403, { error: "Forbidden" });

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (pathname !== "/") {
        const fallback = path.join(publicRoot, "index.html");
        fs.readFile(fallback, (fError, fContent) => {
          if (fError) return sendJson(res, 404, { error: "File not found" });
          res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
          res.end(fContent);
        });
        return;
      }
      return sendJson(res, 404, { error: "File not found" });
    }
    const extension = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
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
      await handleApi(req, res, url);
      return;
    }
    sendStatic(req, res, url, DEFAULT_PUBLIC_DIR);
  } catch (error) {
    const status = (error.message === "Invalid JSON body" || error.message === "Request body is too large") ? 400 : 500;
    sendJson(res, status, { error: error.message || "Server error" });
  }
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

server.listen(port, host, () => {
  console.log(`Daily Spend Manager running at http://localhost:${port}`);
});
