import { requireChatGPTUser } from "../chatgpt-auth";
import CompanyAnalysisClient from "./company-analysis-client";

export default async function CompanyAnalysisPage() {
  const user = await requireChatGPTUser("/company-analysis");
  return <CompanyAnalysisClient displayName={user.displayName} />;
}
