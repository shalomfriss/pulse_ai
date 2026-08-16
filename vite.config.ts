import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const { r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const fileEnv = loadEnv(mode, process.cwd(), "");
  const localVariable = (key: string) => process.env[key] ?? fileEnv[key] ?? "";
  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      LOCAL_DEV_USER_EMAIL: localVariable("LOCAL_DEV_USER_EMAIL"),
      LOCAL_DEV_USER_NAME: localVariable("LOCAL_DEV_USER_NAME"),
      LOCAL_MYSQL_PROXY_URL: localVariable("LOCAL_MYSQL_PROXY_URL"),
      CREDENTIALS_ENCRYPTION_KEY: localVariable("CREDENTIALS_ENCRYPTION_KEY"),
      OWNER_EMAIL: localVariable("OWNER_EMAIL"),
      ALPACA_API_KEY_ID: localVariable("ALPACA_API_KEY_ID"),
      ALPACA_API_SECRET_KEY: localVariable("ALPACA_API_SECRET_KEY"),
      ALPACA_AUTO_TRADE: localVariable("ALPACA_AUTO_TRADE") || "false",
    },
    d1_databases: [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
  };

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
