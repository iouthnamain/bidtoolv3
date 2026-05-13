export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopUpdateErrorContext = "check" | "download" | "install" | null;

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  platform: NodeJS.Platform;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: DesktopUpdateErrorContext;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export type DesktopUpdateButtonAction = "download" | "install" | "none";

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState | null,
): DesktopUpdateButtonAction {
  if (!state?.enabled) {
    return "none";
  }
  if (state.downloadedVersion || state.status === "downloaded") {
    return "install";
  }
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return "install";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateNotice(
  state: DesktopUpdateState | null,
): boolean {
  if (!state?.enabled) {
    return false;
  }
  if (state.status === "downloading") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function isDesktopUpdateButtonDisabled(
  state: DesktopUpdateState | null,
): boolean {
  return state?.status === "downloading" || state?.status === "checking";
}

export function getDesktopUpdateNoticeKey(
  state: DesktopUpdateState | null,
): string | null {
  if (!state) {
    return null;
  }

  return [
    state.currentVersion,
    state.availableVersion ?? "no-available-version",
    state.downloadedVersion ?? "no-downloaded-version",
    state.status,
  ].join(":");
}

export function getDesktopUpdateActionError(
  result: DesktopUpdateActionResult | DesktopUpdateCheckResult,
): string | null {
  if ("accepted" in result && (!result.accepted || result.completed)) {
    return null;
  }

  const message = result.state.message?.trim();
  if (!message) {
    return null;
  }
  return message;
}
