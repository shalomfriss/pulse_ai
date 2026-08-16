import { mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function startProjectMySql() {
  const lookup = spawnSync("sh", ["-c", "command -v mysqld"], { encoding: "utf8" });
  const mysqld = lookup.stdout?.trim();
  if (!mysqld) throw new Error("Docker is unavailable and no local mysqld executable was found");

  const root = resolve(".mysql-local");
  const data = resolve(root, "data");
  await mkdir(root, { recursive: true });
  const basedir = dirname(dirname(mysqld));
  if (!(await exists(resolve(data, "mysql")))) {
    await mkdir(data, { recursive: true });
    const initialization = spawnSync(
      mysqld,
      ["--initialize-insecure", `--basedir=${basedir}`, `--datadir=${data}`],
      { stdio: "inherit" },
    );
    if (initialization.status !== 0) throw new Error("Could not initialize local MySQL");
  }

  const server = spawn(
    mysqld,
    [
      `--basedir=${basedir}`,
      `--datadir=${data}`,
      "--port=3307",
      "--bind-address=127.0.0.1",
      `--socket=/tmp/pulse-ai-mysql-${process.pid}.sock`,
      `--pid-file=${resolve(root, "mysql.pid")}`,
      `--log-error=${resolve(root, "mysql.log")}`,
    ],
    { stdio: "ignore" },
  );

  let connection;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      connection = await mysql.createConnection({ host: "127.0.0.1", port: 3307, user: "root" });
      break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  if (!connection) {
    server.kill("SIGTERM");
    throw new Error(`Local MySQL did not start; see ${resolve(root, "mysql.log")}`);
  }

  try {
    await connection.query("CREATE DATABASE IF NOT EXISTS pulse_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    await connection.query("CREATE USER IF NOT EXISTS 'pulse'@'%' IDENTIFIED BY 'pulse-local-password'");
    await connection.query("ALTER USER 'pulse'@'%' IDENTIFIED BY 'pulse-local-password'");
    await connection.query("GRANT ALL PRIVILEGES ON pulse_ai.* TO 'pulse'@'%'");
  } finally {
    await connection.end();
  }
  console.log("Using project-local MySQL because Docker is unavailable.");
  return server;
}
