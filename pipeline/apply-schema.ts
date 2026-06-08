// Apply schema.sql to the configured database. Idempotent (CREATE IF NOT EXISTS).
import { join } from "path";
import { sql } from "./db";

const schema = await Bun.file(join(import.meta.dir, "schema.sql")).text();
await sql.unsafe(schema);
console.log("Schema applied.");
await sql.end();
