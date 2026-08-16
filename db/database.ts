import { env } from "cloudflare:workers";

type QueryMode = "first" | "all" | "run";
type QueryPayload = { sql: string; params: unknown[]; mode: QueryMode };

export interface DatabaseStatement {
  bind(...values: unknown[]): DatabaseStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface Database {
  prepare(sql: string): DatabaseStatement;
  batch(statements: DatabaseStatement[]): Promise<unknown[]>;
}

class LocalMySqlStatement implements DatabaseStatement {
  constructor(
    private readonly proxyUrl: string,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): DatabaseStatement {
    return new LocalMySqlStatement(this.proxyUrl, this.sql, values);
  }

  first<T>(): Promise<T | null> {
    return this.query<T | null>("first");
  }

  all<T>(): Promise<{ results: T[] }> {
    return this.query<{ results: T[] }>("all");
  }

  run(): Promise<unknown> {
    return this.query("run");
  }

  payload(mode: QueryMode = "run"): QueryPayload {
    return { sql: this.sql, params: this.params, mode };
  }

  private async query<T>(mode: QueryMode): Promise<T> {
    const response = await fetch(`${this.proxyUrl}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: this.sql, params: this.params, mode } satisfies QueryPayload),
    });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(result.error || "Local MySQL query failed");
    return result;
  }
}

class LocalMySqlDatabase implements Database {
  constructor(private readonly proxyUrl: string) {}

  prepare(sql: string): DatabaseStatement {
    return new LocalMySqlStatement(this.proxyUrl, sql);
  }

  async batch(statements: DatabaseStatement[]): Promise<unknown[]> {
    const queries = statements.map((statement) => {
      if (!(statement instanceof LocalMySqlStatement)) {
        throw new Error("Cannot mix database statement implementations in one batch");
      }
      return statement.payload();
    });
    const response = await fetch(`${this.proxyUrl}/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries }),
    });
    const result = (await response.json()) as { results?: unknown[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Local MySQL batch failed");
    return result.results ?? [];
  }
}

export function database(): Database {
  const proxyUrl = process.env.LOCAL_MYSQL_PROXY_URL?.replace(/\/$/, "");
  if (proxyUrl) return new LocalMySqlDatabase(proxyUrl);

  const d1 = env.DB as D1Database | undefined;
  if (!d1) throw new Error("Database storage is unavailable");
  return d1 as unknown as Database;
}
