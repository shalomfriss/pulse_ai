import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { loadLocalEnvironment } from "./mysql-support.mjs";

loadLocalEnvironment();
const migrate = spawnSync(process.execPath, ["scripts/mysql-migrate.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const environment = {
  ...process.env,
  LOCAL_MYSQL_PROXY_URL: process.env.LOCAL_MYSQL_PROXY_URL || "http://127.0.0.1:8789",
  RULE_SCHEDULER_SECRET: process.env.RULE_SCHEDULER_SECRET || randomBytes(32).toString("hex"),
};
const dataSource = environment.BACKTESTING_DATA_SOURCE || "backtesting_data";
const localData = !/^https?:\/\//i.test(dataSource);
if (localData) {
  environment.BACKTESTING_DATA_DIRECTORY = dataSource;
  environment.BACKTESTING_DATA_SOURCE = `http://127.0.0.1:${environment.BACKTESTING_DATA_PORT || 8790}/`;
}
const dataServer = localData ? spawn(process.execPath, ["scripts/backtesting-data-server.mjs"], { stdio:"inherit", env:environment }) : null;
const bridge = spawn(process.execPath, ["scripts/mysql-bridge.mjs"], {
  stdio: "inherit",
  env: environment,
});
const app = spawn("npm", ["run", "start"], { stdio: "inherit", env: environment });
const ruleScheduler = spawn(process.execPath,["scripts/rule-scheduler.mjs"],{stdio:"inherit",env:environment});

function stop(signal = "SIGTERM") {
  ruleScheduler.kill(signal);
  dataServer?.kill(signal);
  bridge.kill(signal);
  app.kill(signal);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(signal));
app.on("exit", (code) => {
  ruleScheduler.kill("SIGTERM");
  dataServer?.kill("SIGTERM");
  bridge.kill("SIGTERM");
  process.exit(code ?? 0);
});
bridge.on("exit", (code) => {
  if (code) {
    ruleScheduler.kill("SIGTERM");
    dataServer?.kill("SIGTERM");
    app.kill("SIGTERM");
    process.exit(code);
  }
});
dataServer?.on("exit", (code) => {
  if (code) {
    ruleScheduler.kill("SIGTERM");
    bridge.kill("SIGTERM");
    app.kill("SIGTERM");
    process.exit(code);
  }
});
