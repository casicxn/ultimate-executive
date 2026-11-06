import { randomUUID } from "node:crypto";
import type { Store } from "../database/store.js";
import type { Settings } from "./settings.js";
import type { Logger } from "pino";
export interface Job {
  id: string;
  guild: string;
  module: string;
  type: string;
  due: number;
  payload: unknown;
  attempts: number;
  lease?: number;
}
export class Scheduler {
  readonly handlers = new Map<string, (job: Job) => Promise<void>>();
  private timer?: NodeJS.Timeout;
  private running = false;
  private idle = new Set<() => void>();
  private stopped = false;
  constructor(
    readonly db: Store,
    readonly settings: Settings,
    readonly logger: Logger,
  ) {}
  register(type: string, handler: (job: Job) => Promise<void>): void {
    if (this.handlers.has(type)) throw new Error(`Duplicate job ${type}`);
    this.handlers.set(type, handler);
  }
  schedule(
    guild: string,
    module: string,
    type: string,
    due: number,
    payload: unknown,
    id: string = randomUUID(),
  ): string {
    if (!this.db.get(guild, "jobs", id))
      this.db.set<Job>(guild, "jobs", id, {
        id,
        guild,
        module,
        type,
        due,
        payload,
        attempts: 0,
      });
    return id;
  }
  cancel(guild: string, id: string): void {
    this.db.delete(guild, "jobs", id);
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      for (const guild of this.db.scopes())
        for (const { value: job } of this.db.list<Job>(guild, "jobs")) {
          if (this.stopped) return;
          if (
            job.due > now ||
            (job.lease ?? 0) > now ||
            !this.settings.enabled(guild, job.module)
          )
            continue;
          const handler = this.handlers.get(job.type);
          if (!handler) continue;
          job.lease = now + 300000;
          this.db.set(guild, "jobs", job.id, job);
          try {
            await handler(job);
            this.db.delete(guild, "jobs", job.id);
          } catch (error) {
            job.attempts++;
            job.lease = undefined;
            job.due =
              now + Math.min(3600000, 10000 * 2 ** Math.min(job.attempts, 8));
            this.db.set(guild, "jobs", job.id, job);
            this.logger.error(
              { err: error, job: job.id },
              "Scheduled task failed; retry pending",
            );
          }
        }
    } finally {
      this.running = false;
      for (const resolve of this.idle) resolve();
      this.idle.clear();
    }
  }
  start(): void {
    this.stopped = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.tick().catch((err) =>
        this.logger.error({ err }, "Scheduler failed"),
      );
    }, 5000);
    this.timer.unref();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
  async drain(): Promise<void> {
    if (this.running)
      await new Promise<void>((resolve) => this.idle.add(resolve));
  }
}
