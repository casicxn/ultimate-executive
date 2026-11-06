import type {
  Client,
  Guild,
  GuildMember,
  Message,
  User,
  TextBasedChannel,
  MessageCreateOptions,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  VoiceState,
} from "discord.js";
import type { Logger } from "pino";
import type { Store } from "../database/store.js";
import type { Locale } from "./localization.js";
import type { Settings } from "./settings.js";
import type { Registry } from "./registry.js";
import type { Scheduler } from "./scheduler.js";
import type { Permissions } from "./permissions.js";
export interface CommandContext {
  runtime: Runtime;
  guild: Guild;
  member: GuildMember;
  user: User;
  channel: TextBasedChannel;
  args: string[];
  locale: Locale;
  requestId: string;
  message?: Message;
  reply: (options: string | MessageCreateOptions) => Promise<void>;
}
export interface Command {
  name: string;
  aliases?: string[];
  module: string;
  description: string;
  usage: string;
  permission?: string;
  nativePermission?: bigint;
  cooldown?: number;
  enabled?: boolean;
  execute: (ctx: CommandContext) => Promise<void>;
}
export interface Module {
  name: string;
  register: (runtime: Runtime) => void;
}
export type ComponentInteraction =
  MessageComponentInteraction | ModalSubmitInteraction;
export type InteractionHandler = (
  interaction: ComponentInteraction,
  runtime: Runtime,
) => Promise<void>;
export interface Runtime {
  client: Client;
  db: Store;
  logger: Logger;
  settings: Settings;
  registry: Registry;
  scheduler: Scheduler;
  permissions: Permissions;
  ownerId: string;
  startedAt: number;
  interactions: Map<string, { module: string; handle: InteractionHandler }>;
  messageHooks: {
    module: string;
    handle: (message: Message) => Promise<void>;
  }[];
  voiceHooks: {
    module: string;
    handle: (oldState: VoiceState, newState: VoiceState) => Promise<void>;
  }[];
  memberHooks: {
    module: string;
    join?: (member: GuildMember) => Promise<void>;
    leave?: (member: GuildMember) => Promise<void>;
  }[];
}
