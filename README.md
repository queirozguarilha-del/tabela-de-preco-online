# Tabela de Preco Online

Aplicacao web para:

- Admin autenticar com email e senha
- Admin trocar o proprio email e senha no painel
- Cadastrar clientes com tipo fixo (`NORMAL`, `PREMIUM`, `SAZONAL`)
- Editar cliente cadastrado (nome, email e tipo)
- Cadastrar itens e manter os mesmos itens para todos os clientes
- Definir preco por tipo de cliente
- Cliente entrar apenas com email e abrir pagina exclusiva da tabela
- Ocultar para o cliente qual tipo foi atribuido no cadastro
- Enviar email automatico ao cliente quando preco do tipo dele for alterado

## Requisitos

- Node.js 18+ (ou superior)

## Como rodar

1. Instalar dependencias:

```bash
npm install
```

2. Criar arquivo `.env` com base em `.env.example`.

3. Subir servidor:

```bash
npm start
```

4. Acessar:

- Cliente (entrada): `http://localhost:3000/`
- Cliente (tabela apos login): `http://localhost:3000/minha-tabela`
- Admin: `http://localhost:3000/admin`

## Persistencia de dados

### Opcao 1: desenvolvimento local

Sem `DATABASE_URL` e sem `POSTGRES_URL`, o sistema salva em `data/store.json`.

### Opcao 2: banco PostgreSQL (recomendado para deploy)

Com `DATABASE_URL` (manual) ou `POSTGRES_URL` (Vercel Postgres), o sistema usa PostgreSQL e cria as tabelas automaticamente no primeiro start.

Variaveis:

- `DATABASE_URL` (opcional quando usar banco externo, ex: Supabase)
- `POSTGRES_URL` (criada automaticamente pela integracao Vercel Postgres)
- `POSTGRES_PRISMA_URL` (tambem aceita)
- `DATABASE_SSL` (`true` para provedores que exigem SSL, como Supabase Pooler)

Importante:

- Em `production`, se nao houver `DATABASE_URL` nem `POSTGRES_URL`, o servidor nao inicia.

## Deploy Vercel + PostgreSQL

Esta aplicacao ja esta preparada para:

- Front + API no mesmo projeto Vercel
- Banco PostgreSQL externo (Supabase) ou Vercel Postgres

### Caminho recomendado: Vercel Postgres

1. No projeto da Vercel, acesse `Storage`.
2. Crie um `Postgres` e conecte ao projeto.
3. A Vercel cria automaticamente as variaveis `POSTGRES_*`.
4. Configure somente:
   - `SESSION_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - SMTP (opcional)

### Caminho alternativo: Supabase

No projeto da Vercel, configure:

- `DATABASE_URL` (string do Supabase)
- `DATABASE_SSL=true`
- `SESSION_SECRET` (chave forte, pode usar mais de uma separada por virgula)
- `SESSION_COOKIE_NAME` (opcional)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (se quiser notificacao por email)

### Deploy

Conecte o repositorio no painel da Vercel e faca o deploy.
Na primeira inicializacao:

- as tabelas sao criadas automaticamente;
- o admin inicial e criado se ainda nao existir.

## Admin inicial

Quando ainda nao existe admin no armazenamento atual (banco ou local), o sistema cria automaticamente um admin com:

- `ADMIN_EMAIL` (padrao: `admin@tabela.local`)
- `ADMIN_PASSWORD` (padrao: `admin123`)

Depois, voce pode trocar email/senha direto no painel admin em "Seguranca do admin".

## Notificacao por email

Para enviar email em alteracao de preco, configure SMTP no `.env`:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM` (opcional, recomendado)

Se SMTP nao estiver configurado, o sistema atualiza os precos normalmente e apenas nao envia email.
