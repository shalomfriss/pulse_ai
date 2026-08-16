CREATE TABLE `strategy_performance` (
	`user_email` text NOT NULL,
	`strategy_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`equity` real NOT NULL,
	`total_pnl` real NOT NULL,
	`realized_pnl` real NOT NULL,
	`unrealized_pnl` real NOT NULL,
	PRIMARY KEY(`user_email`, `strategy_id`, `recorded_at`)
);
--> statement-breakpoint
CREATE INDEX `strategy_performance_lookup` ON `strategy_performance` (`user_email`,`strategy_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `user_strategy_settings` (
	`user_email` text NOT NULL,
	`strategy_id` text NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_email`, `strategy_id`)
);
