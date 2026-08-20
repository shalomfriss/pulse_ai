# Pulse AI

Pulse AI is a full-stack market agent and trading dashboard. The existing Sites
deployment continues to use its hosted D1 database. Local and independently
self-hosted installations use MySQL instead and do not connect to hosted D1.

## Run locally with MySQL

Prerequisites: Node.js 22.13+ and either Docker Desktop or a local MySQL 8+
installation. Docker is preferred; when Docker is unavailable and `mysqld` is
installed, Pulse AI automatically creates an isolated project-local instance.

```bash
npm install
cp .env.example .env.local
npm run local
```

The local launcher also starts the Kronos financial forecasting workbench at
`http://localhost:7071`; open the **Kronos** tab inside Pulse AI to use its
data loading, model selection, forecasting, chart comparison, and result
export features. Kronos dependencies are installed into the ignored
`.venv-kronos/` environment.

The local launcher also starts the FinRL research workbench at
`http://localhost:7072`; open the **FinRL** tab for step-by-step instructions
and controls for the official data-preparation, DRL-training, and backtesting
examples. FinRL is installed editable into the ignored `.venv-finrl/`
environment. The workbench runs research jobs only and does not submit trades.

`npm run local` starts MySQL, applies the MySQL schema, starts a localhost-only
database bridge, and launches Pulse AI. Open the URL printed by the development
server. MySQL listens only on `127.0.0.1:3307`; data is stored in the Docker
volume `pulse_ai_mysql_data` or, for the automatic fallback, `.mysql-local/`.

Stop the app with Ctrl-C. The database remains available for the next run. Stop
the database with:

```bash
npm run local:mysql:stop
```

To use an existing MySQL 8+ server, set `MYSQL_URL`, set
`LOCAL_MYSQL_MANAGED=false`, and run `npm run local`.

Local identity comes from `LOCAL_DEV_USER_EMAIL` and
`LOCAL_DEV_USER_NAME`. It is accepted only for loopback browser requests; the
hosted ChatGPT sign-in flow is unchanged. Keep `ALPACA_AUTO_TRADE=false` until
you have intentionally configured a paper account. Credentials entered in
Settings are encrypted in MySQL with `CREDENTIALS_ENCRYPTION_KEY`.

## Build and test

```bash
npm run build
npm test
```

## Deploy independently with MySQL

The repository includes a complete Docker deployment:

```bash
export MYSQL_PASSWORD='replace-with-a-strong-password'
export MYSQL_ROOT_PASSWORD='replace-with-another-strong-password'
export CREDENTIALS_ENCRYPTION_KEY='replace-with-a-long-random-key'
docker compose -f docker-compose.selfhost.yml up --build -d
```

This starts the production build and MySQL on a private Docker network and
publishes the app on port 3000. MySQL is not published to the internet. Add a
TLS reverse proxy and an identity layer that supplies
`oai-authenticated-user-email` before exposing the app publicly. Do not set
`LOCAL_DEV_USER_EMAIL` for a public deployment.

For a managed MySQL service, set `MYSQL_URL` and run the built application with
`npm run start:mysql`; the MySQL bridge remains private inside the app process.

## Production safety

- `.openai/hosting.json` and the existing Sites project ID remain unchanged.
- The hosted site continues using D1; only local/self-hosted paths use MySQL.
- MySQL credentials and local environment values are ignored by Git.
- The local identity fallback is loopback-restricted.
- Automatic trading defaults to off.
