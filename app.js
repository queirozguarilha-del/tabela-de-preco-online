const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cookieSession = require("cookie-session");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const PRICE_TYPES = ["NORMAL", "PREMIUM", "SAZONAL"];
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const DATABASE_URL =
  [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const SESSION_SECRETS = String(process.env.SESSION_SECRET || "troque-esta-chave")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const SESSION_MAX_AGE = 1000 * 60 * 60 * 8;
const DEFAULT_EMAIL_TIMEZONE = "America/Sao_Paulo";

let initPromise = null;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function asMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Valor de preco invalido.");
  }
  return Number(parsed.toFixed(2));
}

function normalizePrices(prices) {
  const safe = {};
  for (const type of PRICE_TYPES) {
    const raw = prices?.[type];
    const parsed = Number(raw);
    safe[type] = Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
  }
  return safe;
}

function parsePricePatch(payload) {
  const source = payload?.prices && typeof payload.prices === "object" ? payload.prices : payload;
  const patch = {};
  for (const type of PRICE_TYPES) {
    if (source?.[type] !== undefined) {
      patch[type] = asMoney(source[type]);
    }
  }
  return patch;
}

function parseBatchPriceUpdates(payload) {
  const updates = Array.isArray(payload?.updates) ? payload.updates : [];
  if (updates.length === 0) {
    throw new Error("Nenhuma alteracao de preco enviada.");
  }

  const seen = new Set();
  return updates.map((entry, index) => {
    const itemId = String(entry?.itemId || entry?.id || "").trim();
    if (!itemId) {
      throw new Error(`Item da linha ${index + 1} sem identificador.`);
    }
    if (seen.has(itemId)) {
      throw new Error(`Item duplicado no envio: ${itemId}.`);
    }
    seen.add(itemId);

    let patch;
    try {
      patch = parsePricePatch(entry?.prices || entry);
    } catch (error) {
      throw new Error(`Erro de preco na linha ${index + 1}: ${error.message}`);
    }
    if (Object.keys(patch).length === 0) {
      throw new Error(`Nenhum preco valido para o item da linha ${index + 1}.`);
    }
    return { itemId, patch };
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolvePublicAppUrl(req) {
  const configured = String(process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const host = String(req.get("x-forwarded-host") || req.get("host") || "").trim();
  if (!host) {
    return "";
  }
  const forwardedProto = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function resolveTimeZone(value) {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return DEFAULT_EMAIL_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (_error) {
    return DEFAULT_EMAIL_TIMEZONE;
  }
}

function createId() {
  return crypto.randomUUID();
}

function toIso(value) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString();
}

function defaultData() {
  return {
    admins: [],
    clients: [],
    items: [],
  };
}

class LocalRepository {
  constructor(filePath) {
    this.filePath = filePath;
  }

  ensureDataStore() {
    const directory = path.dirname(this.filePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(defaultData(), null, 2), "utf8");
    }
  }

  loadData() {
    this.ensureDataStore();
    const raw = fs.readFileSync(this.filePath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      return {
        admins: Array.isArray(parsed.admins) ? parsed.admins : [],
        clients: Array.isArray(parsed.clients) ? parsed.clients : [],
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };
    } catch (_error) {
      const fresh = defaultData();
      fs.writeFileSync(this.filePath, JSON.stringify(fresh, null, 2), "utf8");
      return fresh;
    }
  }

  saveData(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  async init({ adminEmail, adminPassword }) {
    const data = this.loadData();
    if (data.admins.length > 0) {
      return;
    }
    const now = new Date().toISOString();
    data.admins.push({
      id: createId(),
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      createdAt: now,
      updatedAt: now,
    });
    this.saveData(data);

    console.log("Admin inicial criado (modo local).");
    console.log(`Email: ${adminEmail}`);
    console.log(`Senha: ${adminPassword}`);
  }

  async getAdminByEmail(email) {
    const data = this.loadData();
    return data.admins.find((item) => item.email === email) || null;
  }

  async getAdminById(adminId) {
    const data = this.loadData();
    return data.admins.find((item) => item.id === adminId) || null;
  }

  async isAdminEmailTaken(email, exceptAdminId = null) {
    const data = this.loadData();
    return data.admins.some((item) => item.email === email && item.id !== exceptAdminId);
  }

  async updateAdminCredentials({ adminId, email, passwordHash }) {
    const data = this.loadData();
    const admin = data.admins.find((item) => item.id === adminId);
    if (!admin) {
      return null;
    }
    admin.email = email;
    admin.passwordHash = passwordHash;
    admin.updatedAt = new Date().toISOString();
    this.saveData(data);
    return admin;
  }

  async listClients() {
    const data = this.loadData();
    return [...data.clients].sort((a, b) => a.email.localeCompare(b.email));
  }

  async getClientByEmail(email) {
    const data = this.loadData();
    return data.clients.find((item) => item.email === email) || null;
  }

  async getClientById(clientId) {
    const data = this.loadData();
    return data.clients.find((item) => item.id === clientId) || null;
  }

  async isClientEmailTaken(email, exceptClientId = null) {
    const data = this.loadData();
    return data.clients.some((item) => item.email === email && item.id !== exceptClientId);
  }

  async createClient({ name, email, type }) {
    const data = this.loadData();
    const client = {
      id: createId(),
      name,
      email,
      type,
      createdAt: new Date().toISOString(),
    };
    data.clients.push(client);
    this.saveData(data);
    return client;
  }

  async updateClient({ clientId, name, email, type }) {
    const data = this.loadData();
    const client = data.clients.find((item) => item.id === clientId);
    if (!client) {
      return null;
    }
    client.name = name;
    client.email = email;
    client.type = type;
    this.saveData(data);
    return client;
  }

  async listClientsByTypes(types) {
    if (!Array.isArray(types) || types.length === 0) {
      return [];
    }
    const allowed = new Set(types);
    const data = this.loadData();
    return data.clients.filter((item) => allowed.has(item.type));
  }

  async listItems() {
    const data = this.loadData();
    return [...data.items]
      .map((item) => ({
        ...item,
        prices: normalizePrices(item.prices),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getItemById(itemId) {
    const data = this.loadData();
    const item = data.items.find((entry) => entry.id === itemId);
    if (!item) {
      return null;
    }
    return {
      ...item,
      prices: normalizePrices(item.prices),
    };
  }

  async findItemByNameInsensitive(name) {
    const data = this.loadData();
    return data.items.find((item) => item.name.toLowerCase() === name.toLowerCase()) || null;
  }

  async createItem({ name, prices }) {
    const data = this.loadData();
    const now = new Date().toISOString();
    const item = {
      id: createId(),
      name,
      prices: normalizePrices(prices),
      createdAt: now,
      updatedAt: now,
    };
    data.items.push(item);
    this.saveData(data);
    return item;
  }

  async updateItemPrices({ itemId, prices }) {
    const data = this.loadData();
    const item = data.items.find((entry) => entry.id === itemId);
    if (!item) {
      return null;
    }
    item.prices = normalizePrices(prices);
    item.updatedAt = new Date().toISOString();
    this.saveData(data);
    return {
      ...item,
      prices: normalizePrices(item.prices),
    };
  }
}

class PostgresRepository {
  constructor(pool) {
    this.pool = pool;
  }

  mapAdmin(row) {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  mapClient(row) {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      type: row.type,
      createdAt: toIso(row.created_at),
    };
  }

  mapItem(row) {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      prices: normalizePrices(row.prices),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  async init({ adminEmail, adminPassword }) {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN ('NORMAL', 'PREMIUM', 'SAZONAL')),
        created_at TIMESTAMPTZ NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prices JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_lower ON items ((lower(name)))
    `);

    const existingAdmin = await this.pool.query("SELECT id FROM admins LIMIT 1");
    if (existingAdmin.rowCount > 0) {
      return;
    }

    const now = new Date().toISOString();
    await this.pool.query(
      `
        INSERT INTO admins (id, email, password_hash, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [createId(), adminEmail, await bcrypt.hash(adminPassword, 10), now, now]
    );

    console.log("Admin inicial criado (PostgreSQL).");
    console.log(`Email: ${adminEmail}`);
    console.log(`Senha: ${adminPassword}`);
  }

  async getAdminByEmail(email) {
    const result = await this.pool.query("SELECT * FROM admins WHERE email = $1 LIMIT 1", [email]);
    return this.mapAdmin(result.rows[0]);
  }

  async getAdminById(adminId) {
    const result = await this.pool.query("SELECT * FROM admins WHERE id = $1 LIMIT 1", [adminId]);
    return this.mapAdmin(result.rows[0]);
  }

  async isAdminEmailTaken(email, exceptAdminId = null) {
    if (exceptAdminId) {
      const result = await this.pool.query(
        "SELECT id FROM admins WHERE email = $1 AND id <> $2 LIMIT 1",
        [email, exceptAdminId]
      );
      return result.rowCount > 0;
    }
    const result = await this.pool.query("SELECT id FROM admins WHERE email = $1 LIMIT 1", [email]);
    return result.rowCount > 0;
  }

  async updateAdminCredentials({ adminId, email, passwordHash }) {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `
        UPDATE admins
        SET email = $1, password_hash = $2, updated_at = $3
        WHERE id = $4
        RETURNING *
      `,
      [email, passwordHash, now, adminId]
    );
    return this.mapAdmin(result.rows[0]);
  }

  async listClients() {
    const result = await this.pool.query("SELECT * FROM clients ORDER BY email ASC");
    return result.rows.map((row) => this.mapClient(row));
  }

  async getClientByEmail(email) {
    const result = await this.pool.query("SELECT * FROM clients WHERE email = $1 LIMIT 1", [email]);
    return this.mapClient(result.rows[0]);
  }

  async getClientById(clientId) {
    const result = await this.pool.query("SELECT * FROM clients WHERE id = $1 LIMIT 1", [clientId]);
    return this.mapClient(result.rows[0]);
  }

  async isClientEmailTaken(email, exceptClientId = null) {
    if (exceptClientId) {
      const result = await this.pool.query(
        "SELECT id FROM clients WHERE email = $1 AND id <> $2 LIMIT 1",
        [email, exceptClientId]
      );
      return result.rowCount > 0;
    }
    const result = await this.pool.query("SELECT id FROM clients WHERE email = $1 LIMIT 1", [email]);
    return result.rowCount > 0;
  }

  async createClient({ name, email, type }) {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `
        INSERT INTO clients (id, name, email, type, created_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [createId(), name, email, type, now]
    );
    return this.mapClient(result.rows[0]);
  }

  async updateClient({ clientId, name, email, type }) {
    const result = await this.pool.query(
      `
        UPDATE clients
        SET name = $1, email = $2, type = $3
        WHERE id = $4
        RETURNING *
      `,
      [name, email, type, clientId]
    );
    return this.mapClient(result.rows[0]);
  }

  async listClientsByTypes(types) {
    if (!Array.isArray(types) || types.length === 0) {
      return [];
    }
    const result = await this.pool.query("SELECT * FROM clients WHERE type = ANY($1::text[])", [types]);
    return result.rows.map((row) => this.mapClient(row));
  }

  async listItems() {
    const result = await this.pool.query("SELECT * FROM items ORDER BY name ASC");
    return result.rows.map((row) => this.mapItem(row));
  }

  async getItemById(itemId) {
    const result = await this.pool.query("SELECT * FROM items WHERE id = $1 LIMIT 1", [itemId]);
    return this.mapItem(result.rows[0]);
  }

  async findItemByNameInsensitive(name) {
    const result = await this.pool.query("SELECT * FROM items WHERE lower(name) = lower($1) LIMIT 1", [name]);
    return this.mapItem(result.rows[0]);
  }

  async createItem({ name, prices }) {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `
        INSERT INTO items (id, name, prices, created_at, updated_at)
        VALUES ($1, $2, $3::jsonb, $4, $5)
        RETURNING *
      `,
      [createId(), name, JSON.stringify(normalizePrices(prices)), now, now]
    );
    return this.mapItem(result.rows[0]);
  }

  async updateItemPrices({ itemId, prices }) {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `
        UPDATE items
        SET prices = $1::jsonb, updated_at = $2
        WHERE id = $3
        RETURNING *
      `,
      [JSON.stringify(normalizePrices(prices)), now, itemId]
    );
    return this.mapItem(result.rows[0]);
  }
}

function makeRepository() {
  if (!DATABASE_URL) {
    return new LocalRepository(DATA_FILE);
  }

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch (error) {
    console.error("PostgreSQL configurado, mas o pacote 'pg' nao esta instalado.");
    throw error;
  }

  const useSsl = String(process.env.DATABASE_SSL || "false").toLowerCase() === "true";
  const poolConfig = { connectionString: DATABASE_URL };
  const poolMax = Number(process.env.PG_POOL_MAX || (IS_PRODUCTION ? 1 : 10));
  const idleTimeout = Number(process.env.PG_IDLE_TIMEOUT_MS || 10000);
  const connectTimeout = Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000);

  if (Number.isFinite(poolMax) && poolMax > 0) {
    poolConfig.max = poolMax;
  }
  if (Number.isFinite(idleTimeout) && idleTimeout > 0) {
    poolConfig.idleTimeoutMillis = idleTimeout;
  }
  if (Number.isFinite(connectTimeout) && connectTimeout > 0) {
    poolConfig.connectionTimeoutMillis = connectTimeout;
  }
  poolConfig.keepAlive = true;

  if (useSsl) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  return new PostgresRepository(new Pool(poolConfig));
}

const repository = makeRepository();

function makeTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

  if (!host || !user || !pass) {
    console.warn("SMTP nao configurado. Emails de alteracao de preco serao ignorados.");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

const transporter = makeTransporter();

function buildPriceUpdateEmailText({ clientName, when, clientChanges }) {
  const intro =
    clientChanges.length === 1
      ? "Houve atualizacao de preco no item abaixo:"
      : `Houve atualizacao de preco em ${clientChanges.length} itens:`;

  const lines = [
    `Ola ${clientName},`,
    "",
    intro,
    "",
  ];

  for (const [index, change] of clientChanges.entries()) {
    lines.push(
      `${index + 1}. ${change.itemName} - de ${formatMoney(change.oldPrice)} para ${formatMoney(change.newPrice)}`
    );
  }

  lines.push("");
  lines.push(`Data da atualizacao: ${when}`);
  lines.push("");
  lines.push("Queiroz e Guarilha");
  lines.push("Se precisar, fale com o administrador.");

  return lines.join("\n");
}

function buildPriceUpdateEmailHtml({ clientName, when, clientChanges, logoUrl }) {
  const intro =
    clientChanges.length === 1
      ? "Houve atualizacao de preco no item abaixo."
      : `Houve atualizacao de preco em <strong>${clientChanges.length} itens</strong>.`;

  const rows = clientChanges
    .map(
      (change, index) => `
        <tr style="background:${index % 2 === 0 ? "#f3f7f4" : "#fff8ef"};">
          <td style="padding:12px 14px;font-size:14px;color:#113628;font-weight:600;">${escapeHtml(change.itemName)}</td>
          <td style="padding:12px 14px;font-size:14px;color:#5f6b66;">${escapeHtml(formatMoney(change.oldPrice))}</td>
          <td style="padding:12px 14px;font-size:14px;color:#b05600;font-weight:700;">${escapeHtml(
            formatMoney(change.newPrice)
          )}</td>
        </tr>
      `
    )
    .join("");

  const footerLogo = logoUrl
    ? `<div style="margin-top:20px;text-align:center;"><img src="${escapeHtml(
        logoUrl
      )}" alt="Queiroz e Guarilha" style="max-width:150px;height:auto;display:inline-block;" /></div>`
    : "";

  return `
    <!doctype html>
    <html lang="pt-BR">
      <body style="margin:0;padding:0;background:#eef1eb;font-family:Arial,Helvetica,sans-serif;color:#23312a;">
        <div style="max-width:640px;margin:0 auto;padding:22px 14px;">
          <div style="background:#ffffff;border:1px solid #d7e1da;border-radius:16px;padding:22px;">
            <h2 style="margin:0 0 8px;font-size:24px;color:#103e2c;">Atualizacao da tabela de preco</h2>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.45;">Ola <strong>${escapeHtml(
              clientName
            )}</strong>, ${intro}</p>

            <table style="width:100%;border-collapse:collapse;border:1px solid #d7e1da;border-radius:12px;overflow:hidden;">
              <thead>
                <tr style="background:#1d7347;">
                  <th align="left" style="padding:12px 14px;color:#ffffff;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Item</th>
                  <th align="left" style="padding:12px 14px;color:#ffffff;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Valor anterior</th>
                  <th align="left" style="padding:12px 14px;color:#ffffff;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Novo valor</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>

            <p style="margin:14px 0 0;font-size:13px;color:#4f5f57;">
              Data da atualizacao: <strong>${escapeHtml(when)}</strong>
            </p>

            ${footerLogo}
          </div>
        </div>
      </body>
    </html>
  `;
}

async function notifyPriceChanges({ changes, clients, appBaseUrl }) {
  if (!transporter) {
    return { skipped: true, sent: 0, failed: 0, targetedClients: 0, changedItems: 0 };
  }
  if (!Array.isArray(changes) || changes.length === 0) {
    return { skipped: false, sent: 0, failed: 0, targetedClients: 0, changedItems: 0 };
  }
  if (!Array.isArray(clients) || clients.length === 0) {
    return { skipped: false, sent: 0, failed: 0, targetedClients: 0, changedItems: changes.length };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const when = new Date().toLocaleString("pt-BR", { timeZone: resolveTimeZone(process.env.TZ) });
  const logoUrl = appBaseUrl ? `${appBaseUrl}/logo.png` : "";
  let sent = 0;
  let failed = 0;
  let targetedClients = 0;

  for (const client of clients) {
    const clientChanges = changes
      .filter((change) => change.changedTypes.includes(client.type))
      .map((change) => ({
        itemName: change.itemName,
        oldPrice: change.oldPrices[client.type],
        newPrice: change.newPrices[client.type],
      }));

    if (clientChanges.length === 0) {
      continue;
    }

    targetedClients += 1;
    const subject =
      clientChanges.length === 1
        ? `Atualizacao de preco - ${clientChanges[0].itemName}`
        : `Atualizacao de preco - ${clientChanges.length} itens atualizados`;

    try {
      await transporter.sendMail({
        from,
        to: client.email,
        subject,
        text: buildPriceUpdateEmailText({
          clientName: client.name,
          when,
          clientChanges,
        }),
        html: buildPriceUpdateEmailHtml({
          clientName: client.name,
          when,
          clientChanges,
          logoUrl,
        }),
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`Falha ao enviar email para ${client.email}:`, error.message);
    }
  }

  return {
    skipped: false,
    sent,
    failed,
    targetedClients,
    changedItems: changes.length,
  };
}

function publicAdmin(admin) {
  return {
    id: admin.id,
    email: admin.email,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
const ensureInitialized = asyncHandler(async (_req, _res, next) => {
  await initializeApp();
  next();
});

const requireAdmin = asyncHandler(async (req, res, next) => {
  const adminId = req.session.adminId;
  if (!adminId) {
    return res.status(401).json({ error: "Acesso nao autorizado." });
  }
  const admin = await repository.getAdminById(adminId);
  if (!admin) {
    delete req.session.adminId;
    return res.status(401).json({ error: "Sessao invalida." });
  }
  req.admin = admin;
  next();
});

const requireCustomer = asyncHandler(async (req, res, next) => {
  const customerId = req.session.customerId;
  if (!customerId) {
    return res.status(401).json({ error: "Sessao de cliente nao encontrada." });
  }
  const customer = await repository.getClientById(customerId);
  if (!customer) {
    delete req.session.customerId;
    return res.status(401).json({ error: "Sessao de cliente invalida." });
  }
  req.customer = customer;
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.set("trust proxy", 1);
app.use(
  cookieSession({
    name: String(process.env.SESSION_COOKIE_NAME || "tdp_sess"),
    keys: SESSION_SECRETS.length > 0 ? SESSION_SECRETS : ["troque-esta-chave"],
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
  })
);
app.use((req, _res, next) => {
  if (!req.session) {
    req.session = {};
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/logo.png", (_req, res) => {
  res.sendFile(path.join(__dirname, "logo.png"));
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/minha-tabela", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "customer-table.html"));
});

app.get("/api/price-types", (_req, res) => {
  res.json({ types: PRICE_TYPES });
});

app.use("/api/admin", ensureInitialized);
app.use("/api/customer", ensureInitialized);

app.post(
  "/api/admin/login",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Informe email e senha." });
    }

    const admin = await repository.getAdminByEmail(email);
    if (!admin) {
      return res.status(401).json({ error: "Email ou senha invalidos." });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Email ou senha invalidos." });
    }

    delete req.session.customerId;
    req.session.adminId = admin.id;
    res.json({ admin: publicAdmin(admin) });
  })
);

app.post(
  "/api/admin/logout",
  requireAdmin,
  asyncHandler(async (req, res) => {
    delete req.session.adminId;
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/me",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ admin: publicAdmin(req.admin) });
  })
);

app.put(
  "/api/admin/credentials",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || "");
    const newEmail = normalizeEmail(req.body?.newEmail);
    const newPassword = String(req.body?.newPassword || "");

    if (!currentPassword || !newEmail || !newPassword) {
      return res.status(400).json({ error: "Senha atual, novo email e nova senha sao obrigatorios." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "A nova senha precisa ter pelo menos 6 caracteres." });
    }

    const passwordOk = await bcrypt.compare(currentPassword, req.admin.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: "Senha atual invalida." });
    }

    const emailTaken = await repository.isAdminEmailTaken(newEmail, req.admin.id);
    if (emailTaken) {
      return res.status(409).json({ error: "Este email ja esta em uso por outro admin." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updatedAdmin = await repository.updateAdminCredentials({
      adminId: req.admin.id,
      email: newEmail,
      passwordHash,
    });

    res.json({ admin: publicAdmin(updatedAdmin) });
  })
);

app.get(
  "/api/admin/clients",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const clients = await repository.listClients();
    res.json({ clients });
  })
);

app.post(
  "/api/admin/clients",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const type = String(req.body?.type || "").toUpperCase();

    if (!name || !email || !type) {
      return res.status(400).json({ error: "Nome, email e tipo sao obrigatorios." });
    }
    if (!PRICE_TYPES.includes(type)) {
      return res.status(400).json({ error: "Tipo invalido." });
    }

    const emailTaken = await repository.isClientEmailTaken(email);
    if (emailTaken) {
      return res.status(409).json({ error: "Este email ja esta cadastrado." });
    }

    const client = await repository.createClient({ name, email, type });
    res.status(201).json({ client });
  })
);

app.put(
  "/api/admin/clients/:clientId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const clientId = req.params.clientId;
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const type = String(req.body?.type || "").toUpperCase();

    if (!name || !email || !type) {
      return res.status(400).json({ error: "Nome, email e tipo sao obrigatorios." });
    }
    if (!PRICE_TYPES.includes(type)) {
      return res.status(400).json({ error: "Tipo invalido." });
    }

    const existing = await repository.getClientById(clientId);
    if (!existing) {
      return res.status(404).json({ error: "Cliente nao encontrado." });
    }

    const emailTaken = await repository.isClientEmailTaken(email, clientId);
    if (emailTaken) {
      return res.status(409).json({ error: "Este email ja esta cadastrado em outro cliente." });
    }

    const client = await repository.updateClient({ clientId, name, email, type });
    res.json({ client });
  })
);

app.get(
  "/api/admin/items",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const items = await repository.listItems();
    res.json({ items });
  })
);

