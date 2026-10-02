import type { Metadata } from "next";
import { requireChatGPTUser } from "../chatgpt-auth";
import TopbarNav from "../topbar-nav";
import "./finrl.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FinRL — Pulse AI", description: "Local FinRL financial reinforcement-learning workbench." };

export default async function FinRLPage() {
  await requireChatGPTUser("/finrl");
  return <main className="finrl-shell"><header className="finrl-header"><a className="brand" href="/command-center" aria-label="Pulse command center"><span className="brand-mark">P</span><span>PULSE<span className="brand-dot">•</span>AI</span></a><TopbarNav activeHref="/finrl"/><span className="finrl-badge">LOCAL RESEARCH MODE</span></header><iframe className="finrl-frame" src="http://localhost:7072" title="FinRL local reinforcement learning workbench" /></main>;
}
