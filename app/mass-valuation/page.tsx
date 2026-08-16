import { requireChatGPTUser } from "../chatgpt-auth";
import CompanyAnalysisClient from "../company-analysis/company-analysis-client";

export default async function MassValuationPage() {
  const user = await requireChatGPTUser("/mass-valuation");
  return <CompanyAnalysisClient displayName={user.displayName} activeNav="mass" />;
}
