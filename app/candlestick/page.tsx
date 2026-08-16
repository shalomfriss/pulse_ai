import type { Metadata } from "next";
import { requireChatGPTUser } from "../chatgpt-auth";
import CandlestickClient from "./candlestick-client";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Candlestick Charts — Pulse AI",description:"Interactive daily candlestick charts with trend context, moving averages, volume, pattern reading, and a practical buy/sell risk framework.",openGraph:{title:"Pulse AI — Candlestick Charts",description:"Read price action candle by candle, then turn patterns, trend, volume, and risk into a disciplined decision process.",images:[{url:"/og-candlestick.png",width:1536,height:1024,alt:"Pulse AI candlestick chart learning workspace"}]},twitter:{card:"summary_large_image",images:["/og-candlestick.png"]}};
export default async function CandlestickPage(){const user=await requireChatGPTUser("/candlestick");return <CandlestickClient displayName={user.displayName}/>;}
