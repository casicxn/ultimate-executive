import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";
export const records = sqliteTable(
  "records",
  {
    guild: text("guild").notNull(),
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updated: integer("updated").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.guild, t.namespace, t.key] }),
    index("records_scope").on(t.guild, t.namespace, t.updated),
  ],
);
