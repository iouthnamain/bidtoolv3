console.warn(
  "[db:wipe] Deprecated: use `bun run db:clear` instead. Forwarding...\n",
);

await import("./db-clear");
