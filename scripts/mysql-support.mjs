import mysql from "mysql2/promise";

export const defaultMySqlUrl =
  "mysql://pulse:pulse-local-password@127.0.0.1:3307/pulse_ai";

export function loadLocalEnvironment() {
  try {
    process.loadEnvFile?.(".env.local");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function mysqlUrl() {
  return process.env.MYSQL_URL || defaultMySqlUrl;
}

export function mysqlConfig() {
  const url = new URL(mysqlUrl());
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}

export async function connectWithRetry(attempts = 40) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await mysql.createConnection({ ...mysqlConfig(), multipleStatements: true });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

export function mysqlQuery(sql, params) {
  const indexes = [];
  const translatedSql = sql
    .replace(/\?(\d+)/g, (_match, index) => {
      indexes.push(Number(index) - 1);
      return "?";
    })
    .replace(/ON CONFLICT\s*\([^)]+\)\s*DO UPDATE SET/gi, "ON DUPLICATE KEY UPDATE")
    .replace(/excluded\.([a-z_]+)/gi, "VALUES($1)");
  return {
    sql: translatedSql,
    params: indexes.length ? indexes.map((index) => params[index]) : params,
  };
}