app.post(
  "/api/admin/items",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Nome do item e obrigatorio." });
    }

    const duplicate = await repository.findItemByNameInsensitive(name);
    if (duplicate) {
      return res.status(409).json({ error: "Item ja cadastrado." });
    }

    let prices;
    try {
      prices = normalizePrices(req.body?.prices || req.body);
      for (const type of PRICE_TYPES) {
        prices[type] = asMoney(prices[type]);
      }
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const item = await repository.createItem({ name, prices });
    res.status(201).json({ item });
  })
);

app.put(
  "/api/admin/items/prices",
  requireAdmin,
  asyncHandler(async (req, res) => {
    let updates;
    try {
      updates = parseBatchPriceUpdates(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const prepared = [];
    for (const update of updates) {
      const item = await repository.getItemById(update.itemId);
      if (!item) {
        return res.status(404).json({ error: `Item nao encontrado: ${update.itemId}` });
      }
      const oldPrices = normalizePrices(item.prices);
      prepared.push({
        itemId: update.itemId,
        itemName: item.name,
        oldPrices,
        nextPrices: { ...oldPrices, ...update.patch },
      });
    }

    const updatedItems = [];
    const changedItems = [];
    const changedTypesSet = new Set();

    for (const entry of prepared) {
      const updatedItem = await repository.updateItemPrices({
        itemId: entry.itemId,
        prices: entry.nextPrices,
      });

      if (!updatedItem) {
        return res.status(404).json({ error: `Item nao encontrado: ${entry.itemId}` });
      }

      const changedTypes = PRICE_TYPES.filter((type) => entry.oldPrices[type] !== updatedItem.prices[type]);
      updatedItems.push(updatedItem);

      if (changedTypes.length > 0) {
        for (const type of changedTypes) {
          changedTypesSet.add(type);
        }
        changedItems.push({
          itemId: updatedItem.id,
          itemName: updatedItem.name,
          oldPrices: entry.oldPrices,
          newPrices: updatedItem.prices,
          changedTypes,
        });
      }
    }

    let notifications = { skipped: true, sent: 0, failed: 0, targetedClients: 0, changedItems: 0 };
    if (changedItems.length > 0) {
      const impactedClients = await repository.listClientsByTypes([...changedTypesSet]);
      notifications = await notifyPriceChanges({
        changes: changedItems,
        clients: impactedClients,
        appBaseUrl: resolvePublicAppUrl(req),
      });
    }

    res.json({
      updatedCount: updatedItems.length,
      changedItems: changedItems.map((item) => ({
        itemId: item.itemId,
        itemName: item.itemName,
        changedTypes: item.changedTypes,
      })),
      notifications,
    });
  })
);

app.put(
  "/api/admin/items/:itemId/prices",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const itemId = req.params.itemId;

    let patch;
    try {
      patch = parsePricePatch(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Nenhum preco valido enviado." });
    }

    const item = await repository.getItemById(itemId);
    if (!item) {
      return res.status(404).json({ error: "Item nao encontrado." });
    }

    const oldPrices = normalizePrices(item.prices);
    const nextPrices = { ...oldPrices, ...patch };
    const updatedItem = await repository.updateItemPrices({ itemId, prices: nextPrices });

    const changedTypes = PRICE_TYPES.filter((type) => oldPrices[type] !== updatedItem.prices[type]);
    let notifications = { skipped: true, sent: 0, failed: 0, targetedClients: 0, changedItems: 0 };

    if (changedTypes.length > 0) {
      const impactedClients = await repository.listClientsByTypes(changedTypes);
      notifications = await notifyPriceChanges({
        changes: [
          {
            itemId: updatedItem.id,
            itemName: updatedItem.name,
            oldPrices,
            newPrices: updatedItem.prices,
            changedTypes,
          },
        ],
        clients: impactedClients,
        appBaseUrl: resolvePublicAppUrl(req),
      });
    }

    res.json({
      item: updatedItem,
      changedTypes,
      notifications,
    });
  })
);

app.post(
  "/api/customer/login",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: "Informe um email valido." });
    }

    const client = await repository.getClientByEmail(email);
    if (!client) {
      return res.status(404).json({ error: "Email nao cadastrado." });
    }

    delete req.session.adminId;
    req.session.customerId = client.id;
    res.json({
      ok: true,
      customer: {
        name: client.name,
        email: client.email,
      },
    });
  })
);

