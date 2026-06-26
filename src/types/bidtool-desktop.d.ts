import type {
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
} from "~/lib/desktop-update";

export interface DesktopServerConfig {
  serverUrl: string | null;
  source: "env" | "user" | "none";
  canEdit: boolean;
}

export interface DesktopServerReloadResult {
  loadedUrl: string;
  serverConfig: DesktopServerConfig;
}

export interface DesktopPickExportFolderResult {
  path: string | null;
}

declare global {
  interface Window {
    bidtoolDesktop?: {
      isDesktop: true;
      getServerConfig: () => Promise<DesktopServerConfig>;
      setServerUrl: (serverUrl: string) => Promise<DesktopServerConfig>;
      clearServerUrl: () => Promise<DesktopServerConfig>;
      reloadToServerUrl: () => Promise<DesktopServerReloadResult>;
      getUpdateState: () => Promise<DesktopUpdateState>;
      checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
      downloadUpdate: () => Promise<DesktopUpdateActionResult>;
      installUpdate: () => Promise<DesktopUpdateActionResult>;
      pickExportFolder: (
        defaultPath?: string,
      ) => Promise<DesktopPickExportFolderResult>;
      onUpdateState: (
        listener: (state: DesktopUpdateState) => void,
      ) => () => void;
    };
  }
}

export {};
