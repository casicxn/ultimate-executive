import type { Store } from "../database/store.js";
import type { Locale } from "./localization.js";
export interface GuildSettings {
  locale: Locale;
  disabledModules: string[];
  disabledCommands: string[];
  configAdmins: string[];
  protectedUsers: string[];
  protectedRoles: string[];
  logChannel?: string;
}
export class Settings {
  constructor(readonly db: Store) {}
  get(guild: string): GuildSettings {
    return (
      this.db.get<GuildSettings>(guild, "core", "settings") ?? {
        locale: "tr",
        disabledModules: [],
        disabledCommands: [],
        configAdmins: [],
        protectedUsers: [],
        protectedRoles: [],
      }
    );
  }
  update(guild: string, patch: Partial<GuildSettings>): GuildSettings {
    const value = { ...this.get(guild), ...patch };
    this.db.set(guild, "core", "settings", value);
    return value;
  }
  enabled(guild: string, module: string): boolean {
    return !this.get(guild).disabledModules.includes(module);
  }
  moduleConfig<T>(guild: string, module: string, fallback: T): T {
    return this.db.get<T>(guild, "config", module) ?? fallback;
  }
  setModuleConfig<T>(guild: string, module: string, value: T): void {
    this.db.set(guild, "config", module, value);
  }
}
