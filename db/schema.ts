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

export const localUsers = sqliteTable("local_users", {
  email:text("email").primaryKey(),
  displayName:text("display_name").notNull(),
  passwordHash:text("password_hash").notNull(),
  passwordSalt:text("password_salt").notNull(),
  createdAt:text("created_at").notNull(),
  updatedAt:text("updated_at").notNull(),
});

export const localSessions = sqliteTable("local_sessions", {
  sessionTokenHash:text("session_token_hash").primaryKey(),
  userEmail:text("user_email").notNull(),
  expiresAt:text("expires_at").notNull(),
  createdAt:text("created_at").notNull(),
},(table) => [index("local_sessions_user_lookup").on(table.userEmail,table.expiresAt)]);

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
