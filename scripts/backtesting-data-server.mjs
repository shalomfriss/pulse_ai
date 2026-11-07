import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(process.env.BACKTESTING_DATA_DIRECTORY || "backtesting_data");
const port = Number(process.env.BACKTESTING_DATA_PORT || 8790);
const symbolPattern = /^[A-Z][A-Z0-9.-]{0,9}$/;
const timeframes = new Set(["1Day", "1Hour", "15Min", "5Min"]);

createServer(async (request, response) => {
  const match = /^\/v1\/history\/([A-Z0-9.-]+)\/(1Day|1Hour|15Min|5Min)\.json$/.exec(request.url || "");
  if (request.method !== "GET" || !match || !symbolPattern.test(match[1]) || !timeframes.has(match[2])) {
    response.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(join(root, `${match[1]}.${match[2]}.json`));
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(data);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Backtesting data: ${root} on 127.0.0.1:${port}`);
});
