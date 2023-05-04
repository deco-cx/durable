import { start as workers } from "./workers/main.ts";
import { start as api } from "./api/main.ts";
import { postgres } from "./backends/postgres/db.ts";
import { sqlite } from "./backends/sqlite/db.ts";

const db = Deno.env.get("PGDATABASE") ? postgres() : sqlite();

await Promise.all([workers(db), api(db)]);
