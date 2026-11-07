CREATE TABLE IF NOT EXISTS user_credentials (
  user_email VARCHAR(320) NOT NULL,
  account_profile ENUM('paper', 'live') NOT NULL DEFAULT 'paper',
  alpaca_key_id_encrypted TEXT NOT NULL,
  alpaca_secret_key_encrypted TEXT NOT NULL,
  auto_trade TINYINT(1) NOT NULL DEFAULT 0,
  created_at VARCHAR(35) NOT NULL,
  updated_at VARCHAR(35) NOT NULL,
  PRIMARY KEY (user_email, account_profile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS local_users (
  email VARCHAR(320) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  password_salt VARCHAR(64) NOT NULL,
  created_at VARCHAR(35) NOT NULL,
  updated_at VARCHAR(35) NOT NULL,
  PRIMARY KEY (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS local_sessions (
  session_token_hash VARCHAR(64) NOT NULL,
  user_email VARCHAR(320) NOT NULL,
  expires_at VARCHAR(35) NOT NULL,
  created_at VARCHAR(35) NOT NULL,
  PRIMARY KEY (session_token_hash),
  INDEX local_sessions_user_lookup (user_email, expires_at),
  FOREIGN KEY (user_email) REFERENCES local_users(email) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_strategy_settings (
  user_email VARCHAR(320) NOT NULL,
  account_profile ENUM('paper', 'live') NOT NULL DEFAULT 'paper',
  strategy_id VARCHAR(64) NOT NULL,
  paused TINYINT(1) NOT NULL DEFAULT 0,
  updated_at VARCHAR(35) NOT NULL,
  PRIMARY KEY (user_email, account_profile, strategy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS strategy_performance (
  user_email VARCHAR(320) NOT NULL,
  account_profile ENUM('paper', 'live') NOT NULL DEFAULT 'paper',
  strategy_id VARCHAR(64) NOT NULL,
  recorded_at VARCHAR(35) NOT NULL,
  equity DOUBLE NOT NULL,
  total_pnl DOUBLE NOT NULL,
  realized_pnl DOUBLE NOT NULL,
  unrealized_pnl DOUBLE NOT NULL,
  PRIMARY KEY (user_email, account_profile, strategy_id, recorded_at),
  INDEX strategy_performance_lookup (user_email, account_profile, strategy_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_rule_sets (
  id CHAR(36) NOT NULL,
  user_email VARCHAR(320) NOT NULL,
  account_profile ENUM('paper', 'live') NOT NULL DEFAULT 'paper',
  name VARCHAR(80) NOT NULL,
  prompt TEXT NOT NULL,
  spec_json LONGTEXT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at VARCHAR(35) NOT NULL,
  updated_at VARCHAR(35) NOT NULL,
  PRIMARY KEY (id),
  INDEX user_rule_sets_owner (user_email, account_profile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rule_runs (
  id CHAR(36) NOT NULL,
  rule_set_id CHAR(36) NOT NULL,
  scheduled_slot VARCHAR(70) NOT NULL,
  status VARCHAR(20) NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at VARCHAR(35) NOT NULL,
  updated_at VARCHAR(35) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY rule_runs_set_slot (rule_set_id, scheduled_slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
