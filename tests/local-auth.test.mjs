import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("local auth schema stores registered users and database-backed sessions", async () => {
  const [mysqlSchema, drizzleSchema] = await Promise.all([
    source("mysql/schema.sql"),
    source("db/schema.ts"),
  ]);

  assert.match(mysqlSchema, /CREATE TABLE IF NOT EXISTS local_users/);
  assert.match(mysqlSchema, /password_hash VARCHAR\(128\) NOT NULL/);
  assert.match(mysqlSchema, /CREATE TABLE IF NOT EXISTS local_sessions/);
  assert.match(mysqlSchema, /session_token_hash VARCHAR\(64\) NOT NULL/);
  assert.match(mysqlSchema, /FOREIGN KEY \(user_email\) REFERENCES local_users\(email\)/);

  assert.match(drizzleSchema, /localUsers/);
  assert.match(drizzleSchema, /localSessions/);
});

test("local auth uses password hashing and http-only session cookies", async () => {
  const [auth, loginRoute, registerRoute, logoutRoute, settingsRoute] = await Promise.all([
    source("db/local-auth.ts"),
    source("app/api/auth/login/route.ts"),
    source("app/api/auth/register/route.ts"),
    source("app/api/auth/logout/route.ts"),
    source("app/api/settings/route.ts"),
  ]);

  assert.match(auth, /PBKDF2/);
  assert.match(auth, /SESSION_COOKIE = "pulse_session"/);
  assert.match(auth, /password_hash/);
  assert.match(auth, /local_sessions/);
  assert.match(auth, /httpOnly:true/);
  assert.match(auth, /sameSite:"lax"/);
  assert.match(loginRoute, /authenticateLocalUser/);
  assert.match(registerRoute, /registerLocalUser/);
  assert.match(logoutRoute, /destroyLocalSession/);
  assert.match(settingsRoute, /getChatGPTUser/);
});

test("landing page exposes local login and registration instead of ChatGPT sign-in", async () => {
  const page = await source("app/page.tsx");

  assert.match(page, /LocalAuthGate/);
  assert.match(page, /api\/auth\/login/);
  assert.match(page, /api\/auth\/register/);
  assert.match(page, /CREATE ACCOUNT/);
  assert.doesNotMatch(page, /SIGN IN WITH CHATGPT/);
  assert.doesNotMatch(page, /signin-with-chatgpt\?return_to/);
});
