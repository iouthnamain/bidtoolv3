import { createHash } from "node:crypto";
import { createServer } from "node:http";
import next from "next";

if (
  !process.send ||
  !process.env.BIDTOOL_TEST_RUN_ID ||
  process.env.DATABASE_URL !== process.env.BIDTOOL_TEST_DATABASE_URL
) {
  throw new Error("An owned launcher and matching test database are required.");
}

let ready = false;
/** @type {ReturnType<typeof next> | undefined} */
let app;
const server = createServer((request, response) => {
  if (!ready || !app) {
    response.writeHead(503).end("Test app starting");
    return;
  }
  void app
    .getRequestHandler()(request, response)
    .catch(() => response.destroy());
});
// The OS allocates and holds the port. There is no probe/rebind window.
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve(undefined));
});
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Missing owned app listener.");
app = next({
  dev: true,
  dir: process.cwd(),
  hostname: "127.0.0.1",
  port: address.port,
  httpServer: server,
});
await app.prepare();
ready = true;
process.send({
  port: address.port,
  identity: createHash("sha256")
    .update(`${process.env.DATABASE_URL}\n${process.env.BIDTOOL_TEST_RUN_ID}`)
    .digest("hex"),
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    ready = false;
    server.closeAllConnections();
    server.close();
    void app?.close().finally(() => process.exit(0));
  });
}
