const loginCard = document.getElementById("login-card");
const dashboard = document.getElementById("dashboard");
const adminLabel = document.getElementById("admin-label");

const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");
const logoutBtn = document.getElementById("logout-btn");
const adminCredentialsForm = document.getElementById("admin-credentials-form");
const adminCredentialsMessage = document.getElementById("admin-credentials-message");

const clientForm = document.getElementById("client-form");
const clientMessage = document.getElementById("client-message");
const clientsBody = document.getElementById("clients-body");

const itemForm = document.getElementById("item-form");
const itemMessage = document.getElementById("item-message");
const itemsBody = document.getElementById("items-body");
const priceMessage = document.getElementById("price-message");

const PRICE_TYPES = ["NORMAL", "PREMIUM", "SAZONAL"];

function setMessage(element, text, type = "") {
  element.textContent = text || "";
  element.className = type ? `message ${type}` : "message";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Erro na requisicao.");
  }
  return data;
}

function setAuthView(admin) {
  if (!admin) {
    loginCard.classList.remove("hidden");
    dashboard.classList.add("hidden");
    if (adminCredentialsForm) {
      adminCredentialsForm.reset();
    }
    setMessage(adminCredentialsMessage, "");
    return;
  }
  adminLabel.textContent = admin.email;
  if (adminCredentialsForm) {
    const newEmailInput = adminCredentialsForm.querySelector('input[name="newEmail"]');
    if (newEmailInput) {
      newEmailInput.value = admin.email;
    }
  }
  loginCard.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

function renderTypeOptions(selectedType) {
  return PRICE_TYPES.map(
    (type) => `<option value="${type}" ${type === selectedType ? "selected" : ""}>${type}</option>`
  ).join("");
}

function renderClients(clients) {
  if (!clients.length) {
    clientsBody.innerHTML = "<tr><td colspan=\"4\">Nenhum cliente cadastrado.</td></tr>";
    return;
  }

  clientsBody.innerHTML = clients
    .map(
      (client) => `
      <tr>
        <td data-label="Cliente">
          <input
            type="text"
            value="${escapeHtml(client.name)}"
            data-client-id="${client.id}"
            data-client-field="name"
          />
        </td>
        <td data-label="Email">
          <input
            type="email"
            value="${escapeHtml(client.email)}"
            data-client-id="${client.id}"
            data-client-field="email"
          />
        </td>
        <td data-label="Tipo">
          <select data-client-id="${client.id}" data-client-field="type">
            ${renderTypeOptions(client.type)}
          </select>
        </td>
        <td data-label="Acoes">
          <button type="button" data-save-client="${client.id}" class="button-ghost">Salvar cliente</button>
        </td>
      </tr>
    `
    )
    .join("");
}

function renderItems(items) {
  if (!items.length) {
    itemsBody.innerHTML = "<tr><td colspan=\"5\">Nenhum item cadastrado.</td></tr>";
    return;
  }

  itemsBody.innerHTML = items
    .map(
      (item) => `
      <tr>
        <td data-label="Item">${escapeHtml(item.name)}</td>
        <td data-label="NORMAL"><input class="price-input" data-item-id="${item.id}" data-type="NORMAL" type="number" min="0" step="0.01" value="${item.prices.NORMAL}" /></td>
        <td data-label="PREMIUM"><input class="price-input" data-item-id="${item.id}" data-type="PREMIUM" type="number" min="0" step="0.01" value="${item.prices.PREMIUM}" /></td>
        <td data-label="SAZONAL"><input class="price-input" data-item-id="${item.id}" data-type="SAZONAL" type="number" min="0" step="0.01" value="${item.prices.SAZONAL}" /></td>
        <td data-label="Acoes"><button type="button" data-save-item="${item.id}">Salvar preco</button></td>
      </tr>
    `
    )
    .join("");
}

async function loadClients() {
  const data = await api("/api/admin/clients");
  renderClients(data.clients);
}

async function loadItems() {
  const data = await api("/api/admin/items");
  renderItems(data.items);
}

async function loadDashboardData() {
  await Promise.all([loadClients(), loadItems()]);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const payload = {
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
  };

  setMessage(loginMessage, "Validando acesso...");
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setAuthView(data.admin);
    setMessage(loginMessage, "");
    await loadDashboardData();
  } catch (error) {
    setMessage(loginMessage, error.message, "error");
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
  } catch (_error) {
    // Ignora falha no logout e limpa tela de qualquer forma.
  }
  setAuthView(null);
  setMessage(loginMessage, "");
  loginForm.reset();
});

clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(clientForm);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    type: String(formData.get("type") || "").trim(),
  };

  setMessage(clientMessage, "Cadastrando cliente...");
  try {
    await api("/api/admin/clients", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    clientForm.reset();
    setMessage(clientMessage, "Cliente cadastrado com sucesso.", "ok");
    await loadClients();
  } catch (error) {
    setMessage(clientMessage, error.message, "error");
  }
});

if (adminCredentialsForm) {
  adminCredentialsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(adminCredentialsForm);
    const payload = {
      currentPassword: String(formData.get("currentPassword") || ""),
      newEmail: String(formData.get("newEmail") || "").trim(),
      newPassword: String(formData.get("newPassword") || ""),
    };

    setMessage(adminCredentialsMessage, "Atualizando acesso...");
    try {
      const data = await api("/api/admin/credentials", {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      adminCredentialsForm.reset();
      const newEmailInput = adminCredentialsForm.querySelector('input[name="newEmail"]');
      if (newEmailInput) {
        newEmailInput.value = data.admin.email;
      }
      adminLabel.textContent = data.admin.email;
      setMessage(adminCredentialsMessage, "Email e senha atualizados com sucesso.", "ok");
    } catch (error) {
      setMessage(adminCredentialsMessage, error.message, "error");
    }
  });
}

clientsBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const clientId = target.dataset.saveClient;
  if (!clientId) {
    return;
  }

  const nameInput = clientsBody.querySelector(`input[data-client-id="${clientId}"][data-client-field="name"]`);
  const emailInput = clientsBody.querySelector(`input[data-client-id="${clientId}"][data-client-field="email"]`);
  const typeSelect = clientsBody.querySelector(`select[data-client-id="${clientId}"][data-client-field="type"]`);

  if (!nameInput || !emailInput || !typeSelect) {
    setMessage(clientMessage, "Falha ao localizar os dados do cliente.", "error");
    return;
  }

  const payload = {
    name: String(nameInput.value || "").trim(),
    email: String(emailInput.value || "").trim(),
    type: String(typeSelect.value || "").trim(),
  };

  setMessage(clientMessage, "Atualizando cliente...");
  try {
    await api(`/api/admin/clients/${clientId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    setMessage(clientMessage, "Cliente atualizado com sucesso.", "ok");
    await loadClients();
  } catch (error) {
    setMessage(clientMessage, error.message, "error");
  }
});

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(itemForm);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    prices: {
      NORMAL: Number(formData.get("NORMAL")),
      PREMIUM: Number(formData.get("PREMIUM")),
      SAZONAL: Number(formData.get("SAZONAL")),
    },
  };

  setMessage(itemMessage, "Cadastrando item...");
  try {
    await api("/api/admin/items", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    itemForm.reset();
    setMessage(itemMessage, "Item cadastrado com sucesso.", "ok");
    await loadItems();
  } catch (error) {
    setMessage(itemMessage, error.message, "error");
  }
});

itemsBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const itemId = target.dataset.saveItem;
  if (!itemId) {
    return;
  }

  const prices = {};
  for (const type of PRICE_TYPES) {
    const input = itemsBody.querySelector(`input[data-item-id="${itemId}"][data-type="${type}"]`);
    if (!input) {
      setMessage(priceMessage, "Falha ao localizar campos de preco.", "error");
      return;
    }
    prices[type] = Number(input.value);
  }

  setMessage(priceMessage, "Salvando preco...");
  try {
    const data = await api(`/api/admin/items/${itemId}/prices`, {
      method: "PUT",
      body: JSON.stringify({ prices }),
    });
    await loadItems();

    const sent = data.notifications?.sent || 0;
    const failed = data.notifications?.failed || 0;
    const changed =
      Array.isArray(data.changedTypes) && data.changedTypes.length > 0
        ? data.changedTypes.join(", ")
        : "nenhum";

    if (data.notifications?.skipped) {
      setMessage(
        priceMessage,
        `Preco atualizado (${changed}). SMTP nao configurado, sem envio de email.`,
        "ok"
      );
      return;
    }

    setMessage(
      priceMessage,
      `Preco atualizado (${changed}). Emails enviados: ${sent}. Falhas: ${failed}.`,
      "ok"
    );
  } catch (error) {
    setMessage(priceMessage, error.message, "error");
  }
});

async function bootstrap() {
  try {
    const data = await api("/api/admin/me");
    setAuthView(data.admin);
    await loadDashboardData();
  } catch (_error) {
    setAuthView(null);
  }
}

bootstrap();
