const state = {
  user: null,
  transactions: [],
  summary: null,
  profile: null,
  filters: {
    month: "",
    type: "all",
    paymentMethod: "all",
    query: ""
  }
};

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

const labels = {
  expense: "Expense",
  income: "Income",
  withdrawal: "Withdrawal",
  deposit: "Deposit",
  cash: "Cash",
  online: "Online",
  bank: "Bank"
};

const sectionIds = ["dashboardSection", "balancesSection", "entrySection", "historySection", "breakdownSection"];

function $(selector) {
  return document.querySelector(selector);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return today().slice(0, 7);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

const API_BASE = (window.location.origin.startsWith('file') || window.location.origin.startsWith('capacitor')) 
  ? 'https://your-hosted-app.onrender.com' 
  : '';

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    credentials: API_BASE ? "include" : "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  $("#loginName").focus();
  loadAccounts();
}

function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#activeUserName").textContent = state.user.name;
  showSection(sectionFromHash());
}

async function loadAccounts() {
  const container = $("#accountList");
  container.innerHTML = "";
  try {
    const { users } = await api("/api/users");
    for (const user of users) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "account-pill";
      button.innerHTML = `<span>${escapeHtml(user.name)}</span><strong>Enter</strong>`;
      button.addEventListener("click", () => login(user.name));
      container.appendChild(button);
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function login(name) {
  const payload = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  state.user = payload.user;
  showApp();
  await refreshData();
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  state.user = null;
  state.transactions = [];
  state.summary = null;
  state.profile = null;
  resetForm();
  showLogin();
}

function queryString() {
  const params = new URLSearchParams();
  if (state.filters.month) {
    params.set("month", state.filters.month);
  }
  if (state.filters.type !== "all") {
    params.set("type", state.filters.type);
  }
  if (state.filters.paymentMethod !== "all") {
    params.set("paymentMethod", state.filters.paymentMethod);
  }
  if (state.filters.query) {
    params.set("q", state.filters.query);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function refreshData() {
  const query = queryString();
  const [transactionsPayload, summaryPayload] = await Promise.all([
    api(`/api/transactions${query}`),
    api(`/api/summary${query}`)
  ]);
  state.transactions = transactionsPayload.transactions;
  state.summary = summaryPayload.summary;
  renderSummary();
  renderTransactions();
  renderBreakdowns();
}

function renderSummary() {
  const totals = state.summary?.totals || {};
  const balances = state.summary?.balances || {};
  $("#totalAvailable").textContent = money.format(balances.totalAvailable || 0);
  $("#spentTotal").textContent = money.format(totals.spending || 0);
  $("#incomeTotal").textContent = money.format(totals.income || 0);
  $("#cashBalance").textContent = money.format(balances.cashInHand || 0);
  $("#bankBalance").textContent = money.format(balances.bankAccount || 0);
  $("#netCaption").textContent = `${money.format(totals.net || 0)} monthly net`;
  $("#cashCaption").textContent = `${money.format(balances.cashMovement || 0)} tracked movement`;
  $("#bankCaption").textContent = `${money.format(balances.bankMovement || 0)} tracked movement`;
  $("#openingCashInput").value = balances.openingCash ?? 0;
  $("#openingBankInput").value = balances.openingBank ?? 0;
  renderDashboardGraph(totals, balances);
}

function renderDashboardGraph(totals, balances) {
  const graph = $("#dashboardGraph");
  const rows = [
    { label: "Spent", amount: totals.spending || 0, tone: "spent" },
    { label: "Income", amount: totals.income || 0, tone: "income" },
    { label: "Cash", amount: balances.cashInHand || 0, tone: "cash" },
    { label: "Bank", amount: balances.bankAccount || 0, tone: "bank" }
  ];
  const max = Math.max(...rows.map((row) => Math.abs(row.amount)), 1);

  graph.innerHTML = "";
  for (const row of rows) {
    const height = Math.max(8, Math.round((Math.abs(row.amount) / max) * 100));
    const column = document.createElement("div");
    column.className = "graph-column";
    column.innerHTML = `
      <div class="graph-value">${money.format(row.amount)}</div>
      <div class="graph-track">
        <div class="graph-fill graph-${row.tone}" style="height: ${height}%"></div>
      </div>
      <div class="graph-label">${row.label}</div>
    `;
    graph.appendChild(column);
  }
}

function renderTransactions() {
  const list = $("#transactionList");
  const empty = $("#emptyState");
  list.innerHTML = "";
  empty.classList.toggle("hidden", state.transactions.length > 0);

  for (const transaction of state.transactions) {
    const row = document.createElement("article");
    row.className = "transaction-row";
    row.innerHTML = `
      <div class="transaction-date">${formatDate(transaction.date)}</div>
      <div class="transaction-main">
        <strong>${escapeHtml(transaction.category)}</strong>
        <span>${escapeHtml(transaction.note || "No note")}</span>
      </div>
      <span class="type-badge type-${transaction.type}">${labels[transaction.type]}</span>
      <span class="transaction-method">${labels[transaction.paymentMethod]}</span>
      <strong class="transaction-amount">${money.format(transaction.amount)}</strong>
      <div class="transaction-actions">
        <button type="button" class="mini-button" data-action="edit" data-id="${transaction.id}">Edit</button>
        <button type="button" class="mini-button" data-action="delete" data-id="${transaction.id}">Delete</button>
      </div>
    `;
    list.appendChild(row);
  }
}

function renderBreakdowns() {
  renderBarList("#categoryBreakdown", state.summary?.byCategory || {});
  renderBarList("#methodBreakdown", state.summary?.byPaymentMethod || {}, labels);
}

function renderBarList(selector, data, labelMap = {}) {
  const container = $(selector);
  container.innerHTML = "";
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map((entry) => entry[1]), 0);

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No expense data.";
    container.appendChild(empty);
    return;
  }

  for (const [name, amount] of entries) {
    const percent = max ? Math.max(6, Math.round((amount / max) * 100)) : 0;
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label">
        <span>${escapeHtml(labelMap[name] || name)}</span>
        <strong>${money.format(amount)}</strong>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width: ${percent}%"></div></div>
    `;
    container.appendChild(row);
  }
}

async function saveTransaction(event) {
  event.preventDefault();
  const id = $("#transactionId").value;
  const payload = {
    date: $("#dateInput").value,
    type: $("#typeInput").value,
    amount: $("#amountInput").value,
    paymentMethod: $("#paymentInput").value,
    category: $("#categoryInput").value,
    note: $("#noteInput").value
  };

  const path = id ? `/api/transactions/${encodeURIComponent(id)}` : "/api/transactions";
  const method = id ? "PUT" : "POST";
  await api(path, {
    method,
    body: JSON.stringify(payload)
  });
  resetForm();
  await refreshData();
  showToast(id ? "Entry updated" : "Entry saved");
}

async function saveBalances(event) {
  event.preventDefault();
  const payload = {
    openingCash: $("#openingCashInput").value,
    openingBank: $("#openingBankInput").value
  };
  const profile = await api("/api/profile", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  state.profile = profile;
  await refreshData();
  showToast("Balances saved");
}

async function handleTransactionAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const transaction = state.transactions.find((entry) => entry.id === button.dataset.id);
  if (!transaction) {
    return;
  }

  if (button.dataset.action === "edit") {
    fillForm(transaction);
    return;
  }

  if (button.dataset.action === "delete") {
    await api(`/api/transactions/${encodeURIComponent(transaction.id)}`, { method: "DELETE" });
    await refreshData();
    showToast("Entry deleted");
  }
}

function fillForm(transaction) {
  $("#transactionId").value = transaction.id;
  $("#dateInput").value = transaction.date;
  $("#typeInput").value = transaction.type;
  $("#amountInput").value = transaction.amount;
  $("#paymentInput").value = transaction.paymentMethod;
  $("#categoryInput").value = transaction.category;
  $("#noteInput").value = transaction.note || "";
  $("#formTitle").textContent = "Edit entry";
  $("#saveButton").textContent = "Update entry";
  $("#cancelEditButton").classList.remove("hidden");
  showSection("entrySection");
  document.querySelector(".entry-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm() {
  $("#transactionId").value = "";
  $("#dateInput").value = today();
  $("#typeInput").value = "expense";
  $("#amountInput").value = "";
  $("#paymentInput").value = "cash";
  $("#categoryInput").value = "Food";
  $("#noteInput").value = "";
  $("#formTitle").textContent = "Add entry";
  $("#saveButton").textContent = "Save entry";
  $("#cancelEditButton").classList.add("hidden");
}

function updateTypeDefaults() {
  const type = $("#typeInput").value;
  const category = $("#categoryInput");
  if (type === "withdrawal" || type === "deposit") {
    category.value = "Transfer";
    $("#paymentInput").value = "bank";
  } else if (category.value === "Transfer") {
    category.value = type === "income" ? "Work" : "Food";
  }
}

function bindEvents() {
  document.querySelectorAll("[data-section-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const sectionId = link.dataset.sectionLink;
      showSection(sectionId);
      history.replaceState(null, "", `#${sectionId}`);
    });
  });

  window.addEventListener("hashchange", () => {
    showSection(sectionFromHash());
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await login($("#loginName").value);
      $("#loginName").value = "";
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#logoutButton").addEventListener("click", () => {
    logout().catch((error) => showToast(error.message));
  });

  $("#transactionForm").addEventListener("submit", (event) => {
    saveTransaction(event).catch((error) => showToast(error.message));
  });

  $("#balanceForm").addEventListener("submit", (event) => {
    saveBalances(event).catch((error) => showToast(error.message));
  });

  $("#cancelEditButton").addEventListener("click", resetForm);
  $("#typeInput").addEventListener("change", updateTypeDefaults);
  $("#transactionList").addEventListener("click", (event) => {
    handleTransactionAction(event).catch((error) => showToast(error.message));
  });

  $("#monthFilter").addEventListener("change", async (event) => {
    state.filters.month = event.target.value;
    await refreshData();
  });

  $("#typeFilter").addEventListener("change", async (event) => {
    state.filters.type = event.target.value;
    await refreshData();
  });

  $("#methodFilter").addEventListener("change", async (event) => {
    state.filters.paymentMethod = event.target.value;
    await refreshData();
  });

  $("#searchInput").addEventListener("input", debounce(async (event) => {
    state.filters.query = event.target.value.trim();
    await refreshData();
  }, 180));
}

function debounce(callback, delay) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function sectionFromHash() {
  const sectionId = window.location.hash.replace("#", "");
  return sectionIds.includes(sectionId) ? sectionId : "dashboardSection";
}

function showSection(sectionId) {
  const activeSectionId = sectionIds.includes(sectionId) ? sectionId : "dashboardSection";

  for (const id of sectionIds) {
    const section = document.getElementById(id);
    if (section) {
      section.classList.toggle("hidden", id !== activeSectionId);
    }
  }

  document.querySelectorAll("[data-section-link]").forEach((link) => {
    const isActive = link.dataset.sectionLink === activeSectionId;
    link.classList.toggle("active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function init() {
  bindEvents();
  state.filters.month = currentMonth();
  $("#monthFilter").value = state.filters.month;
  resetForm();

  try {
    const session = await api("/api/session");
    if (session.authenticated) {
      state.user = session.user;
      showApp();
      await refreshData();
    } else {
      showLogin();
    }
  } catch (error) {
    showToast(error.message);
    showLogin();
  }
}

document.addEventListener("DOMContentLoaded", init);
