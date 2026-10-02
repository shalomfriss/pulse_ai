import type { Metadata } from "next";
import { requireChatGPTUser } from "../chatgpt-auth";
import BacktestingClient from "./backtesting-client";
import "./backtesting.css";

export const dynamic = "force-dynamic";
export const metadata:Metadata={ title:"Backtesting — Pulse AI",description:"Compile historical market data and evaluate transparent trading strategies with realistic costs." };

export default async function BacktestingPage() {
  const user=await requireChatGPTUser("/backtesting");
  return <BacktestingClient displayName={user.displayName} />;
}
