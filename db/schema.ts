import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userCredentials = sqliteTable("user_credentials", {
  userEmail: text("user_email").notNull(),
  accountProfile: text("account_profile", { enum:["paper","live"] }).notNull().default("paper"),
  alpacaKeyIdEncrypted: text("alpaca_key_id_encrypted").notNull(),
  alpacaSecretKeyEncrypted: text("alpaca_secret_key_encrypted").notNull(),
  autoTrade: integer("auto_trade", { mode:"boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},(table) => [primaryKey({ columns:[table.userEmail,table.accountProfile] })]);

export const userStrategySettings = sqliteTable("user_strategy_settings", {
  userEmail:text("user_email").notNull(),
  accountProfile:text("account_profile", { enum:["paper","live"] }).notNull().default("paper"),
  strategyId:text("strategy_id").notNull(),
  paused:integer("paused",{ mode:"boolean" }).notNull().default(false),
  updatedAt:text("updated_at").notNull(),
},(table) => [primaryKey({ columns:[table.userEmail,table.accountProfile,table.strategyId] })]);

export const strategyPerformance = sqliteTable("strategy_performance", {
  userEmail:text("user_email").notNull(),
  accountProfile:text("account_profile", { enum:["paper","live"] }).notNull().default("paper"),
  strategyId:text("strategy_id").notNull(),
  recordedAt:text("recorded_at").notNull(),
  equity:real("equity").notNull(),
  totalPnl:real("total_pnl").notNull(),
  realizedPnl:real("realized_pnl").notNull(),
  unrealizedPnl:real("unrealized_pnl").notNull(),
},(table) => [
  primaryKey({ columns:[table.userEmail,table.accountProfile,table.strategyId,table.recordedAt] }),
  index("strategy_performance_lookup").on(table.userEmail,table.accountProfile,table.strategyId,table.recordedAt),
]);
