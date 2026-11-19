// Child-only crash checkpoints: the production publisher has no fault hooks.
import { writeSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { publishCatalogPdfFile } from "../../../src/server/services/catalog-pdf-storage";
import { requireTestDatabase } from "./test-target";

const [schema, rawId, checkpoint] = process.argv.slice(2);
if (
  !schema ||
  !/^fixture_[a-f0-9]+$/.test(schema) ||
  !rawId ||
  !/^\d+$/.test(rawId)
)
  throw new Error("Owned R3 fixture required");
let committing = false;
const client = postgres(requireTestDatabase(), {
  max: 1,
  connection: { search_path: `${schema},public` },
  debug(_connection, query) {
    const crash =
      (checkpoint === "before-transaction" && query === "begin") ||
      (checkpoint === "before-commit" && query === "commit") ||
      (checkpoint === "after-commit" &&
        committing &&
        query.startsWith("select"));
    if (crash) {
      writeSync(1, `R3 checkpoint ${checkpoint}\n`);
      process.kill(process.pid, "SIGKILL");
    }
    if (query === "commit") committing = true;
  },
});
try {
  await publishCatalogPdfFile(
    drizzle(client),
    Number(rawId),
    "child.pdf",
    Buffer.from("%PDF-1.4\nR3 child\n%%EOF"),
    "reupload",
  );
  throw new Error("Expected crash checkpoint was not reached");
} finally {
  await client.end();
}
