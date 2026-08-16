CREATE TABLE `user_credentials` (
	`user_email` text PRIMARY KEY NOT NULL,
	`alpaca_key_id_encrypted` text NOT NULL,
	`alpaca_secret_key_encrypted` text NOT NULL,
	`auto_trade` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