app.post(
  "/api/customer/logout",
  asyncHandler(async (req, res) => {
    delete req.session.customerId;
    res.json({ ok: true });
  })
);

app.get(
  "/api/customer/table",
  requireCustomer,
  asyncHandler(async (req, res) => {
    const items = await repository.listItems();
    const visibleItems = items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.prices[req.customer.type],
      updatedAt: item.updatedAt,
    }));

    res.json({
      client: {
        name: req.customer.name,
        email: req.customer.email,
      },
      items: visibleItems,
    });
  })
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno no servidor." });
});

async function initializeApp() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    if (IS_PRODUCTION && !DATABASE_URL) {
      throw new Error("PostgreSQL obrigatorio em producao (DATABASE_URL ou POSTGRES_URL).");
    }

    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL || "admin@tabela.local");
    const adminPassword = String(process.env.ADMIN_PASSWORD || "admin123");
    await repository.init({ adminEmail, adminPassword });

    if (DATABASE_URL) {
      console.log("Persistencia: PostgreSQL.");
    } else {
      console.log("Persistencia: arquivo local data/store.json.");
    }
  })().catch((error) => {
    initPromise = null;
    throw error;
  });

  return initPromise;
}

module.exports = app;
module.exports.app = app;
module.exports.initializeApp = initializeApp;
