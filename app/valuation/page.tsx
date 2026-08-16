import { requireChatGPTUser } from "../chatgpt-auth";
import CompanyAnalysisClient from "../company-analysis/company-analysis-client";

export default async function ValuationPage() {
  const user = await requireChatGPTUser("/valuation");
  return <CompanyAnalysisClient displayName={user.displayName} activeNav="valuation" />;
}
