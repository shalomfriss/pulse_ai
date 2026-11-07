CREATE TABLE `user_rule_sets` (
  `id` text PRIMARY KEY NOT NULL,
  `user_email` text NOT NULL,
  `account_profile` text DEFAULT 'paper' NOT NULL,
  `name` text NOT NULL,
  `prompt` text NOT NULL,
  `spec_json` text NOT NULL,
  `enabled` integer DEFAULT false NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_rule_sets_owner` ON `user_rule_sets` (`user_email`,`account_profile`);
--> statement-breakpoint
CREATE TABLE `rule_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `rule_set_id` text NOT NULL,
  `scheduled_slot` text NOT NULL,
  `status` text NOT NULL,
  `result_json` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_runs_set_slot` ON `rule_runs` (`rule_set_id`,`scheduled_slot`);
