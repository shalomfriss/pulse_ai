import type { AccountProfile } from "./user-credentials";
import { database } from "./database";

export const STRATEGY_IDS = ["momentum","quality-value","earnings-drift","short-reversal","news-catalyst","intraday","opening-range","vwap","gap","squeeze","closing","order-flow","medallion"] as const;

function emailKey(email:string) { return email.trim().toLowerCase(); }

export async function getPausedStrategies(email:string,profile:AccountProfile="paper"):Promise<Set<string>> {
  const result=await database().prepare("SELECT strategy_id FROM user_strategy_settings WHERE user_email = ?1 AND account_profile = ?2 AND paused = 1").bind(emailKey(email),profile).all<{ strategy_id:string }>();
  return new Set(result.results.map((row) => row.strategy_id));
}

export async function setStrategyPaused(email:string,profile:AccountProfile,strategyId:string,paused:boolean) {
  if (!(STRATEGY_IDS as readonly string[]).includes(strategyId)) throw new Error("Unknown strategy");
  const updatedAt=new Date().toISOString();
  await database().prepare(`INSERT INTO user_strategy_settings (user_email,account_profile,strategy_id,paused,updated_at)
    VALUES (?1,?2,?3,?4,?5) ON CONFLICT(user_email,account_profile,strategy_id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`)
    .bind(emailKey(email),profile,strategyId,paused?1:0,updatedAt).run();
  return { profile,strategyId,paused,updatedAt };
}

export async function recordStrategyPerformance(email:string,profile:AccountProfile,points:{ strategyId:string;equity:number;totalPnl:number;realizedPnl:number;unrealizedPnl:number }[]) {
  const now=new Date();now.setUTCMinutes(Math.floor(now.getUTCMinutes()/15)*15,0,0);const recordedAt=now.toISOString();const db=database();
  await db.batch(points.map((point) => db.prepare(`INSERT INTO strategy_performance
    (user_email,account_profile,strategy_id,recorded_at,equity,total_pnl,realized_pnl,unrealized_pnl) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
    ON CONFLICT(user_email,account_profile,strategy_id,recorded_at) DO UPDATE SET equity=excluded.equity,total_pnl=excluded.total_pnl,realized_pnl=excluded.realized_pnl,unrealized_pnl=excluded.unrealized_pnl`)
    .bind(emailKey(email),profile,point.strategyId,recordedAt,point.equity,point.totalPnl,point.realizedPnl,point.unrealizedPnl)));
}

export async function getStrategyPerformance(email:string,profile:AccountProfile,strategyId:string) {
  if (!(STRATEGY_IDS as readonly string[]).includes(strategyId)) throw new Error("Unknown strategy");
  const result=await database().prepare(`SELECT recorded_at,equity,total_pnl,realized_pnl,unrealized_pnl FROM strategy_performance
    WHERE user_email=?1 AND account_profile=?2 AND strategy_id=?3 ORDER BY recorded_at DESC LIMIT 35041`).bind(emailKey(email),profile,strategyId).all<{ recorded_at:string;equity:number;total_pnl:number;realized_pnl:number;unrealized_pnl:number }>();
  return result.results.reverse().map((row) => ({ recordedAt:row.recorded_at,equity:row.equity,totalPnl:row.total_pnl,realizedPnl:row.realized_pnl,unrealizedPnl:row.unrealized_pnl }));
}

export async function getAllStrategyPerformance(email:string,profile:AccountProfile) {
  const result=await database().prepare(`SELECT strategy_id,recorded_at,equity,total_pnl,realized_pnl,unrealized_pnl FROM (
    SELECT strategy_id,recorded_at,equity,total_pnl,realized_pnl,unrealized_pnl,
      ROW_NUMBER() OVER (PARTITION BY strategy_id ORDER BY recorded_at DESC) AS history_rank
    FROM strategy_performance WHERE user_email=?1 AND account_profile=?2
  ) AS ranked WHERE history_rank<=80 ORDER BY strategy_id,recorded_at`).bind(emailKey(email),profile).all<{ strategy_id:string;recorded_at:string;equity:number;total_pnl:number;realized_pnl:number;unrealized_pnl:number }>();
  const histories:Record<string,{ recordedAt:string;equity:number;totalPnl:number;realizedPnl:number;unrealizedPnl:number }[]>={};
  for (const strategyId of STRATEGY_IDS) histories[strategyId]=[];
  for (const row of result.results) histories[row.strategy_id]?.push({ recordedAt:row.recorded_at,equity:row.equity,totalPnl:row.total_pnl,realizedPnl:row.realized_pnl,unrealizedPnl:row.unrealized_pnl });
  return histories;
}
