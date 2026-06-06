const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 90_000;
const UPDATE_STARTUP_DELAY_MS = 15_000;
const UPDATE_POLL_INTERVAL_MS = 30 * 60_000;
const UPDATE_GET_STATE_CHANNEL = "bidtool:update:get-state";
const UPDATE_CHECK_CHANNEL = "bidtool:update:check";
const UPDATE_DOWNLOAD_CHANNEL = "bidtool:update:download";
const UPDATE_INSTALL_CHANNEL = "bidtool:update:install";
const UPDATE_STATE_CHANNEL = "bidtool:update-state";
const SERVER_CONFIG_GET_CHANNEL = "bidtool:server-config:get";
const SERVER_CONFIG_SET_CHANNEL = "bidtool:server-config:set";
const SERVER_CONFIG_CLEAR_CHANNEL = "bidtool:server-config:clear";
const SERVER_CONFIG_RELOAD_CHANNEL = "bidtool:server-config:reload";

/** @type {import("node:child_process").ChildProcess | null} */
let nextServerProcess = null;
/** @type {string | null} */
let appOrigin = null;
let isQuitting = false;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateInstallInFlight = false;
let updaterConfigured = false;
let updaterListenersRegistered = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let updateStartupTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let updatePollTimer = null;

/** @typedef {"disabled" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error"} DesktopUpdateStatus */
/** @typedef {"check" | "download" | "install" | null} DesktopUpdateErrorContext */
/** @typedef {"env" | "user" | "none"} DesktopServerConfigSource */

/**
 * @typedef {object} DesktopUpdateState
 * @property {boolean} enabled
 * @property {DesktopUpdateStatus} status
 * @property {string} currentVersion
 * @property {NodeJS.Platform} platform
 * @property {string | null} availableVersion
 * @property {string | null} downloadedVersion
 * @property {number | null} downloadPercent
 * @property {string | null} checkedAt
 * @property {string | null} message
 * @property {DesktopUpdateErrorContext} errorContext
 * @property {boolean} canRetry
 */

/**
 * @typedef {object} DesktopServerConfig
 * @property {string | null} serverUrl
 * @property {DesktopServerConfigSource} source
 * @property {boolean} canEdit
 */

/** @type {DesktopUpdateState} */
let desktopUpdateState = createDesktopUpdateState({
  enabled: false,
  message: "Automatic updates are available only in packaged desktop builds.",
  status: "disabled",
});

function getCurrentVersion() {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

/**
 * @param {{
 *   enabled: boolean;
 *   status: DesktopUpdateStatus;
 *   message?: string | null;
 * }} input
 * @returns {DesktopUpdateState}
 */
function createDesktopUpdateState(input) {
  return {
    availableVersion: null,
    canRetry: false,
    checkedAt: null,
    currentVersion: getCurrentVersion(),
    downloadedVersion: null,
    downloadPercent: null,
    enabled: input.enabled,
    errorContext: null,
    message: input.message ?? null,
    platform: process.platform,
    status: input.status,
  };
}

/** @param {DesktopUpdateState} state */
function emitDesktopUpdateState(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATE_STATE_CHANNEL, state);
    }
  }
}

/** @param {(state: DesktopUpdateState) => DesktopUpdateState} updater */
function updateDesktopUpdateState(updater) {
  desktopUpdateState = updater(desktopUpdateState);
  emitDesktopUpdateState(desktopUpdateState);
  return desktopUpdateState;
}

function nowIso() {
  return new Date().toISOString();
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {unknown} info */
function updateVersionFromInfo(info) {
  if (!info || typeof info !== "object") {
    return null;
  }

  const version = /** @type {{ version?: unknown }} */ (info).version;
  return typeof version === "string" && version.trim() ? version : null;
}

function resolveDesktopUpdateDisabledReason() {
  const disabledByEnv = ["1", "true", "yes"].includes(
    String(process.env.BIDTOOL_DISABLE_AUTO_UPDATE ?? "").toLowerCase(),
  );

  if (!app.isPackaged) {
    return "Automatic updates are available only in packaged desktop builds.";
  }
  if (disabledByEnv) {
    return "Automatic updates are disabled by BIDTOOL_DISABLE_AUTO_UPDATE.";
  }
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    return "Automatic updates on Linux require the AppImage build.";
  }
  return null;
}

