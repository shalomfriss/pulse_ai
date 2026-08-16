import { requireChatGPTUser } from "../chatgpt-auth";
import SettingsClient from "./settings-client";

export default async function SettingsPage() {
  const user = await requireChatGPTUser("/settings");
  return <SettingsClient displayName={user.displayName} email={user.email} />;
}
