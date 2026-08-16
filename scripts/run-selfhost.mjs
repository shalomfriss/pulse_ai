import { spawn, spawnSync } from "node:child_process";
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
};
const bridge = spawn(process.execPath, ["scripts/mysql-bridge.mjs"], {
  stdio: "inherit",
  env: environment,
});
const app = spawn("npm", ["run", "start"], { stdio: "inherit", env: environment });

function stop(signal = "SIGTERM") {
  bridge.kill(signal);
  app.kill(signal);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(signal));
app.on("exit", (code) => {
  bridge.kill("SIGTERM");
  process.exit(code ?? 0);
});
bridge.on("exit", (code) => {
  if (code) {
    app.kill("SIGTERM");
    process.exit(code);
  }
});
