import { start as workers } from "./workers/main.ts";
import { start as api } from "./api/main.ts";
import { postgres } from "./backends/postgres/db.ts";

const db = postgres();
await Promise.all([workers(db), api(db)]);
