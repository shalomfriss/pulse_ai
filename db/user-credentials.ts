import { database } from "./database";

export type UserCredentials = {
  keyId:string;
  secretKey:string;
  autoTrade:boolean;
  source:"stored"|"legacy";
};
export type AccountProfile = "paper"|"live";

export function accountProfile(value:unknown):AccountProfile { return value === "live" ? "live" : "paper"; }
export function alpacaTradingBaseUrl(profile:AccountProfile) { return profile === "live" ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets"; }

type StoredCredential = {
  alpaca_key_id_encrypted:string;
  alpaca_secret_key_encrypted:string;
  auto_trade:number;
  updated_at:string;
};

function normalizeEmail(email:string) { return email.trim().toLowerCase(); }

function ownerEnvironmentCredentials(email:string,profile:AccountProfile):UserCredentials|null {
  if (profile !== "paper") return null;
  const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL ?? "");
  const isOwner = Boolean(ownerEmail) && normalizeEmail(email) === ownerEmail;
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_API_SECRET_KEY;
  return isOwner && keyId && secretKey
    ? { keyId,secretKey,autoTrade:process.env.ALPACA_AUTO_TRADE === "true",source:"legacy" }
    : null;
}

async function encryptionKey() {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!secret || secret.length < 24) throw new Error("Credential encryption is not configured");
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw",digest,{ name:"AES-GCM" },false,["encrypt","decrypt"]);
}

function encode(bytes:Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value:string) {
  const binary = atob(value);
  return Uint8Array.from(binary,(character) => character.charCodeAt(0));
}

async function encrypt(value:string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name:"AES-GCM",iv },await encryptionKey(),new TextEncoder().encode(value));
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

async function decrypt(value:string) {
  const [iv,ciphertext] = value.split(".");
  if (!iv || !ciphertext) throw new Error("Stored credential is invalid");
  const plaintext = await crypto.subtle.decrypt({ name:"AES-GCM",iv:decode(iv) },await encryptionKey(),decode(ciphertext));
  return new TextDecoder().decode(plaintext);
}

async function storedCredential(email:string,profile:AccountProfile) {
  return database().prepare(`SELECT alpaca_key_id_encrypted, alpaca_secret_key_encrypted, auto_trade, updated_at
    FROM user_credentials WHERE user_email = ?1 AND account_profile = ?2`).bind(normalizeEmail(email),profile).first<StoredCredential>();
}

export async function getUserCredentials(email:string,profile:AccountProfile="paper"):Promise<UserCredentials|null> {
  const ownerCredentials = ownerEnvironmentCredentials(email,profile);
  if (ownerCredentials) return ownerCredentials;
  const stored = await storedCredential(email,profile);
  if (stored) return {
    keyId:await decrypt(stored.alpaca_key_id_encrypted),
    secretKey:await decrypt(stored.alpaca_secret_key_encrypted),
    autoTrade:Boolean(stored.auto_trade),
    source:"stored",
  };
  return null;
}

export async function getCredentialSummary(email:string,profile:AccountProfile="paper") {
  const ownerCredentials = ownerEnvironmentCredentials(email,profile);
  if (ownerCredentials) return { configured:true,keyHint:"OWNER ENVIRONMENT",autoTrade:ownerCredentials.autoTrade,source:"legacy" as const,updatedAt:null };
  const stored = await storedCredential(email,profile);
  if (stored) {
    const keyId = await decrypt(stored.alpaca_key_id_encrypted);
    return { configured:true,keyHint:keyId.length > 6 ? `${keyId.slice(0,3)}•••${keyId.slice(-3)}` : "••••••",autoTrade:Boolean(stored.auto_trade),source:"stored" as const,updatedAt:stored.updated_at };
  }
  return { configured:false,keyHint:null,autoTrade:false,source:"none" as const,updatedAt:null };
}

export async function getCredentialSummaries(email:string) {
  return { paper:await getCredentialSummary(email,"paper"),live:await getCredentialSummary(email,"live") };
}

export async function saveUserCredentials(email:string,profile:AccountProfile,input:{ keyId?:string;secretKey?:string;autoTrade:boolean }) {
  if (ownerEnvironmentCredentials(email,profile)) throw new Error("Owner credentials are managed only through the hosted environment variables");
  const existing = await storedCredential(email,profile);
  const hasNewPair = Boolean(input.keyId?.trim() || input.secretKey?.trim());
  if (hasNewPair && (!input.keyId?.trim() || !input.secretKey?.trim())) throw new Error("Both Alpaca credentials are required");
  if (!existing && !hasNewPair) throw new Error("Enter both Alpaca credentials to finish setup");
  const now = new Date().toISOString();
  const keyEncrypted = hasNewPair ? await encrypt(input.keyId!.trim()) : existing!.alpaca_key_id_encrypted;
  const secretEncrypted = hasNewPair ? await encrypt(input.secretKey!.trim()) : existing!.alpaca_secret_key_encrypted;
  await database().prepare(`INSERT INTO user_credentials
    (user_email, account_profile, alpaca_key_id_encrypted, alpaca_secret_key_encrypted, auto_trade, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    ON CONFLICT(user_email,account_profile) DO UPDATE SET alpaca_key_id_encrypted = excluded.alpaca_key_id_encrypted,
      alpaca_secret_key_encrypted = excluded.alpaca_secret_key_encrypted, auto_trade = excluded.auto_trade, updated_at = excluded.updated_at`)
    .bind(normalizeEmail(email),profile,keyEncrypted,secretEncrypted,input.autoTrade ? 1 : 0,now).run();
  return getCredentialSummary(email,profile);
}
