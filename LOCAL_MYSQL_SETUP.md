# Pulse AI: Local MySQL Setup

## Requirements

- Node.js 22.13 or newer
- MySQL 8 or newer
- npm

## 1. Create the database and user

Sign in to MySQL as an administrator:

```bash
mysql -u root -p
```

Run the following statements. Replace `choose-a-strong-password` with your own password.

```sql
CREATE DATABASE IF NOT EXISTS pulse_ai
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'pulse'@'localhost'
  IDENTIFIED BY 'choose-a-strong-password';

ALTER USER 'pulse'@'localhost'
  IDENTIFIED BY 'choose-a-strong-password';

GRANT ALL PRIVILEGES ON pulse_ai.* TO 'pulse'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 2. Configure Pulse AI

From the extracted `pulse-ai` directory:

```bash
cp .env.example .env.local
```

Edit `.env.local` and set:

```env
LOCAL_DEV_USER_EMAIL=local@pulse-ai.test
LOCAL_DEV_USER_NAME=Local Pulse AI User

CREDENTIALS_ENCRYPTION_KEY=replace-with-a-stable-random-value-at-least-24-characters

MYSQL_URL=mysql://pulse:choose-a-strong-password@127.0.0.1:3306/pulse_ai
LOCAL_MYSQL_PROXY_URL=http://127.0.0.1:8789
LOCAL_MYSQL_MANAGED=false

ALPACA_AUTO_TRADE=false
```

If the MySQL password contains characters such as `@`, `:`, `/`, `?`, `#`, or `%`, URL-encode the password in `MYSQL_URL`.

Keep `CREDENTIALS_ENCRYPTION_KEY` private and stable. Changing it prevents Pulse AI from decrypting Alpaca credentials already saved in MySQL.

## 3. Install and run

```bash
npm install
npm run local
```

The local command applies `mysql/schema.sql` automatically and starts Pulse AI. Open:

```text
http://localhost:3000
```

Press Control-C to stop the app. Your MySQL data remains in the `pulse_ai` database.

## Useful commands

Apply the schema manually:

```bash
npm run local:mysql:migrate
```

Build and run the automated checks:

```bash
npm test
```

