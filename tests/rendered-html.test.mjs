import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("keeps the existing Sites deployment configuration intact", async () => {
  const hosting = JSON.parse(await source(".openai/hosting.json"));
  assert.deepEqual(hosting, {
    project_id: "appgprj_6a59037f2d64819199900b20b383529d",
    d1: "DB",
    r2: null,
  });
});

test("provides an isolated local MySQL workflow", async () => {
  const [packageJsonText, compose, schema, viteConfig, envExample] =
    await Promise.all([
      source("package.json"),
      source("docker-compose.mysql.yml"),
      source("mysql/schema.sql"),
      source("vite.config.ts"),
      source(".env.example"),
    ]);
  const packageJson = JSON.parse(packageJsonText);

  assert.match(packageJson.scripts.local, /run-local/);
  assert.match(packageJson.devDependencies.mysql2, /^3\./);
  assert.match(compose, /mysql:8\.4/);
  assert.match(compose, /127\.0\.0\.1:3307:3306/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_credentials/);
  assert.match(viteConfig, /d1_databases: \[\]/);
  assert.match(envExample, /MYSQL_URL=mysql:/);
  assert.match(envExample, /LOCAL_DEV_USER_EMAIL=/);
  assert.match(envExample, /ALPACA_AUTO_TRADE=false/);
});

test("limits the local identity fallback to loopback hosts", async () => {
  const auth = await source("app/chatgpt-auth.ts");

  assert.match(auth, /LOCAL_DEV_USER_EMAIL/);
  assert.match(auth, /host === "localhost"/);
  assert.match(auth, /host === "127\.0\.0\.1"/);
  assert.match(auth, /host === "\[::1\]"/);
  assert.match(auth, /if \(!isLocalRequest \|\| !email\) return null/);
});

test("translates D1-style parameters and upserts for MySQL", async () => {
  const { mysqlQuery } = await import("../scripts/mysql-support.mjs");
  const query = mysqlQuery(
    "INSERT INTO user_strategy_settings (user_email,paused) VALUES (?1,?2) ON CONFLICT(user_email) DO UPDATE SET paused = excluded.paused",
    ["local@pulse-ai.test", 1],
  );

  assert.equal(
    query.sql,
    "INSERT INTO user_strategy_settings (user_email,paused) VALUES (?,?) ON DUPLICATE KEY UPDATE paused = VALUES(paused)",
  );
  assert.deepEqual(query.params, ["local@pulse-ai.test", 1]);

  const repeated = mysqlQuery("VALUES (?1, ?2, ?2)", ["email", "paper"]);
  assert.equal(repeated.sql, "VALUES (?, ?, ?)");
  assert.deepEqual(repeated.params, ["email", "paper", "paper"]);
});

test("keeps MySQL database batches transactional and queries portable", async () => {
  const [database, bridge, strategyState] = await Promise.all([
    source("db/database.ts"),
    source("scripts/mysql-bridge.mjs"),
    source("db/strategy-state.ts"),
  ]);

  assert.match(database, /fetch\(`\$\{this\.proxyUrl\}\/batch`/);
  assert.match(bridge, /beginTransaction\(\)/);
  assert.match(bridge, /connection\.commit\(\)/);
  assert.match(bridge, /connection\.rollback\(\)/);
  assert.match(strategyState, /\) AS ranked WHERE history_rank<=80/);
});

test("adds the Medallion ensemble with cash-only long-equity guardrails", async () => {
  const [strategyRoute, page, strategyState, positions, transactions] = await Promise.all([
    source("app/api/strategies/route.ts"),
    source("app/page.tsx"),
    source("db/strategy-state.ts"),
    source("app/api/positions/route.ts"),
    source("app/api/transactions/route.ts"),
  ]);

  for (const text of [strategyRoute, page, strategyState, positions]) assert.match(text, /medallion/i);
  assert.match(transactions, /medal/);
  assert.match(strategyRoute, /Math\.min\(totalAllocation,cash\)/);
  assert.doesNotMatch(strategyRoute, /Math\.min\(totalAllocation,cash,buyingPower\)/);
  assert.match(strategyRoute, /item\.assetClass!=="option"/);
  assert.match(strategyRoute, /position_intent:"sell_to_close"/);
  assert.doesNotMatch(strategyRoute, /position_intent:qty>0\?"sell_to_close":"buy_to_close"/);
  assert.match(page, /Renaissance’s actual Medallion Fund methods are proprietary/);
});
