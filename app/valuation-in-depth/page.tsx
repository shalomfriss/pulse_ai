import { requireChatGPTUser } from "../chatgpt-auth";
import ValuationDepthClient from "./valuation-depth-client";

export default async function ValuationInDepthPage() {
  const user = await requireChatGPTUser("/valuation-in-depth");
  return <ValuationDepthClient displayName={user.displayName} />;
}
