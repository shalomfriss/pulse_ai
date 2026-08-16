import { createServer } from "node:http";
import mysql from "mysql2/promise";
import { loadLocalEnvironment, mysqlConfig, mysqlQuery } from "./mysql-support.mjs";

loadLocalEnvironment();
const pool = mysql.createPool({ ...mysqlConfig(), connectionLimit: 8 });
const host = process.env.MYSQL_BRIDGE_HOST || "127.0.0.1";
const port = Number(process.env.MYSQL_BRIDGE_PORT || 8789);

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.method === "GET" && request.url === "/health") {
    await pool.query("SELECT 1");
    response.end(JSON.stringify({ ok: true, database: "mysql" }));
    return;
  }
  if (request.method !== "POST" || !["/query", "/batch"].includes(request.url)) {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (request.url === "/batch") {
      if (!Array.isArray(body.queries)) throw new Error("Invalid batch payload");
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const results = [];
        for (const item of body.queries) {
          if (typeof item.sql !== "string" || !Array.isArray(item.params)) {
            throw new Error("Invalid query payload in batch");
          }
          const query = mysqlQuery(item.sql, item.params);
          const [rows] = await connection.execute(query.sql, query.params);
          results.push({ success: true, meta: { changes: rows.affectedRows ?? 0 } });
        }
        await connection.commit();
        response.end(JSON.stringify({ results }));
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      return;
    }

    if (typeof body.sql !== "string" || !Array.isArray(body.params)) {
      throw new Error("Invalid query payload");
    }
    const query = mysqlQuery(body.sql, body.params);
    const [rows] = await pool.execute(query.sql, query.params);
    if (body.mode === "first") {
      response.end(JSON.stringify(Array.isArray(rows) ? rows[0] ?? null : null));
    } else if (body.mode === "all") {
      response.end(JSON.stringify({ results: Array.isArray(rows) ? rows : [] }));
    } else {
      response.end(JSON.stringify({ success: true, meta: { changes: rows.affectedRows ?? 0 } }));
    }
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Query failed" }));
  }
});

server.listen(port, host, () => {
  console.log(`Local MySQL bridge listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => pool.end().finally(() => process.exit(0))));
}
