import { createServer, request as nodeHttpRequest } from "node:http";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPublicContentClient,
  isPublicIpAddress,
  PublicContentError,
} from "./public-content-client";

type Fixture = {
  port: number;
  requests: string[];
  close: () => Promise<void>;
};

async function createFixture(
  handler: (
    requestUrl: string,
    response: import("node:http").ServerResponse,
  ) => void,
): Promise<Fixture> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "/");
    handler(request.url ?? "/", response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  return {
    port: address.port,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function clientFor(
  port: number,
  records: Record<string, Array<{ address: string; family: 4 | 6 }>>,
) {
  const lookup = vi.fn(async (hostname: string) => {
    const result = records[hostname];
    if (!result) throw new Error(`missing DNS fixture for ${hostname}`);
    return result;
  });
  const httpRequest = (
    options: import("node:http").RequestOptions,
    callback: (response: import("node:http").IncomingMessage) => void,
  ) => nodeHttpRequest({ ...options, hostname: "127.0.0.1", port }, callback);
  return {
    client: createPublicContentClient({ lookup, httpRequest }),
    lookup,
  };
}

const publicAddress = { address: "93.184.216.34", family: 4 as const };

describe("public content client", () => {
  const fixtures: Fixture[] = [];

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  });

  it("classifies encoded, mapped, private, and public address forms", () => {
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("169.254.1.1")).toBe(false);
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
    expect(isPublicIpAddress("fc00::1")).toBe(false);
  });

  it.each([
    "::",
    "::1",
    "::93.184.216.34",
    "64:ff9b::5db8:d822",
    "64:ff9b::7f00:1",
    "64:ff9b:1::7f00:1",
    "100::1",
    "100:0:0:1::1",
    "1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "2001::1",
    "2001:1::4",
    "2001:2::1",
    "2001:10::1",
    "2001:20::1",
    "2001:30::1",
    "2001:1ff:ffff::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "2002:5db8:d822::1",
    "3fff::1",
    "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff",
    "4000::1",
    "5f00::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "::ffff:192.168.1.1",
  ])(
    "refuses special, nonpublic or unsupported transition address %s",
    (address) => {
      expect(isPublicIpAddress(address)).toBe(false);
    },
  );

  it.each([
    "2000::1",
    "2001:1::1",
    "2001:1::2",
    "2001:1::3",
    "2001:3::1",
    "2001:4:112::1",
    "2001:200::1",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "2620:4f:8000::1",
    "3ffe:ffff::1",
    "3fff:1000::1",
    "3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "::ffff:93.184.216.34",
    "::ffff:5db8:d822",
  ])("preserves native global or mapped-public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it.each(["100::1", "2001:2::1", "64:ff9b:1::7f00:1", "3fff::1"])(
    "refuses nonpublic IPv6 DNS answer %s before requesting",
    async (address) => {
      const httpRequest = vi.fn();
      const client = createPublicContentClient({
        lookup: async () => [{ address, family: 6 }],
        httpRequest,
      });
      await expect(
        client.fetchPublicContent({
          url: "http://special.test/",
          kind: "text",
          timeoutMs: 1_000,
        }),
      ).rejects.toMatchObject({ code: "private_destination" });
      expect(httpRequest).not.toHaveBeenCalled();
    },
  );

  it("rejects mixed DNS answers before opening a request", async () => {
    const fixture = await createFixture((_url, response) =>
      response.end("unexpected"),
    );
    fixtures.push(fixture);
    const { client } = clientFor(fixture.port, {
      "mixed.test": [publicAddress, { address: "10.0.0.1", family: 4 }],
    });

    await expect(
      client.fetchPublicContent({
        url: `http://mixed.test:${fixture.port}/`,
        kind: "text",
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      code: "private_destination",
    });
    expect(fixture.requests).toEqual([]);
  });

  it("rejects embedded credentials and encoded private IP destinations", async () => {
    const fixture = await createFixture((_url, response) =>
      response.end("unexpected"),
    );
    fixtures.push(fixture);
    const { client } = clientFor(fixture.port, {});

    await expect(
      client.fetchPublicContent({
        url: `http://user:pass@public.test:${fixture.port}/`,
        kind: "text",
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "invalid_url" });
    await expect(
      client.fetchPublicContent({
        url: `http://2130706433:${fixture.port}/`,
        kind: "text",
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "private_destination" });
    expect(fixture.requests).toEqual([]);
  });

  it("validates each redirect and refuses a private destination", async () => {
    const fixture = await createFixture((url, response) => {
      if (url === "/start") {
        response.writeHead(302, {
          Location: `http://private.test:${fixture.port}/secret`,
        });
        response.end();
        return;
      }
      response.end("unexpected");
    });
    fixtures.push(fixture);
    const { client } = clientFor(fixture.port, {
      "public.test": [publicAddress],
      "private.test": [{ address: "127.0.0.1", family: 4 }],
    });

    await expect(
      client.fetchPublicContent({
        url: `http://public.test:${fixture.port}/start`,
        kind: "text",
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      code: "private_destination",
    });
    expect(fixture.requests).toEqual(["/start"]);
  });

  it("follows a bounded redirect chain while preserving the original host header", async () => {
    const seenHosts: string[] = [];
    const fixture = await createFixture((url, response) => {
      seenHosts.push(String(response.req.headers.host));
      if (url === "/start") {
        response.writeHead(302, { Location: "/final" });
        response.end();
        return;
      }
      response.end("ok");
    });
    fixtures.push(fixture);
    const { client } = clientFor(fixture.port, {
      "public.test": [publicAddress],
    });

    const result = await client.fetchPublicContent({
      url: `http://public.test:${fixture.port}/start`,
      kind: "text",
      timeoutMs: 1_000,
    });
    expect(result.body.toString()).toBe("ok");
    expect(result.finalUrl).toContain("/final");
    expect(seenHosts).toEqual([
      `public.test:${fixture.port}`,
      `public.test:${fixture.port}`,
    ]);
  });

  it("drops credentials after a cross-origin redirect and enforces the hop cap", async () => {
    const seenHeaders: Array<Record<string, string | string[] | undefined>> =
      [];
    const fixture = await createFixture((url, response) => {
      seenHeaders.push(response.req.headers);
      response.writeHead(302, {
        Location:
          url === "/start"
            ? `http://other.test:${fixture.port}/final`
            : `http://other.test:${fixture.port}/loop`,
      });
      response.end();
    });
    fixtures.push(fixture);
    const { client } = clientFor(fixture.port, {
      "public.test": [publicAddress],
      "other.test": [publicAddress],
    });

    await expect(
      client.fetchPublicContent({
        url: `http://public.test:${fixture.port}/start`,
        kind: "text",
        timeoutMs: 1_000,
        headers: {
          Authorization: "Bearer secret",
          Cookie: "session=secret",
        },
        maxRedirects: 1,
      }),
    ).rejects.toMatchObject({ code: "redirect_limit" });
    expect(seenHeaders[0]?.authorization).toBe("Bearer secret");
    expect(seenHeaders[0]?.cookie).toBe("session=secret");
    expect(seenHeaders[1]?.authorization).toBeUndefined();
    expect(seenHeaders[1]?.cookie).toBeUndefined();
  });

  it("bounds decoded compressed bodies, even with a small content length", async () => {
    const fixture = await createFixture((_url, response) => {
      const body = gzipSync(Buffer.alloc(20_000, "x"));
      response.writeHead(200, {
        "Content-Encoding": "gzip",
        "Content-Length": String(body.byteLength),
      });
      response.end(body);
    });
    fixtures.push(fixture);
    const { client } = clientFor(fixture.port, {
      "public.test": [publicAddress],
    });

    await expect(
      client.fetchPublicContent({
        url: `http://public.test:${fixture.port}/compressed`,
        kind: "text",
        timeoutMs: 1_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ code: "body_limit" });
  });

  it.each(["reset", "truncated"])(
    "rejects a remotely %s gzip body promptly and keeps the client usable",
    async (mode) => {
      let close: () => void = () => {};
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      const fixture = await createFixture((url, response) => {
        if (url === "/alive") return void response.end("alive");
        const body = gzipSync(Buffer.alloc(65_536, "x"));
        response.once("close", close);
        response.writeHead(200, {
          "Content-Encoding": "gzip",
          ...(mode === "reset"
            ? { "Content-Length": String(body.length) }
            : {}),
        });
        const partial = body.subarray(0, body.length - 8);
        if (mode === "truncated") response.end(partial);
        else
          response.write(partial, () => {
            // Deliver actual gzip bytes before resetting the underlying socket.
            setTimeout(() => response.destroy(), 20);
          });
      });
      fixtures.push(fixture);
      const { client } = clientFor(fixture.port, {
        "public.test": [publicAddress],
      });
      const started = Date.now();
      await expect(
        client.fetchPublicContent({
          url: `http://public.test:${fixture.port}/gzip`,
          kind: "text",
          timeoutMs: 2_000,
        }),
      ).rejects.toThrow(/aborted|premature|unexpected end/i);
      expect(Date.now() - started).toBeLessThan(1_000);
      await closed;
      const alive = await client.fetchPublicContent({
        url: `http://public.test:${fixture.port}/alive`,
        kind: "text",
        timeoutMs: 1_000,
      });
      expect(alive.body.toString()).toBe("alive");
    },
  );

  it("keeps the total deadline and closes a stalled compressed stream", async () => {
    let close: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const fixture = await createFixture((_url, response) => {
      response.once("close", close);
      response.writeHead(200, { "Content-Encoding": "gzip" });
      const body = gzipSync(Buffer.alloc(65_536, "x"));
      response.write(body.subarray(0, body.length - 8));
    });
    fixtures.push(fixture);
    const { client } = clientFor(fixture.port, {
      "public.test": [publicAddress],
    });
    const started = Date.now();
    await expect(
      client.fetchPublicContent({
        url: `http://public.test:${fixture.port}/gzip-stall`,
        kind: "text",
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
    await closed;
  });

  it("cancels a stalled stream when the caller aborts", async () => {
    let closed = false;
    const fixture = await createFixture((_url, response) => {
      response.on("close", () => {
        closed = true;
      });
      response.writeHead(200);
      response.write("first");
    });
    fixtures.push(fixture);
    const { client } = clientFor(fixture.port, {
      "public.test": [publicAddress],
    });
    const controller = new AbortController();
    const pending = client.fetchPublicContent({
      url: `http://public.test:${fixture.port}/stall`,
      kind: "text",
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "aborted",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(true);
  });
});
