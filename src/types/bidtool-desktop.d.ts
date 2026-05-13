import type {
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
} from "~/lib/desktop-update";

declare global {
  interface Window {
    bidtoolDesktop?: {
      isDesktop: true;
      getUpdateState: () => Promise<DesktopUpdateState>;
      checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
      downloadUpdate: () => Promise<DesktopUpdateActionResult>;
      installUpdate: () => Promise<DesktopUpdateActionResult>;
      onUpdateState: (
        listener: (state: DesktopUpdateState) => void,
      ) => () => void;
    };
  }
}

export {};
