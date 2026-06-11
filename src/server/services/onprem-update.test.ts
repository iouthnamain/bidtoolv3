import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyOnPremUpdate,
  canApplyInAppOnPremUpdates,
} from "./onprem-update";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("onprem update service", () => {
  beforeEach(() => {
    vi.stubEnv("BIDTOOL_ALLOW_IN_APP_UPDATES", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("reports when in-app updates are disabled", () => {
    vi.stubEnv("BIDTOOL_ALLOW_IN_APP_UPDATES", "false");
    expect(canApplyInAppOnPremUpdates()).toBe(false);
  });

  it("runs the on-prem update script with the target image tag", async () => {
    const closeHandlers: Array<(code: number | null) => void> = [];

    vi.mocked(spawn).mockImplementation(() => {
      return {
        stdout: {
          setEncoding: vi.fn(),
          on: vi.fn(),
        },
        stderr: {
          setEncoding: vi.fn(),
          on: vi.fn(),
        },
        once: vi.fn((event: string, handler: (code: number | null) => void) => {
          if (event === "close") {
            closeHandlers.push(handler);
          }
        }),
      } as never;
    });

    const promise = applyOnPremUpdate("v0.2.0");
    closeHandlers[0]?.(0);

    await expect(promise).resolves.toEqual({
      message: "Đã áp dụng cập nhật on-prem 0.2.0.",
      version: "0.2.0",
    });

    expect(spawn).toHaveBeenCalledWith(
      "sh",
      [expect.stringContaining("scripts/onprem-update.sh")],
      expect.objectContaining({
        env: expect.objectContaining({
          BIDTOOL_IMAGE_TAG: "0.2.0",
        }) as Record<string, string>,
      }),
    );
  });

  it("rejects when the update script exits with an error", async () => {
    const closeHandlers: Array<(code: number | null) => void> = [];

    vi.mocked(spawn).mockImplementation(() => {
      return {
        stdout: {
          setEncoding: vi.fn(),
          on: vi.fn((event: string, handler: (chunk: string) => void) => {
            if (event === "data") {
              handler("");
            }
          }),
        },
        stderr: {
          setEncoding: vi.fn(),
          on: vi.fn((event: string, handler: (chunk: string) => void) => {
            if (event === "data") {
              handler("docker not found");
            }
          }),
        },
        once: vi.fn((event: string, handler: (code: number | null) => void) => {
          if (event === "close") {
            closeHandlers.push(handler);
          }
        }),
      } as never;
    });

    const promise = applyOnPremUpdate("0.2.0");
    closeHandlers[0]?.(1);

    await expect(promise).rejects.toThrow(
      "Không thể áp dụng cập nhật on-prem: docker not found",
    );
  });
});
