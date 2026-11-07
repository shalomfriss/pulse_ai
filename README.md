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

## Compile market history for offline backtests

Open **Backtesting** or **Day Trading**, choose a symbol, timeframe, and date
range, then select **Compile selected range**. Pulse AI downloads adjusted
public daily bars or Alpaca IEX intraday bars, validates and sorts them, removes duplicate timestamps, and
stores the compiled dataset in browser IndexedDB. The cache is keyed by symbol
and timeframe, so both research pages reuse the same bars instead of downloading
separate copies.

After the first successful compilation, backtests and day-trading optimization
load covered ranges from IndexedDB and execute in the shared browser worker.
Those runs do not contact Alpaca or the backtesting APIs. The local or self-hosted
Pulse AI application must still be running, but market-data internet access is
not required. Uploading an OHLCV CSV also compiles it into the same local library.

Each dataset may contain up to 300,000 bars and each request may span up to twenty
years. Alpaca's intraday coverage begins in 2016, so a twenty-year intraday
request cannot be filled by that provider. A multi-year 5-minute request can
approach the bar limit; use 15-minute or hourly bars for symbols with extended
sessions. **Refresh local data** explicitly downloads the selected range again.
It merges bars only when the provider and configured archive location match;
switching sources replaces the cached record.

For a file-based archive, place `SYMBOL.1Day.json` files in `backtesting_data`
using the format in [backtesting_data/README.md](backtesting_data/README.md).
To compile adjusted daily history for named symbols with the existing public
provider, run `npm run data:compile -- SPY AAPL` or pass a newline-delimited
symbol list with `--symbols-file symbols.txt`. The compiler writes each archive
atomically and reports the actual date coverage. Run `npm run data:universe` to
fetch the current Nasdaq and other exchange symbol directories into
`backtesting_data`, then use the generated `current-symbols.txt` with
`--symbols-file`. Use `--skip-existing`, `--offset`, `--limit`, and `--delay-ms`
to resume public-provider batches. A current listing directory does not
enumerate stocks delisted over the last twenty years.
For a purchased per-security adjusted CSV archive, run
`npm run data:import -- /path/to/archive.zip`; see the data-directory README
for required columns. The importer accepts delisted filenames and leaves
existing wider archives intact unless `--replace` is specified.
Reused tickers are kept as separate listing histories; backtests that span
multiple companies under one ticker must narrow the date range to one listing.
Even a single identified listing bypasses the browser's ticker-only cache.
Archives without listing identity display a warning because ticker reuse
cannot be ruled out from price bars alone.
Run `npm run data:audit` to inspect actual coverage and compare against an
expected universe when one is available.
Local runs read that directory first. Set `BACKTESTING_DATA_SOURCE` to another
directory to use a mounted external or network drive, or to an HTTP(S) base URL
to load archives online. The URL may expose
`v1/history/SYMBOL/1Day.json` or static `SYMBOL.1Day.json` files. The app falls back to its normal provider when a
symbol is absent from the archive; a known symbol with no bars in the requested
dates reports an archive coverage error, avoiding mixed data sources. The checked-in
directory excludes generated market data; a licensed source with delisted
symbols is still needed for a twenty-year, entire-market dataset.
When an archive is configured, backtests request it before using any browser
cache. Removing the archive configuration also prevents an old archive cache
entry from silently replacing the normal provider.
Set `BACKTESTING_DATA_STRICT_DAILY=true` for archive-only daily backtests: a
missing symbol returns an error instead of silently loading a public price
series. Intraday requests can still use the normal provider.
For a private HTTP(S) archive, set `BACKTESTING_DATA_AUTH_TOKEN` to its bearer
token on the server; the token is never sent to the browser.

Browser storage is origin-specific: `http://localhost:3000` and a hosted domain
have separate libraries. Clearing site data removes the compiled datasets.

## Automated rule sets

In **Backtesting**, describe a rule set in plain English, inspect the parsed
conditions and exact JSON, then save it. New sets start disabled; enable each
one after reviewing it. Multiple sets are stored per user and Alpaca account
profile. The parser requires a server-side `OPENAI_API_KEY` and uses the
configurable `OPENAI_RULE_MODEL` (default `gpt-4o-mini`). The supported
conditions are a completed daily close above/below a fixed price and fast/slow
SMA crossovers. Scheduled fixed-price checks use the raw quoted close; SMA
crossovers use split- and dividend-adjusted closes. Each set runs on weekdays
at a New York time between 9:30 AM and 3:55 PM. Requests that cannot be
represented by this format are rejected.
The parser treats an unqualified fixed-dollar close threshold as raw. Explicit
adjusted-close dollar thresholds and raw-close SMA requests are rejected.
Fixed-price sets saved before this price-basis correction are marked **Reparse
required** and excluded from scheduled execution. Their original instructions
remain available in the UI so they can be parsed, inspected, and saved again.

For a saved set, **Preview current decision** reads the latest completed daily
bar, current position, open orders, market clock, and auto-trading setting to
show the action the scheduler would consider. The preview never submits an
order and can run while the set is disabled. The result is a snapshot; the
scheduled run checks these inputs again when it executes.

Use **Run historical rule backtest** in the inspector to simulate a draft or
saved set over the selected date range. It loads daily bars for every symbol,
shares one cash balance, evaluates the prior completed close, and fills at the
next trading day's open with the selected commission and slippage. Results show
the equity curve, positions, and fills; export JSON for the full ledger. Daily
bars cannot reproduce the exact scheduled intraday fill price, so the
simulation uses next-day adjusted open as its execution assumption. Historical
fixed-price checks require raw closes in the archive; an adjusted-only archive
produces a data error rather than changing threshold decisions. Early SMA signals require enough warmup bars before
the selected start date. Coverage notes flag
IPO and delisted histories; an open position whose symbol stops trading well
before the selected end date cannot be valued without a delisting outcome, so
the backtest stops with an error instead of carrying a stale quote forward.

The local and self-hosted launchers poll for due rules once per minute. The
Cloudflare Worker also declares a one-minute Cron Trigger. Runs are claimed
once per set and scheduled slot. Transient market-data or broker failures can
retry after one minute within the schedule's 15-minute window; completed and
permanently failed slots remain closed. Recent signal and order outcomes are
visible in the rule inspector. If an order response is lost, the engine checks
Alpaca by its client order ID before recording the result; the ID is shown in
the run log for manual reconciliation. Orders require Alpaca credentials and auto
trading enabled for the selected paper or live profile. Buy rules use their
specified USD notional; sell rules close the entire account position in the
symbol. The engine uses delayed SIP data for the last completed daily bar and
skips orders while the Alpaca market is closed.

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

For a stock archive on an external or network drive in Docker, set
`BACKTESTING_DATA_DIRECTORY` to its path on the host and set
`BACKTESTING_DATA_SOURCE=/app/backtesting_data` so the app reads the mounted
directory. For an online archive, set `BACKTESTING_DATA_SOURCE` to its HTTP(S)
base URL; the local mount is then unused. The host directory is mounted read-only
into the container, and deleting that directory removes the local archive.

For a managed MySQL service, set `MYSQL_URL` and run the built application with
`npm run start:mysql`; the MySQL bridge remains private inside the app process.

## Production safety

- `.openai/hosting.json` and the existing Sites project ID remain unchanged.
- The hosted site continues using D1; only local/self-hosted paths use MySQL.
- MySQL credentials and local environment values are ignored by Git.
- The local identity fallback is loopback-restricted.
- Automatic trading defaults to off.