function markDesktopUpdateIdle() {
  updateDesktopUpdateState((state) => ({
    ...state,
    canRetry: false,
    currentVersion: getCurrentVersion(),
    enabled: true,
    errorContext: null,
    message: null,
    status: "idle",
  }));
}

/**
 * @param {DesktopUpdateErrorContext} context
 * @param {string} message
 */
function markDesktopUpdateError(context, message) {
  updateDesktopUpdateState((state) => {
    const hasDownloadedVersion = !!state.downloadedVersion;
    const hasAvailableVersion = !!state.availableVersion;
    const status =
      context === "install" && hasDownloadedVersion
        ? "downloaded"
        : context === "download" && hasAvailableVersion
          ? "available"
          : "error";

    return {
      ...state,
      canRetry:
        hasDownloadedVersion || hasAvailableVersion || context === "check",
      checkedAt: context === "check" ? nowIso() : state.checkedAt,
      downloadPercent: null,
      errorContext: context,
      message,
      status,
    };
  });
}

function scheduleDesktopUpdateChecks() {
  if (updateStartupTimer || updatePollTimer) {
    return;
  }

  updateStartupTimer = setTimeout(() => {
    void checkForDesktopUpdates("startup");
  }, UPDATE_STARTUP_DELAY_MS);
  updateStartupTimer.unref?.();

  updatePollTimer = setInterval(() => {
    void checkForDesktopUpdates("poll");
  }, UPDATE_POLL_INTERVAL_MS);
  updatePollTimer.unref?.();
}

function registerDesktopUpdaterListeners() {
  if (updaterListenersRegistered) {
    return;
  }
  updaterListenersRegistered = true;

  autoUpdater.on("checking-for-update", () => {
    updateDesktopUpdateState((state) => ({
      ...state,
      checkedAt: nowIso(),
      downloadPercent: null,
      errorContext: null,
      message: null,
      status: "checking",
    }));
  });

  autoUpdater.on("update-available", (info) => {
    const version = updateVersionFromInfo(info);
    updateDesktopUpdateState((state) => ({
      ...state,
      availableVersion: version,
      canRetry: false,
      checkedAt: nowIso(),
      downloadedVersion: null,
      downloadPercent: null,
      errorContext: null,
      message: null,
      status: "available",
    }));
  });

  autoUpdater.on("update-not-available", () => {
    updateDesktopUpdateState((state) => ({
      ...state,
      availableVersion: null,
      canRetry: false,
      checkedAt: nowIso(),
      downloadedVersion: null,
      downloadPercent: null,
      errorContext: null,
      message: null,
      status: "up-to-date",
    }));
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent =
      progress && typeof progress.percent === "number"
        ? Math.max(0, Math.min(100, progress.percent))
        : null;

    updateDesktopUpdateState((state) => ({
      ...state,
      canRetry: false,
      downloadPercent: percent,
      errorContext: null,
      message: null,
      status: "downloading",
    }));
  });

  autoUpdater.on("update-downloaded", (info) => {
    const version =
      updateVersionFromInfo(info) ?? desktopUpdateState.availableVersion;
    updateDesktopUpdateState((state) => ({
      ...state,
      availableVersion: version,
      canRetry: true,
      downloadedVersion: version,
      downloadPercent: 100,
      errorContext: null,
      message: null,
      status: "downloaded",
    }));
  });

  autoUpdater.on("error", (error) => {
    const context = updateInstallInFlight
      ? "install"
      : updateDownloadInFlight
        ? "download"
        : updateCheckInFlight
          ? "check"
          : desktopUpdateState.errorContext;
    markDesktopUpdateError(context, errorMessage(error));
  });
}

