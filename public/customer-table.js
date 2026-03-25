const metaEl = document.getElementById("customer-meta");
const messageEl = document.getElementById("customer-table-message");
const listEl = document.getElementById("customer-table-body");
const searchInput = document.getElementById("customer-item-search");
const searchInfoEl = document.getElementById("customer-search-info");
const logoutBtn = document.getElementById("customer-logout-btn");
const logoLink = document.getElementById("customer-logo-link");

let logoClickCount = 0;
let logoClickTimer = null;
let allItems = [];

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeForSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function setMessage(text, type = "") {
  messageEl.textContent = text || "";
  messageEl.className = type ? `message ${type}` : "message";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function updateSearchInfo(filteredCount, totalCount, term) {
  if (!totalCount) {
    searchInfoEl.textContent = "Nenhum item cadastrado.";
    return;
  }
  if (!term) {
    searchInfoEl.textContent = `${totalCount} item(ns) disponivel(is).`;
    return;
  }
  searchInfoEl.textContent = `${filteredCount} de ${totalCount} item(ns) encontrado(s) para "${term}".`;
}

function renderItems(items) {
  if (!items.length) {
    listEl.innerHTML = `
      <article class="customer-price-empty">
        Nenhum item encontrado para sua busca.
      </article>
    `;
    return;
  }

  listEl.innerHTML = items
    .map((item) => {
      const updatedAt = formatDateTime(item.updatedAt);
      return `
      <article class="customer-price-item">
        <div class="customer-price-main">
          <p class="customer-price-name">${escapeHtml(item.name)}</p>
          <p class="customer-price-value">${formatMoney(item.price)}</p>
        </div>
        ${updatedAt ? `<p class="customer-price-updated">Atualizado: ${updatedAt}</p>` : ""}
      </article>
    `;
    })
    .join("");
}

function applySearch() {
  const rawTerm = String(searchInput.value || "").trim();
  const term = normalizeForSearch(rawTerm);

  if (!term) {
    renderItems(allItems);
    updateSearchInfo(allItems.length, allItems.length, "");
    return;
  }

  const filtered = allItems.filter((item) => normalizeForSearch(item.name).includes(term));
  renderItems(filtered);
  updateSearchInfo(filtered.length, allItems.length, rawTerm);
}

async function loadTable() {
  setMessage("Carregando sua tabela...");
  try {
    const response = await fetch("/api/customer/table");
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = "/";
        return;
      }
      throw new Error(data.error || "Nao foi possivel carregar sua tabela.");
    }

    metaEl.textContent = `${data.client.name} - ${data.client.email}`;
    allItems = Array.isArray(data.items) ? [...data.items] : [];
    allItems.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
    applySearch();
    setMessage("Tabela carregada com sucesso.", "ok");
  } catch (error) {
    setMessage(error.message || "Erro ao carregar tabela.", "error");
  }
}

if (logoLink) {
  logoLink.addEventListener("click", (event) => {
    event.preventDefault();
    logoClickCount += 1;

    if (logoClickTimer) {
      clearTimeout(logoClickTimer);
    }
    logoClickTimer = setTimeout(() => {
      logoClickCount = 0;
      logoClickTimer = null;
    }, 1200);

    if (logoClickCount >= 3) {
      logoClickCount = 0;
      if (logoClickTimer) {
        clearTimeout(logoClickTimer);
        logoClickTimer = null;
      }
      window.location.href = logoLink.getAttribute("href") || "/admin";
    }
  });
}

logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/customer/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (_error) {
    // Ignora erro de logout e volta para a tela de entrada.
  }
  window.location.href = "/";
});

searchInput.addEventListener("input", applySearch);

loadTable();
