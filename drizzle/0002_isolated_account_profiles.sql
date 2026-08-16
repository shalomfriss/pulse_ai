CREATE TABLE `__new_user_credentials` (
	`user_email` text NOT NULL,
	`account_profile` text DEFAULT 'paper' NOT NULL,
	`alpaca_key_id_encrypted` text NOT NULL,
	`alpaca_secret_key_encrypted` text NOT NULL,
	`auto_trade` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_email`, `account_profile`)
);
--> statement-breakpoint
INSERT INTO `__new_user_credentials` (`user_email`,`account_profile`,`alpaca_key_id_encrypted`,`alpaca_secret_key_encrypted`,`auto_trade`,`created_at`,`updated_at`)
SELECT `user_email`,'paper',`alpaca_key_id_encrypted`,`alpaca_secret_key_encrypted`,`auto_trade`,`created_at`,`updated_at` FROM `user_credentials`;
--> statement-breakpoint
DROP TABLE `user_credentials`;
--> statement-breakpoint
ALTER TABLE `__new_user_credentials` RENAME TO `user_credentials`;
--> statement-breakpoint
CREATE TABLE `__new_user_strategy_settings` (
	`user_email` text NOT NULL,
	`account_profile` text DEFAULT 'paper' NOT NULL,
	`strategy_id` text NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_email`, `account_profile`, `strategy_id`)
);
--> statement-breakpoint
INSERT INTO `__new_user_strategy_settings` (`user_email`,`account_profile`,`strategy_id`,`paused`,`updated_at`)
SELECT `user_email`,'paper',`strategy_id`,`paused`,`updated_at` FROM `user_strategy_settings`;
--> statement-breakpoint
DROP TABLE `user_strategy_settings`;
--> statement-breakpoint
ALTER TABLE `__new_user_strategy_settings` RENAME TO `user_strategy_settings`;
--> statement-breakpoint
CREATE TABLE `__new_strategy_performance` (
	`user_email` text NOT NULL,
	`account_profile` text DEFAULT 'paper' NOT NULL,
	`strategy_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`equity` real NOT NULL,
	`total_pnl` real NOT NULL,
	`realized_pnl` real NOT NULL,
	`unrealized_pnl` real NOT NULL,
	PRIMARY KEY(`user_email`, `account_profile`, `strategy_id`, `recorded_at`)
);
--> statement-breakpoint
INSERT INTO `__new_strategy_performance` (`user_email`,`account_profile`,`strategy_id`,`recorded_at`,`equity`,`total_pnl`,`realized_pnl`,`unrealized_pnl`)
SELECT `user_email`,'paper',`strategy_id`,`recorded_at`,`equity`,`total_pnl`,`realized_pnl`,`unrealized_pnl` FROM `strategy_performance`;
--> statement-breakpoint
DROP TABLE `strategy_performance`;
--> statement-breakpoint
ALTER TABLE `__new_strategy_performance` RENAME TO `strategy_performance`;
--> statement-breakpoint
CREATE INDEX `strategy_performance_lookup` ON `strategy_performance` (`user_email`,`account_profile`,`strategy_id`,`recorded_at`);
