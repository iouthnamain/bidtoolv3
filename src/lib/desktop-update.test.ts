import { describe, expect, it } from "vitest";

import {
  canCheckForDesktopUpdate,
  getAdminUpdateNoticeKey,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowAdminUpdateBanner,
  shouldShowDesktopUpdateNotice,
  type DesktopUpdateState,
} from "./desktop-update";

const baseState: DesktopUpdateState = {
  availableVersion: null,
  canRetry: false,
  checkedAt: null,
  currentVersion: "0.1.0",
  downloadedVersion: null,
  downloadPercent: null,
  enabled: true,
  errorContext: null,
  message: null,
  platform: "win32",
  status: "idle",
};

describe("desktop update button logic", () => {
  it("shows a download action when an update is available", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      availableVersion: "0.2.0",
      status: "available",
    };

    expect(shouldShowDesktopUpdateNotice(state)).toBe(true);
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
  });

  it("shows an install action after an update is downloaded", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      availableVersion: "0.2.0",
      downloadedVersion: "0.2.0",
      downloadPercent: 100,
      status: "downloaded",
    };

    expect(shouldShowDesktopUpdateNotice(state)).toBe(true);
    expect(resolveDesktopUpdateButtonAction(state)).toBe("install");
  });

  it("keeps the notice visible while downloading but disables the button", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      availableVersion: "0.2.0",
      downloadPercent: 42,
      status: "downloading",
    };

    expect(shouldShowDesktopUpdateNotice(state)).toBe(true);
    expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
    expect(isDesktopUpdateButtonDisabled(state)).toBe(true);
  });

  it("allows retrying a failed download with a known available version", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      availableVersion: "0.2.0",
      errorContext: "download",
      message: "checksum mismatch",
      status: "error",
    };

    expect(shouldShowDesktopUpdateNotice(state)).toBe(true);
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
  });

  it("hides the update notice for idle and disabled states", () => {
    expect(shouldShowDesktopUpdateNotice(baseState)).toBe(false);
    expect(
      shouldShowDesktopUpdateNotice({
        ...baseState,
        enabled: false,
        status: "disabled",
      }),
    ).toBe(false);
  });

  it("allows manual update checks when idle", () => {
    expect(canCheckForDesktopUpdate(baseState)).toBe(true);
    expect(
      canCheckForDesktopUpdate({
        ...baseState,
        status: "downloaded",
        downloadedVersion: "0.2.0",
      }),
    ).toBe(false);
  });

  it("shows on-prem admin banner when server is behind", () => {
    expect(
      shouldShowAdminUpdateBanner({
        surface: "onprem",
        updateAvailable: true,
        latest: "0.2.0",
      }),
    ).toBe(true);
    expect(
      shouldShowAdminUpdateBanner({
        surface: "web",
        updateAvailable: true,
        latest: "0.2.0",
      }),
    ).toBe(false);
    expect(getAdminUpdateNoticeKey("0.1.0", "0.2.0")).toBe("0.1.0:0.2.0");
  });
});
