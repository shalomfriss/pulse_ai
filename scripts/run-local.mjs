import { spawn, spawnSync } from "node:child_process";
import { loadLocalEnvironment } from "./mysql-support.mjs";
import { startProjectMySql } from "./mysql-local-server.mjs";

loadLocalEnvironment();
const managed = process.env.LOCAL_MYSQL_MANAGED !== "false";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

let localMySqlProcess = null;
if (managed) {
  const dockerReady = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
  if (dockerReady) run("docker", ["compose", "-f", "docker-compose.mysql.yml", "up", "-d"]);
  else localMySqlProcess = await startProjectMySql();
}
run(process.execPath, ["scripts/mysql-migrate.mjs"]);

const environment = {
  ...process.env,
  LOCAL_MYSQL_PROXY_URL: process.env.LOCAL_MYSQL_PROXY_URL || "http://127.0.0.1:8789",
};
const bridge = spawn(process.execPath, ["scripts/mysql-bridge.mjs"], {
  stdio: "inherit",
  env: environment,
});
const kronos = spawn(process.execPath, ["scripts/kronos-local.mjs"], {
  stdio: "inherit",
  env: environment,
});
const finrl = spawn(process.execPath, ["scripts/finrl-local.mjs"], {
  stdio: "inherit",
  env: environment,
});
const app = spawn("npm", ["run", "dev"], { stdio: "inherit", env: environment });

function stop(signal = "SIGTERM") {
  bridge.kill(signal);
  kronos.kill(signal);
  finrl.kill(signal);
  app.kill(signal);
  localMySqlProcess?.kill(signal);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}
app.on("exit", (code) => {
  bridge.kill("SIGTERM");
  kronos.kill("SIGTERM");
  finrl.kill("SIGTERM");
  process.exit(code ?? 0);
});
bridge.on("exit", (code) => {
  if (code) {
    kronos.kill("SIGTERM");
    finrl.kill("SIGTERM");
    app.kill("SIGTERM");
    process.exit(code);
  }
});
kronos.on("exit", (code) => {
  if (code) {
    bridge.kill("SIGTERM");
    finrl.kill("SIGTERM");
    app.kill("SIGTERM");
    process.exit(code);
  }
});
finrl.on("exit", (code) => {
  if (code) {
    bridge.kill("SIGTERM");
    kronos.kill("SIGTERM");
    app.kill("SIGTERM");
    process.exit(code);
  }
});
