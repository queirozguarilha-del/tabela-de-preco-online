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

Sem `DATABASE_URL`, o sistema salva em `data/store.json`.

### Opcao 2: banco PostgreSQL (recomendado para deploy)

Com `DATABASE_URL`, o sistema usa PostgreSQL e cria as tabelas automaticamente no primeiro start.

Variaveis:

- `DATABASE_URL`
- `DATABASE_SSL` (`true` para provedores que exigem SSL, como Supabase Pooler)

Importante:

- Em `production`, se `DATABASE_URL` nao estiver configurada, o servidor nao inicia.

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
