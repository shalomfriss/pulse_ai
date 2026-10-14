import { cookies } from "next/headers";
import { database } from "./database";

export type LocalAuthUser = {
  email:string;
  displayName:string;
  fullName:string | null;
};

type StoredLocalUser = {
  email:string;
  display_name:string;
  password_hash:string;
  password_salt:string;
};

type StoredLocalSession = {
  user_email:string;
  display_name:string;
  expires_at:string;
};

export const SESSION_COOKIE = "pulse_session";
const PASSWORD_ITERATIONS = 210_000;
const SESSION_DAYS = 30;

function normalizeEmail(email:string) { return email.trim().toLowerCase(); }
function cleanDisplayName(displayName:string,email:string) { return displayName.trim() || email; }
function base64(bytes:Uint8Array) { let binary="";for (const byte of bytes) binary+=String.fromCharCode(byte);return btoa(binary); }
function bytesFromBase64(value:string) { const binary=atob(value);return Uint8Array.from(binary,(character)=>character.charCodeAt(0)); }
function hex(bytes:Uint8Array) { return [...bytes].map((byte)=>byte.toString(16).padStart(2,"0")).join(""); }
function timingSafeEqual(left:string,right:string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index=0;index<left.length;index+=1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function sha256Hex(value:string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))));
}

async function passwordHash(password:string,salt:string) {
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2",hash:"SHA-256",salt:bytesFromBase64(salt),iterations:PASSWORD_ITERATIONS },key,256);
  return hex(new Uint8Array(bits));
}

function validatePassword(password:string) {
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
}

async function userAccountPayload(email:string) {
  const user = await database().prepare("SELECT email, display_name FROM local_users WHERE email = ?1").bind(normalizeEmail(email)).first<{ email:string;display_name:string }>();
  if (!user) throw new Error("Account was not found");
  return { email:user.email,displayName:user.display_name,fullName:user.display_name };
}

export async function registerLocalUser(input:{ email?:string;displayName?:string;password?:string }) {
  const email = normalizeEmail(input.email ?? "");
  if (!email || !email.includes("@")) throw new Error("Enter a valid email address.");
  const password = input.password ?? "";
  validatePassword(password);
  const existing = await database().prepare("SELECT email FROM local_users WHERE email = ?1").bind(email).first<{ email:string }>();
  if (existing) throw new Error("An account already exists for that email.");
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = base64(saltBytes);
  const hash = await passwordHash(password,salt);
  const now = new Date().toISOString();
  await database().prepare(`INSERT INTO local_users (email,display_name,password_hash,password_salt,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?5)`).bind(email,cleanDisplayName(input.displayName ?? "",email),hash,salt,now).run();
  return userAccountPayload(email);
}

export async function authenticateLocalUser(input:{ email?:string;password?:string }) {
  const email = normalizeEmail(input.email ?? "");
  const password = input.password ?? "";
  const user = await database().prepare("SELECT email,display_name,password_hash,password_salt FROM local_users WHERE email = ?1").bind(email).first<StoredLocalUser>();
  if (!user) throw new Error("Invalid email or password.");
  const hash = await passwordHash(password,user.password_salt);
  if (!timingSafeEqual(hash,user.password_hash)) throw new Error("Invalid email or password.");
  return { email:user.email,displayName:user.display_name,fullName:user.display_name };
}

export async function createLocalSession(email:string) {
  const token = base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("/","_").replaceAll("+","-").replaceAll("=","");
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime()+SESSION_DAYS*24*60*60*1000);
  await database().prepare(`INSERT INTO local_sessions (session_token_hash,user_email,expires_at,created_at)
    VALUES (?1,?2,?3,?4)`).bind(tokenHash,normalizeEmail(email),expires.toISOString(),now.toISOString()).run();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE,token,{ httpOnly:true,sameSite:"lax",secure:false,path:"/",expires });
}

export async function getLocalSessionUser():Promise<LocalAuthUser|null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await database().prepare(`SELECT local_sessions.user_email, local_users.display_name, local_sessions.expires_at
    FROM local_sessions INNER JOIN local_users ON local_users.email = local_sessions.user_email
    WHERE local_sessions.session_token_hash = ?1`).bind(tokenHash).first<StoredLocalSession>();
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) { await destroyLocalSession();return null; }
  return { email:session.user_email,displayName:session.display_name,fullName:session.display_name };
}

export async function destroyLocalSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await database().prepare("DELETE FROM local_sessions WHERE session_token_hash = ?1").bind(await sha256Hex(token)).run();
  cookieStore.set(SESSION_COOKIE,"",{ httpOnly:true,sameSite:"lax",secure:false,path:"/",expires:new Date(0) });
}
