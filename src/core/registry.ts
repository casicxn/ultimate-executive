import type { Command, CommandContext } from "./types.js";
import { assert } from "../shared.js";
export function parsePrefix(
  text: string,
): { name: string; args: string[] } | undefined {
  if (!text.startsWith(".")) return;
  const parts = text.slice(1).trim().split(/\s+/);
  const name = parts.shift()?.toLowerCase();
  return name ? { name, args: parts } : undefined;
}
export class Registry {
  private commands = new Map<string, Command>();
  register(command: Command): void {
    for (const name of [command.name, ...(command.aliases ?? [])]) {
      if (this.commands.has(name)) throw new Error(`Duplicate command ${name}`);
      this.commands.set(name, command);
    }
  }
  find(name: string): Command | undefined {
    return this.commands.get(name.toLowerCase());
  }
  all(): Command[] {
    return [...new Set(this.commands.values())];
  }
  async execute(name: string, ctx: CommandContext): Promise<boolean> {
    const command = this.find(name);
    if (!command) return false;
    const { runtime, guild, member } = ctx;
    const settings = runtime.settings.get(guild.id);
    assert(
      command.enabled !== false &&
        runtime.settings.enabled(guild.id, command.module) &&
        !settings.disabledCommands.includes(command.name),
      "error.disabled",
    );
    if (command.permission)
      assert(
        runtime.permissions.can(
          member,
          command.permission,
          command.nativePermission,
        ),
        "error.permission",
      );
    runtime.db.transaction(() => {
      const key = `${member.id}:${command.name}`;
      const next = runtime.db.get<number>(guild.id, "cooldowns", key) ?? 0;
      const now = Date.now();
      assert(now >= next, "error.cooldown", {
        seconds: Math.ceil((next - now) / 1000),
      });
      runtime.db.set(
        guild.id,
        "cooldowns",
        key,
        now + (command.cooldown ?? 2000),
      );
    });
    runtime.permissions.consumeLimit(guild.id, "guild", "commands", 120);
    await command.execute(ctx);
    return true;
  }
}