function configureDesktopUpdater() {
  loadLocalEnv();
  const disabledReason = resolveDesktopUpdateDisabledReason();
  if (disabledReason) {
    updaterConfigured = false;
    updateDesktopUpdateState(() =>
      createDesktopUpdateState({
        enabled: false,
        message: disabledReason,
        status: "disabled",
      }),
    );
    return;
  }

  registerDesktopUpdaterListeners();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  updaterConfigured = true;
  markDesktopUpdateIdle();
  scheduleDesktopUpdateChecks();
}

/** @param {string} reason */
async function checkForDesktopUpdates(reason) {
  void reason;
  if (!updaterConfigured || updateCheckInFlight) {
    return { checked: false, state: desktopUpdateState };
  }
  if (
    desktopUpdateState.status === "downloading" ||
    desktopUpdateState.status === "downloaded"
  ) {
    return { checked: false, state: desktopUpdateState };
  }

  updateCheckInFlight = true;
  updateDesktopUpdateState((state) => ({
    ...state,
    checkedAt: nowIso(),
    downloadPercent: null,
    errorContext: null,
    message: null,
    status: "checking",
  }));

  try {
    await autoUpdater.checkForUpdates();
    if (desktopUpdateState.status === "checking") {
      updateDesktopUpdateState((state) => ({
        ...state,
        availableVersion: null,
        checkedAt: nowIso(),
        downloadedVersion: null,
        downloadPercent: null,
        errorContext: null,
        message: null,
        status: "up-to-date",
      }));
    }
    return { checked: true, state: desktopUpdateState };
  } catch (error) {
    markDesktopUpdateError("check", errorMessage(error));
    return { checked: true, state: desktopUpdateState };
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadDesktopUpdate() {
  const canDownload =
    updaterConfigured &&
    !updateDownloadInFlight &&
    (desktopUpdateState.status === "available" ||
      (desktopUpdateState.errorContext === "download" &&
        !!desktopUpdateState.availableVersion));

  if (!canDownload) {
    return { accepted: false, completed: false, state: desktopUpdateState };
  }

  updateDownloadInFlight = true;
  updateDesktopUpdateState((state) => ({
    ...state,
    canRetry: false,
    downloadPercent: 0,
    errorContext: null,
    message: null,
    status: "downloading",
  }));

  try {
    await autoUpdater.downloadUpdate();
    if (desktopUpdateState.status === "downloading") {
      const version = desktopUpdateState.availableVersion;
      updateDesktopUpdateState((state) => ({
        ...state,
        canRetry: true,
        downloadedVersion: version,
        downloadPercent: 100,
        errorContext: null,
        message: null,
        status: "downloaded",
      }));
    }
    return { accepted: true, completed: true, state: desktopUpdateState };
  } catch (error) {
    markDesktopUpdateError("download", errorMessage(error));
    return { accepted: true, completed: false, state: desktopUpdateState };
  } finally {
    updateDownloadInFlight = false;
  }
}

async function installDesktopUpdate() {
  if (
    !updaterConfigured ||
    updateInstallInFlight ||
    desktopUpdateState.status !== "downloaded"
  ) {
    return { accepted: false, completed: false, state: desktopUpdateState };
  }

  updateInstallInFlight = true;
  isQuitting = true;
  try {
    autoUpdater.quitAndInstall(false, true);
    return { accepted: true, completed: false, state: desktopUpdateState };
  } catch (error) {
    updateInstallInFlight = false;
    isQuitting = false;
    markDesktopUpdateError("install", errorMessage(error));
    return { accepted: true, completed: false, state: desktopUpdateState };
  }
}

/** @param {URL} url */
function getClientForUrl(url) {
  return url.protocol === "https:" ? https : http;
}

/** @param {string} rawUrl */
function probeUrl(rawUrl) {
  return new Promise((resolve) => {
    /** @type {URL} */
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      resolve(false);
      return;
    }

    const request = getClientForUrl(url).get(url, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) < 500);
    });

    request.setTimeout(1_500, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeUrl(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to allocate a local port."));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function findStandaloneServerPath() {
  const appPath = app.getAppPath();
  const unpackedAppPath = appPath.replace(/app\.asar$/, "app.asar.unpacked");
  const candidates = [
    path.join(unpackedAppPath, ".next", "standalone", "server.js"),
    path.join(appPath, ".next", "standalone", "server.js"),
    path.join(process.cwd(), ".next", "standalone", "server.js"),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "Missing .next/standalone/server.js. Run `bun run build && bun run desktop:prepare` first.",
    );
  }

  return found;
}

/** @param {string} line */
function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const normalized = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trim()
    : trimmed;
  const separatorIndex = normalized.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = normalized.slice(0, separatorIndex).trim();
  let value = normalized.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadLocalEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(path.dirname(process.execPath), ".env"),
    path.join(app.getPath("userData"), ".env"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const contents = fs.readFileSync(candidate, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (parsed && process.env[parsed.key] == null) {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
}

function getDesktopConfigPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

function readDesktopConfig() {
  const configPath = getDesktopConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

/** @param {Record<string, unknown>} config */
function writeDesktopConfig(config) {
  const configPath = getDesktopConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/** @param {string} rawUrl */
function normalizeServerUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("Server URL is required.");
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Server URL must be a valid http:// or https:// URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Server URL must start with http:// or https://.");
  }

  parsed.hash = "";
  parsed.search = "";
  if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString().replace(/\/$/, "");
}

/** @returns {DesktopServerConfig} */
function getDesktopServerConfig() {
  const envServerUrl = process.env.BIDTOOL_SERVER_URL?.trim();
  if (envServerUrl) {
    return {
      canEdit: false,
      serverUrl: normalizeServerUrl(envServerUrl),
      source: "env",
    };
  }

  const config = readDesktopConfig();
  const serverUrl =
    typeof config.serverUrl === "string" && config.serverUrl.trim()
      ? normalizeServerUrl(config.serverUrl)
      : null;

  return {
    canEdit: true,
    serverUrl,
    source: serverUrl ? "user" : "none",
  };
}

/** @param {unknown} rawUrl */
function saveDesktopServerUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    throw new Error("Server URL must be a string.");
  }

  const normalizedUrl = normalizeServerUrl(rawUrl);
  const config = readDesktopConfig();
  writeDesktopConfig({ ...config, serverUrl: normalizedUrl });
  return getDesktopServerConfig();
}

function clearDesktopServerUrl() {
  const config = readDesktopConfig();
  delete config.serverUrl;
  writeDesktopConfig(config);
  return getDesktopServerConfig();
}

async function startStandaloneNextServer() {
  loadLocalEnv();
  const port =
    Number(process.env.BIDTOOL_DESKTOP_PORT) || (await findAvailablePort());
  const serverPath = findStandaloneServerPath();
  const serverDir = path.dirname(serverPath);
  const url = `http://${HOST}:${port}`;
  let exited = false;

  nextServerProcess = spawn(process.execPath, [serverPath], {
    cwd: serverDir,
    env: {
      ...process.env,
      BIDTOOL_DESKTOP: "1",
      ELECTRON_RUN_AS_NODE: "1",
      FORCE_COLOR: "0",
      HOSTNAME: HOST,
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  nextServerProcess.stdout?.on("data", (chunk) => {
    if (!app.isPackaged) {
      process.stdout.write(chunk);
    }
  });
  nextServerProcess.stderr?.on("data", (chunk) => {
    if (!app.isPackaged) {
      process.stderr.write(chunk);
    }
  });
  nextServerProcess.once("exit", (code) => {
    exited = true;
    if (!isQuitting) {
      dialog.showErrorBox(
        "BidTool server stopped",
        `The local Next.js server exited with code ${code ?? "unknown"}.`,
      );
      app.quit();
    }
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (exited) {
      throw new Error(
        "The local Next.js server exited before it became ready.",
      );
    }
    if (await probeUrl(url)) {
      return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for local Next.js server at ${url}`);
}

/** @param {string} rawUrl */
function isAllowedAppUrl(rawUrl) {
  if (!appOrigin || rawUrl === "about:blank") {
    return true;
  }

  try {
    return new URL(rawUrl).origin === appOrigin;
  } catch {
    return false;
  }
}

/** @param {string} startUrl */
async function createMainWindow(startUrl) {
  appOrigin = new URL(startUrl).origin;

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    title: "BidTool v3",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAppUrl(url)) {
      return { action: "allow" };
    }

    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedAppUrl(url)) {
      return;
    }

    event.preventDefault();
    void shell.openExternal(url);
  });

  await mainWindow.loadURL(startUrl);
}

async function resolveStartUrl() {
  const devUrl = process.env.BIDTOOL_DESKTOP_DEV_URL?.trim();
  if (devUrl) {
    await waitForUrl(devUrl, START_TIMEOUT_MS);
    return devUrl;
  }

  const serverConfig = getDesktopServerConfig();
  if (serverConfig.serverUrl) {
    await waitForUrl(serverConfig.serverUrl, START_TIMEOUT_MS);
    return serverConfig.serverUrl;
  }

  return await startStandaloneNextServer();
}

async function reloadWindowsToStartUrl() {
  const serverConfig = getDesktopServerConfig();
  if (serverConfig.serverUrl && nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill();
    nextServerProcess = null;
  }

  const startUrl = await resolveStartUrl();
  appOrigin = new URL(startUrl).origin;

  await Promise.all(
    BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed())
      .map((window) => window.loadURL(startUrl)),
  );

  return { loadedUrl: startUrl, serverConfig: getDesktopServerConfig() };
}

app.on("before-quit", () => {
  isQuitting = true;
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
  }
  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill();
  }
});

ipcMain.handle(UPDATE_GET_STATE_CHANNEL, () => desktopUpdateState);
ipcMain.handle(UPDATE_CHECK_CHANNEL, () => checkForDesktopUpdates("manual"));
ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, () => downloadDesktopUpdate());
ipcMain.handle(UPDATE_INSTALL_CHANNEL, () => installDesktopUpdate());
ipcMain.handle(SERVER_CONFIG_GET_CHANNEL, () => getDesktopServerConfig());
ipcMain.handle(SERVER_CONFIG_SET_CHANNEL, (_event, serverUrl) =>
  saveDesktopServerUrl(serverUrl),
);
ipcMain.handle(SERVER_CONFIG_CLEAR_CHANNEL, () => clearDesktopServerUrl());
ipcMain.handle(SERVER_CONFIG_RELOAD_CHANNEL, () => reloadWindowsToStartUrl());

app.whenReady().then(async () => {
  try {
    loadLocalEnv();
    const startUrl = await resolveStartUrl();
    await createMainWindow(startUrl);
    configureDesktopUpdater();
  } catch (error) {
    const serverConfig = getDesktopServerConfig();
    if (serverConfig.source === "user" && serverConfig.serverUrl) {
      const result = await dialog.showMessageBox({
        buttons: ["Clear server URL", "Quit"],
        defaultId: 0,
        message: "BidTool could not reach the configured on-prem server.",
        detail: `${serverConfig.serverUrl}\n\nClear the saved server URL to open the bundled local app and edit desktop settings.`,
        type: "warning",
      });

      if (result.response === 0) {
        clearDesktopServerUrl();
        try {
          const startUrl = await resolveStartUrl();
          await createMainWindow(startUrl);
          configureDesktopUpdater();
          return;
        } catch {
          // Fall through to the standard error below.
        }
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("BidTool desktop failed to start", message);
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length > 0) {
    return;
  }

  try {
    const startUrl = appOrigin ?? (await resolveStartUrl());
    await createMainWindow(startUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("BidTool desktop failed to start", message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
