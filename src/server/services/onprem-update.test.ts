import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { versionRouter } from "~/server/api/routers/version";
import { createTRPCContext } from "~/server/api/trpc";
import {
  applyOnPremUpdate,
  canApplyInAppOnPremUpdates,
} from "./onprem-update";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    throw new Error("Unexpected process spawn");
  }),
}));
vi.mock("~/server/db", () => ({ db: {} }));

const unsupportedMessage =
  "Cập nhật on-prem trong ứng dụng không được hỗ trợ. Sao chép lệnh cập nhật và chạy trên máy chủ hosting Docker.";

describe("onprem update service", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([undefined, "false", "true"])(
    "reports no in-app capability with legacy flag %s",
    (flag) => {
      vi.stubEnv("BIDTOOL_ALLOW_IN_APP_UPDATES", flag);
      expect(canApplyInAppOnPremUpdates()).toBe(false);
    },
  );

  it.each(["v0.2.0", "not-a-version"])(
    "rejects direct update %s without spawning even with the legacy flag",
    async (version) => {
      vi.stubEnv("BIDTOOL_ALLOW_IN_APP_UPDATES", "true");

      await expect(applyOnPremUpdate(version)).rejects.toThrow(unsupportedMessage);
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { version: "0.2.0" }, { version: "not-a-version" }])(
    "rejects the legacy mutation with %j without fetching a manifest or spawning",
    async (input) => {
      vi.stubEnv("BIDTOOL_ALLOW_IN_APP_UPDATES", "true");
      const fetchMock = vi.fn(() => {
        throw new Error("Unexpected manifest fetch");
      });
      vi.stubGlobal("fetch", fetchMock);
      const caller = versionRouter.createCaller(
        await createTRPCContext({ headers: new Headers() }),
      );

      await expect(caller.applyOnPremUpdate(input)).rejects.toMatchObject({
        code: "NOT_IMPLEMENTED",
        message: unsupportedMessage,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    },
  );
});
