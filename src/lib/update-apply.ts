import {
  canCheckForDesktopUpdate,
  resolveDesktopUpdateButtonAction,
  type DesktopUpdateButtonAction,
  type DesktopUpdateState,
} from "~/lib/desktop-update";

export type ApplyUpdateAction =
  | "none"
  | "check-update"
  | "refresh"
  | "copy-onprem-command"
  | "run-onprem"
  | "desktop-check"
  | "desktop-download"
  | "desktop-install";

export type VersionApplyContext = {
  surface: string;
  updateAvailable: boolean;
  latest: string | null;
  canApplyInApp: boolean;
};

export function resolveApplyUpdateAction(input: {
  version: VersionApplyContext;
  desktopState: DesktopUpdateState | null;
  isDesktop: boolean;
}): ApplyUpdateAction {
  if (input.isDesktop && input.desktopState?.enabled) {
    const desktopAction = resolveDesktopUpdateButtonAction(input.desktopState);
    if (desktopAction === "install") {
      return "desktop-install";
    }
    if (desktopAction === "download") {
      return "desktop-download";
    }
    if (canCheckForDesktopUpdate(input.desktopState)) {
      return "desktop-check";
    }
    return "none";
  }

  if (input.version.surface === "onprem" && input.version.updateAvailable) {
    return input.version.canApplyInApp ? "run-onprem" : "copy-onprem-command";
  }

  if (input.version.surface === "web") {
    return "refresh";
  }

  return "check-update";
}

export function shouldShowApplyUpdateButton(input: {
  version: VersionApplyContext;
  desktopState: DesktopUpdateState | null;
  isDesktop: boolean;
}): boolean {
  return resolveApplyUpdateAction(input) !== "none";
}

export function getApplyUpdateButtonLabel(action: ApplyUpdateAction): string {
  switch (action) {
    case "desktop-install":
      return "Áp dụng cập nhật";
    case "desktop-download":
      return "Tải cập nhật";
    case "desktop-check":
      return "Kiểm tra cập nhật";
    case "run-onprem":
    case "copy-onprem-command":
      return "Áp dụng cập nhật";
    case "refresh":
    case "check-update":
      return "Kiểm tra cập nhật";
    case "none":
      return "Áp dụng cập nhật";
  }
}

export function getOnPremApplyConfirmationMessage(version: string | null): string {
  return `Áp dụng bản cập nhật${version ? ` ${version}` : ""}? Stack Docker sẽ pull image mới, khởi động lại container và chạy migration. Quá trình có thể mất vài phút.`;
}

export function getOnPremCopyCommandConfirmationMessage(): string {
  return "Sao chép lệnh cập nhật và chạy trên máy chủ hosting Docker stack? Lệnh không thể chạy trực tiếp từ container ứng dụng.";
}

export function mapDesktopActionToApplyAction(
  action: DesktopUpdateButtonAction,
): ApplyUpdateAction {
  if (action === "install") {
    return "desktop-install";
  }
  if (action === "download") {
    return "desktop-download";
  }
  return "desktop-check";
}
