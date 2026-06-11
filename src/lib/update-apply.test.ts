import { describe, expect, it } from "vitest";

import type { DesktopUpdateState } from "~/lib/desktop-update";
import {
  getApplyUpdateButtonLabel,
  resolveApplyUpdateAction,
  shouldShowApplyUpdateButton,
} from "~/lib/update-apply";

const idleDesktopState: DesktopUpdateState = {
  enabled: true,
  status: "available",
  currentVersion: "0.1.0",
  platform: "linux",
  availableVersion: "0.2.0",
  downloadedVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: true,
};

describe("update apply helpers", () => {
  it("routes on-prem updates to in-app apply when enabled", () => {
    expect(
      resolveApplyUpdateAction({
        version: {
          surface: "onprem",
          updateAvailable: true,
          latest: "0.2.0",
          canApplyInApp: true,
        },
        desktopState: null,
        isDesktop: false,
      }),
    ).toBe("run-onprem");
  });

  it("routes on-prem updates to copy command when in-app apply is disabled", () => {
    expect(
      resolveApplyUpdateAction({
        version: {
          surface: "onprem",
          updateAvailable: true,
          latest: "0.2.0",
          canApplyInApp: false,
        },
        desktopState: null,
        isDesktop: false,
      }),
    ).toBe("copy-onprem-command");
  });

  it("prioritizes desktop apply actions when running in Electron", () => {
    expect(
      resolveApplyUpdateAction({
        version: {
          surface: "onprem",
          updateAvailable: true,
          latest: "0.2.0",
          canApplyInApp: false,
        },
        desktopState: idleDesktopState,
        isDesktop: true,
      }),
    ).toBe("desktop-download");
  });

  it("shows refresh action for web surfaces", () => {
    expect(
      shouldShowApplyUpdateButton({
        version: {
          surface: "web",
          updateAvailable: false,
          latest: "0.2.0",
          canApplyInApp: false,
        },
        desktopState: null,
        isDesktop: false,
      }),
    ).toBe(true);
    expect(getApplyUpdateButtonLabel("refresh")).toBe("Kiểm tra lại");
  });
});
