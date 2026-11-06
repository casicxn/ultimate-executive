# English installation

Install **Node.js 24 LTS** and **pnpm 10.10.0** (`npm install -g pnpm@10.10.0` with a standard Node installation). Run `pnpm install` in the project directory. SQLite and PNG rendering use local native packages; unsupported platforms may need Python and a C++ toolchain when prebuilt packages are unavailable.

Create your own Discord application and bot in the Developer Portal. Copy `.env.example` to `.env` and supply:

| Variable | Purpose |
|---|---|
| DISCORD_TOKEN | Secret bot token from the Bot page |
| APPLICATION_ID | Application ID from General Information |
| BOT_OWNER_ID | Your user ID for global application administration |
| DEV_GUILD_ID | Optional development guild for immediate scoped slash registration |
| DATABASE_PATH | Defaults to `./data/executive.sqlite` |
| LOG_LEVEL | Defaults to `info` |

Enable **Message Content Intent** and **Server Members Intent** on the Bot page. Prefix commands need Message Content. Verified/public installations may require Discord approval for privileged intents. The code also enables Guilds, GuildMessages, and GuildVoiceStates; it does not request presence data.

Invite using the `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Embed Links, Read Message History, and Attach Files for basic operation. Enable Ban Members, Kick Members, Moderate Members, Manage Messages, Manage Roles, Manage Channels, and Manage Nicknames only for the modules you use. Channel overwrite editing also requires Manage Roles. Administrator is not required.

Place the bot role above the roles and members it will manage. Place public reward/self roles below all staff/protected roles. Staff may receive Executive command grants without native moderation permissions. Actor hierarchy and bot hierarchy are checked independently.

```text
pnpm register
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
```

The registration script replaces this application's command list with `/executive`; use a dedicated bot application. `DEV_GUILD_ID` registers to one test guild. Without it the command is global and Discord propagation can take time.

Use `.panel` or `/executive panel` as the guild owner, `.config language en` for English, and `.staff` to configure delegated permissions. `/executive run command:<name> arguments:<arguments>` uses the prefix registry directly. See [COMMANDS.md](COMMANDS.md), [CONFIGURATION.md](CONFIGURATION.md), and [SYSTEMS.md](SYSTEMS.md).

For development use `pnpm dev`. For Docker, prepare `.env` and run `docker compose up -d --build`. The named volume preserves SQLite data. Docker execution has not been verified in this delivery.

Stop the bot before copying the entire data directory for backup; copying only a live SQLite file can omit WAL transactions. Do not start multiple bot processes against the same database. Restarting applies tracked migrations and retains data.

Before production, test command authorization, hierarchy, game consent, tickets, scheduled reminders/giveaways, persistent components after restart, and module disabling in a controlled test guild. Automated mocked Discord tests are not a substitute for live acceptance tests.
