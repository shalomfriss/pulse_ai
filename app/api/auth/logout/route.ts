import { destroyLocalSession } from "../../../../db/local-auth";

export async function POST() {
  await destroyLocalSession();
  return Response.json({ ok:true });
}
