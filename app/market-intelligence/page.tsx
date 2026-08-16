import { requireChatGPTUser } from "../chatgpt-auth";
import MarketIntelligenceClient from "./market-intelligence-client";

export default async function MarketIntelligencePage() {
  const user = await requireChatGPTUser("/market-intelligence");
  return <MarketIntelligenceClient displayName={user.displayName} />;
}
