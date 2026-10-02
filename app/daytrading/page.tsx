import type { Metadata } from "next";
import { requireChatGPTUser } from "../chatgpt-auth";
import DayTradingClient from "./daytrading-client";
import "./daytrading.css";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Day Trading Lab — Pulse AI",description:"Learn, compose, backtest, and validate intraday trading systems over up to ten years of market data."};

export default async function DayTradingPage(){const user=await requireChatGPTUser("/daytrading");return <DayTradingClient displayName={user.displayName}/>;}
