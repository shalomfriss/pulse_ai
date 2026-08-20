import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve("vendor/Kronos");
const python = resolve(".venv-kronos/bin/python");
const webui = resolve(root, "webui");

const kronos = spawn(python, ["app.py"], {
  cwd: webui,
  stdio: "inherit",
  env: { ...process.env, KRONOS_PORT: process.env.KRONOS_PORT || "7070" },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => kronos.kill(signal));
}

kronos.on("exit", (code) => process.exit(code ?? 0));
