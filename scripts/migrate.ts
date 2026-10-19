import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "../src/db/client";

async function main() {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
