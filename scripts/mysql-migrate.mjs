import { readFile } from "node:fs/promises";
import { connectWithRetry, loadLocalEnvironment } from "./mysql-support.mjs";

loadLocalEnvironment();
const connection = await connectWithRetry();
try {
  const schema = await readFile(new URL("../mysql/schema.sql", import.meta.url), "utf8");
  await connection.query(schema);
  console.log("Local MySQL schema is ready.");
} finally {
  await connection.end();
}
