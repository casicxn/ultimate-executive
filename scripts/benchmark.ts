import { performance } from "node:perf_hooks";
import { createRuntime } from "../src/core/runtime.js";
import { EconomyService } from "../src/modules/economy/service.js";
const r = createRuntime(":memory:", "", "silent");
const economy = new EconomyService(r.db, r.settings);
economy.credit("benchmark", "a", 10000, "seed");
let start = performance.now();
for (let n = 0; n < 1000; n++)
  economy.transfer("benchmark", "a", "b", 1, `transfer:${n}`);
const transferMs = performance.now() - start;
for (let n = 0; n < 1000; n++)
  r.scheduler.schedule(
    "benchmark",
    "benchmark",
    "noop",
    Date.now() + 3600000,
    {},
    `future:${n}`,
  );
start = performance.now();
await r.scheduler.tick();
const scanMs = performance.now() - start;
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      sqlite: "in-memory",
      transfers: 1000,
      transferMs: Math.round(transferMs),
      futureJobs: 1000,
      scanMs: Math.round(scanMs),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    },
    null,
    2,
  ),
);
await r.client.destroy();
r.db.close();
