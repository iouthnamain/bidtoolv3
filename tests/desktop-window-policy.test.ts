import { describe, expect, test } from "vitest";

import {
  classifyNavigation,
  isApprovedIpcSender,
  resolveProbeRedirect,
} from "../electron/window-policy.cjs";

const localOrigin = "http://127.0.0.1:3000";
const remoteOrigin = "https://bidtool.example.test";

function senderFixture(origin: string) {
  const mainFrame = {
    isDestroyed: () => false,
    detached: false,
    origin,
    url: `${origin}/settings/desktop`,
  };
  const sender = { isDestroyed: () => false, mainFrame };

  return {
    event: { sender, senderFrame: mainFrame },
    registeredOrigins: new WeakMap([[sender, origin]]),
  };
}

describe("desktop IPC sender policy", () => {
  test.each([localOrigin, remoteOrigin])(
    "allows the registered main frame at %s",
    (origin) => {
      const { event, registeredOrigins } = senderFixture(origin);
      expect(isApprovedIpcSender(event, registeredOrigins)).toBe(true);
    },
  );

  test("rejects other windows even at the approved origin", () => {
    const { registeredOrigins } = senderFixture(remoteOrigin);
    const { event } = senderFixture(remoteOrigin);

    expect(isApprovedIpcSender(event, registeredOrigins)).toBe(false);
  });

  test("rejects subframes and missing sender frames", () => {
    const { event, registeredOrigins } = senderFixture(remoteOrigin);
    const subframe = { ...event.senderFrame };

    for (const senderFrame of [subframe, null]) {
      expect(
        isApprovedIpcSender({ ...event, senderFrame }, registeredOrigins),
      ).toBe(false);
    }
  });

  test.each(["destroyed window", "destroyed frame", "detached frame"])(
    "rejects a %s",
    (status) => {
      const { event, registeredOrigins } = senderFixture(remoteOrigin);
      event.sender.isDestroyed = () => status === "destroyed window";
      event.senderFrame.isDestroyed = () => status === "destroyed frame";
      event.senderFrame.detached = status === "detached frame";

      expect(isApprovedIpcSender(event, registeredOrigins)).toBe(false);
    },
  );

  test("requires both the frame origin and URL to match the captured origin", () => {
    const { event, registeredOrigins } = senderFixture(remoteOrigin);
    event.senderFrame.origin = "null";
    expect(isApprovedIpcSender(event, registeredOrigins)).toBe(false);

    event.senderFrame.origin = remoteOrigin;
    event.senderFrame.url = "about:blank";
    expect(isApprovedIpcSender(event, registeredOrigins)).toBe(false);

    event.senderFrame.url = `${remoteOrigin}/settings/desktop`;
    registeredOrigins.set(event.sender, localOrigin);
    expect(isApprovedIpcSender(event, registeredOrigins)).toBe(false);

    event.senderFrame.origin = localOrigin;
    event.senderFrame.url = `${localOrigin}/settings/desktop`;
    expect(isApprovedIpcSender(event, registeredOrigins)).toBe(true);
  });
});

describe("desktop navigation policy", () => {
  test("allows a configured HTTP server to upgrade to HTTPS on the same host", () => {
    const configured = new URL("http://bidtool.example.test/settings/desktop");
    expect(resolveProbeRedirect(configured, `${remoteOrigin}/dashboard`)).toBe(
      `${remoteOrigin}/dashboard`,
    );
    expect(
      resolveProbeRedirect(configured, "https://docs.example.test/"),
    ).toBeNull();
    expect(resolveProbeRedirect(configured, "/dashboard")).toBe(
      "http://bidtool.example.test/dashboard",
    );
  });

  test("rejects a non-HTTP redirect even when its origin matches", () => {
    const configured = new URL(remoteOrigin);
    expect(
      resolveProbeRedirect(configured, `blob:${remoteOrigin}/viewer`),
    ).toBeNull();
  });

  test.each([localOrigin, remoteOrigin])(
    "allows same-origin links and redirects at %s",
    (origin) => {
      const destination = `${origin}/dashboard`;
      expect(classifyNavigation(destination, origin, true)).toEqual({
        action: "allow",
      });
      expect(classifyNavigation(destination, origin, false)).toEqual({
        action: "allow",
      });
    },
  );

  test.each(["http://docs.example.test/", "https://docs.example.test/"])(
    "opens a direct link to %s externally and blocks redirects there",
    (url) => {
      expect(classifyNavigation(url, remoteOrigin, true)).toEqual({
        action: "external",
        url,
      });
      expect(classifyNavigation(url, remoteOrigin, false)).toEqual({
        action: "deny",
      });
    },
  );

  test.each([
    ["http://127.0.0.1:3001/", localOrigin, false],
    ["http://bidtool.example.test/", remoteOrigin, false],
    ["about:blank", remoteOrigin, true],
    ["file:///tmp/viewer.html", remoteOrigin, true],
    ["/dashboard", remoteOrigin, true],
    ["https://guest@docs.example.test/", remoteOrigin, true],
    [`${remoteOrigin}/`, undefined, true],
  ] as const)("denies %s in this navigation context", (url, origin, link) => {
    expect(classifyNavigation(url, origin, link)).toEqual({ action: "deny" });
  });
});
