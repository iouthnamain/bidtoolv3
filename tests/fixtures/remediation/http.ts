import { createServer, type RequestListener } from "node:http";
import type { LookupAddress } from "node:dns";

export function createResolverFixture(
  records: Record<string, LookupAddress[]>,
) {
  const queries: string[] = [];
  return {
    queries,
    async lookup(hostname: string) {
      queries.push(hostname);
      const addresses = records[hostname];
      if (!addresses)
        throw new Error(`No controlled DNS response for ${hostname}`);
      return addresses;
    },
  };
}

// Real loopback socket; callers control headers, chunks, stalls and abort barriers.
export async function createHttpFixture(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture socket.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async cleanup() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
