const { contextBridge, ipcRenderer } = require("electron");

const UPDATE_GET_STATE_CHANNEL = "bidtool:update:get-state";
const UPDATE_CHECK_CHANNEL = "bidtool:update:check";
const UPDATE_DOWNLOAD_CHANNEL = "bidtool:update:download";
const UPDATE_INSTALL_CHANNEL = "bidtool:update:install";
const UPDATE_STATE_CHANNEL = "bidtool:update-state";
const SERVER_CONFIG_GET_CHANNEL = "bidtool:server-config:get";
const SERVER_CONFIG_SET_CHANNEL = "bidtool:server-config:set";
const SERVER_CONFIG_CLEAR_CHANNEL = "bidtool:server-config:clear";
const SERVER_CONFIG_RELOAD_CHANNEL = "bidtool:server-config:reload";
const EXPORT_PICK_FOLDER_CHANNEL = "bidtool:export:pick-folder";

contextBridge.exposeInMainWorld("bidtoolDesktop", {
  isDesktop: true,
  getServerConfig: () => ipcRenderer.invoke(SERVER_CONFIG_GET_CHANNEL),
  /** @param {string} serverUrl */
  setServerUrl: (serverUrl) =>
    ipcRenderer.invoke(SERVER_CONFIG_SET_CHANNEL, serverUrl),
  clearServerUrl: () => ipcRenderer.invoke(SERVER_CONFIG_CLEAR_CHANNEL),
  reloadToServerUrl: () => ipcRenderer.invoke(SERVER_CONFIG_RELOAD_CHANNEL),
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  /** @param {string | undefined} defaultPath */
  pickExportFolder: (defaultPath) =>
    ipcRenderer.invoke(EXPORT_PICK_FOLDER_CHANNEL, defaultPath),
  /** @param {(state: unknown) => void} listener */
  onUpdateState: (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }

    /**
     * @param {Electron.IpcRendererEvent} _event
     * @param {unknown} state
     */
    const wrappedListener = (_event, state) => {
      if (!state || typeof state !== "object") {
        return;
      }
      listener(state);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
});
