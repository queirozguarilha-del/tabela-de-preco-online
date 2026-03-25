const form = document.getElementById("customer-form");
const emailInput = document.getElementById("customer-email");
const messageEl = document.getElementById("customer-message");
const logoLink = document.getElementById("customer-logo-link");

let logoClickCount = 0;
let logoClickTimer = null;

function setMessage(text, type = "") {
  messageEl.textContent = text || "";
  messageEl.className = type ? `message ${type}` : "message";
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) {
    setMessage("Informe o email cadastrado.", "error");
    return;
  }

  setMessage("Entrando na sua tabela...");
  try {
    const response = await fetch("/api/customer/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Nao foi possivel entrar.");
    }
    window.location.href = "/minha-tabela";
  } catch (error) {
    setMessage(error.message || "Erro ao entrar.", "error");
  }
});
