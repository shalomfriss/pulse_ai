import { spawn } from "node:child_process";
import { resolve } from "node:path";

const processRef = spawn(resolve(".venv-finrl/bin/python"), [resolve("scripts/finrl-local.py")], {
  cwd: process.cwd(), stdio: "inherit", env: { ...process.env, FINRL_PORT: process.env.FINRL_PORT || "7072" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => processRef.kill(signal));
processRef.on("exit", (code) => process.exit(code ?? 0));
