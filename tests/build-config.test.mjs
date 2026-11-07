import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production build contains no local environment bindings and retains its scheduler",async()=>{
  const config=JSON.parse(await readFile(new URL("../dist/server/wrangler.json",import.meta.url),"utf8"));
  assert.deepEqual(config.vars,{});
  assert.deepEqual(config.triggers?.crons,["* * * * *"]);
});
