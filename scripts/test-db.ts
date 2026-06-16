import { db } from "../src/server/db/index.js";
import { appSettings } from "../src/server/db/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  try {
    const res = await db.query.appSettings.findFirst({
      where: eq(appSettings.key, "gemini_api_key")
    });
    console.log("Success:", res);
  } catch (e) {
    console.error("Error:", e);
  }
  process.exit(0);
}
main();
