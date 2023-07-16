import { start as api } from "./api/main.ts";
import { sqlite } from "./backends/sqlite/db.ts";
import { buildWorkflowRegistry } from "./registry/registries.ts";
import { start as workers } from "./workers/main.ts";

const [db, registry] = await Promise.all([
  sqlite(),
  buildWorkflowRegistry(),
]);

await Promise.all([workers(db, registry), api(db, registry)]);
