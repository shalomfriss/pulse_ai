import { getChatGPTUser } from "../../chatgpt-auth";
import { accountProfile, alpacaTradingBaseUrl, getCredentialSummaries, saveUserCredentials } from "../../../db/user-credentials";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  try {
    return Response.json({ user:{ email:user.email,displayName:user.displayName },profiles:await getCredentialSummaries(user.email) });
  } catch {
    return Response.json({ error:"Secure credential storage is unavailable" },{ status:503 });
  }
}

export async function PUT(request:Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error:"Sign in required" },{ status:401 });
  const body = await request.json().catch(() => ({})) as { profile?:string;keyId?:string;secretKey?:string;autoTrade?:boolean };
  const profile = accountProfile(body.profile);
  const keyId = body.keyId?.trim();
  const secretKey = body.secretKey?.trim();
  if (keyId || secretKey) {
    if (!keyId || !secretKey) return Response.json({ error:"Enter both the Alpaca API key ID and secret key." },{ status:400 });
    try {
      const validation = await fetch(`${alpacaTradingBaseUrl(profile)}/v2/account`,{ headers:{ "APCA-API-KEY-ID":keyId,"APCA-API-SECRET-KEY":secretKey } });
      if (!validation.ok) return Response.json({ error:`Alpaca rejected these ${profile}-account credentials.` },{ status:400 });
    } catch {
      return Response.json({ error:"Alpaca could not be reached to verify the credentials." },{ status:502 });
    }
  }
  try {
    await saveUserCredentials(user.email,profile,{ keyId,secretKey,autoTrade:Boolean(body.autoTrade) });
    return Response.json({ user:{ email:user.email,displayName:user.displayName },profiles:await getCredentialSummaries(user.email) });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Settings could not be saved" },{ status:400 });
  }
}
