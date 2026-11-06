import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { records } from "./schema.js";

export class Store {
  readonly sqlite: Database.Database;
  readonly orm;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("busy_timeout = 5000");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.exec(
      `CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied INTEGER NOT NULL)`,
    );
    this.sqlite
      .transaction(() => {
        if (
          !this.sqlite
            .prepare("SELECT version FROM migrations WHERE version=1")
            .get()
        ) {
          this.sqlite.exec(
            `CREATE TABLE records (guild TEXT NOT NULL, namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)), updated INTEGER NOT NULL, PRIMARY KEY(guild,namespace,key)); CREATE INDEX records_scope ON records(guild,namespace,updated);`,
          );
          this.sqlite
            .prepare("INSERT INTO migrations VALUES(1,?)")
            .run(Date.now());
        }
      })
      .immediate();
    this.orm = drizzle(this.sqlite);
  }
  get<T>(guild: string, namespace: string, key: string): T | undefined {
    const row = this.orm
      .select()
      .from(records)
      .where(
        and(
          eq(records.guild, guild),
          eq(records.namespace, namespace),
          eq(records.key, key),
        ),
      )
      .get();
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  set<T>(guild: string, namespace: string, key: string, value: T): void {
    const data = {
      guild,
      namespace,
      key,
      value: JSON.stringify(value),
      updated: Date.now(),
    };
    this.orm
      .insert(records)
      .values(data)
      .onConflictDoUpdate({
        target: [records.guild, records.namespace, records.key],
        set: { value: data.value, updated: data.updated },
      })
      .run();
  }
  delete(guild: string, namespace: string, key: string): void {
    this.orm
      .delete(records)
      .where(
        and(
          eq(records.guild, guild),
          eq(records.namespace, namespace),
          eq(records.key, key),
        ),
      )
      .run();
  }
  list<T>(guild: string, namespace: string): { key: string; value: T }[] {
    return this.orm
      .select()
      .from(records)
      .where(and(eq(records.guild, guild), eq(records.namespace, namespace)))
      .all()
      .map((r) => ({ key: r.key, value: JSON.parse(r.value) as T }));
  }
  scopes(): string[] {
    return (
      this.sqlite.prepare("SELECT DISTINCT guild FROM records").all() as {
        guild: string;
      }[]
    ).map((r) => r.guild);
  }
  transaction<T>(fn: () => T): T {
    return this.sqlite.transaction(fn).immediate();
  }
  close(): void {
    this.sqlite.close();
  }
}
