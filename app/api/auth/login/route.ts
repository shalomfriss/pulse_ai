import { authenticateLocalUser, createLocalSession } from "../../../../db/local-auth";
import { getCredentialSummaries } from "../../../../db/user-credentials";

export async function POST(request:Request) {
  const body = await request.json().catch(() => ({})) as { email?:string;password?:string };
  try {
    const user = await authenticateLocalUser(body);
    await createLocalSession(user.email);
    return Response.json({ user:{ email:user.email,displayName:user.displayName },profiles:await getCredentialSummaries(user.email) });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Sign in failed" },{ status:401 });
  }
}
