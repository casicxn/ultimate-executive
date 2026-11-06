import { Client, GatewayIntentBits, Options } from "discord.js";
import { pino } from "pino";
import { Store } from "../database/store.js";
import { Settings } from "./settings.js";
import { Registry } from "./registry.js";
import { Permissions } from "./permissions.js";
import { Scheduler } from "./scheduler.js";
import type { Runtime, Module } from "./types.js";
export function createRuntime(
  path: string,
  ownerId: string,
  level = "info",
): Runtime {
  const db = new Store(path),
    settings = new Settings(db),
    logger = pino({ level, redact: ["token", "DISCORD_TOKEN", "*.token"] });
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
    allowedMentions: { parse: [], repliedUser: false },
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 100,
    }),
    sweepers: { messages: { interval: 300, lifetime: 600 } },
  });
  return {
    client,
    db,
    settings,
    logger,
    registry: new Registry(),
    scheduler: new Scheduler(db, settings, logger),
    permissions: new Permissions(db, settings),
    ownerId,
    startedAt: Date.now(),
    interactions: new Map(),
    messageHooks: [],
    voiceHooks: [],
    memberHooks: [],
  };
}
export function registerModules(runtime: Runtime, modules: Module[]): void {
  const names = new Set<string>();
  for (const module of modules) {
    if (names.has(module.name))
      throw new Error(`Duplicate module ${module.name}`);
    names.add(module.name);
    module.register(runtime);
  }
}
