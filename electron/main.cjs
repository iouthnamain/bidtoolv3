const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  classifyNavigation,
  isApprovedAppFrame,
  isApprovedIpcSender,
  parseHttpUrl,
  resolveProbeRedirect,
} = require("./window-policy.cjs");

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
const EXPORT_PICK_FOLDER_CHANNEL = "bidtool:export:pick-folder";

/** @type {import("node:child_process").ChildProcess | null} */
let nextServerProcess = null;
/** @type {string | null} */
let bundledServerUrl = null;
/** @type {WeakMap<Electron.WebContents, string>} */
const appWindowOrigins = new WeakMap();
/** @type {string | null} */
let lastAppUrl = null;
let reloadInFlight = false;
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
    if (window.isDestroyed()) continue;
    const { webContents } = window;
    const appOrigin = appWindowOrigins.get(webContents);
    if (
      appOrigin &&
      !webContents.isDestroyed() &&
      isApprovedAppFrame(webContents.mainFrame, appOrigin)
    ) {
      webContents.send(UPDATE_STATE_CHANNEL, state);
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

function configureMockDesktopUpdaterFeed() {
  const mockEnabled = ["1", "true", "yes"].includes(
    String(process.env.BIDTOOL_DESKTOP_MOCK_UPDATES ?? "").toLowerCase(),
  );
  if (!mockEnabled) {
    return;
  }

  const port = String(
    process.env.BIDTOOL_DESKTOP_MOCK_UPDATE_PORT ?? "3000",
  ).trim();
  autoUpdater.setFeedURL({
    provider: "generic",
    url: `http://127.0.0.1:${port}/`,
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

  configureMockDesktopUpdaterFeed();

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
    reloadInFlight ||
    desktopUpdateState.status !== "downloaded"
  ) {
    return { accepted: false, completed: false, state: desktopUpdateState };
  }

  updateInstallInFlight = true;
  isQuitting = true;
  try {
    await prepareDesktopStorageForInstall();
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

/** @param {string} rawUrl @param {string} [instanceId] @param {number} [remainingRedirects] @returns {Promise<string | null>} */
function probeUrl(rawUrl, instanceId, remainingRedirects = 5) {
  return new Promise((resolve) => {
    /** @type {URL} */
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      resolve(null);
      return;
    }

    const request = getClientForUrl(url).get(url, (response) => {
      response.resume();
      if (instanceId) {
        resolve(
          response.statusCode === 200 &&
            response.headers["x-bidtool-desktop-instance"] === instanceId
            ? rawUrl
            : null,
        );
      } else {
        const status = response.statusCode ?? 500;
        const redirect =
          status >= 300 && status < 400 && response.headers.location
            ? resolveProbeRedirect(url, response.headers.location)
            : null;
        if (!redirect) {
          resolve(status < 500 ? rawUrl : null);
        } else if (remainingRedirects === 0) {
          resolve(null);
        } else {
          resolve(
            probeUrl(redirect, undefined, remainingRedirects - 1).then(
              (ready) =>
                ready && parseHttpUrl(ready)?.origin === url.origin
                  ? rawUrl
                  : ready,
            ),
          );
        }
      }
    });

    request.setTimeout(1_500, () => {
      request.destroy();
      resolve(null);
    });
    request.on("error", () => resolve(null));
  });
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const readyUrl = await probeUrl(url);
    if (readyUrl) return readyUrl;
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

/** @param {string} root */
function desktopDataInventory(root) {
  /** @type {{ path: string; size: number; checksum: string }[]} */
  const files = [];
  /** @param {string} directory */
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Legacy data contains a symlink: ${file}`);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        files.push({
          path: path.relative(root, file),
          size: fs.statSync(file).size,
          checksum: crypto
            .createHash("sha256")
            .update(fs.readFileSync(file))
            .digest("hex"),
        });
      } else throw new Error(`Unsupported legacy data entry: ${file}`);
    }
  }
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Runs only for a bundled child, before spawn. Retain the original files so a
 * failed copy or desktop upgrade never destroys the only recoverable copy.
 * @param {string} serverDir
 */
function prepareDesktopDataRoot(serverDir) {
  const configured = process.env.BIDTOOL_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  const target = path.join(app.getPath("userData"), "data");
  const legacy = path.join(serverDir, "data");
  if (path.resolve(legacy) === path.resolve(target) || !fs.existsSync(legacy))
    return target;
  const source = desktopDataInventory(legacy);
  if (source.length === 0) return target;
  const marker = path.join(app.getPath("userData"), "data-migration.json");
  const record = {
    legacy: path.resolve(legacy),
    target: path.resolve(target),
    source,
  };
  if (fs.existsSync(marker) && fs.existsSync(target)) {
    if (fs.readFileSync(marker, "utf8") !== JSON.stringify(record)) {
      throw new Error(
        `Legacy data changed after migration. Preserve ${legacy} and ${target} for manual recovery.`,
      );
    }
    return target;
  }
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    // A retry can accept an identical verified copy, but must never merge or
    // overwrite a live installation with older packaged bytes.
    const existing = desktopDataInventory(target);
    const copied = source.every((file) =>
      existing.some(
        (entry) =>
          entry.path === file.path &&
          entry.checksum === file.checksum &&
          entry.size === file.size,
      ),
    );
    if (!copied)
      throw new Error(
        `Legacy data conflicts with ${target}. Preserve both directories and migrate manually before starting.`,
      );
    fs.writeFileSync(marker, JSON.stringify(record), {
      flag: "wx",
      mode: 0o600,
    });
    return target;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(
    path.join(path.dirname(target), ".data-migration-"),
  );
  // Keep staging on failure for inspection; publish only a verified full tree.
  for (const name of fs.readdirSync(legacy)) {
    fs.cpSync(path.join(legacy, name), path.join(staging, name), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  if (
    JSON.stringify(desktopDataInventory(staging)) !== JSON.stringify(source)
  ) {
    throw new Error(
      `Desktop data checksum mismatch. Retained ${staging} and ${legacy}.`,
    );
  }
  if (fs.existsSync(target)) fs.rmdirSync(target); // Empty destination only.
  fs.renameSync(staging, target);
  fs.writeFileSync(marker, JSON.stringify(record), { flag: "wx", mode: 0o600 });
  return target;
}

async function stopBundledServer() {
  const child = nextServerProcess;
  if (child && child.exitCode === null && child.signalCode === null) {
    // A sent signal is not proof that filesystem writers have stopped.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error("Local server did not stop; desktop update blocked."),
          ),
        30_000,
      );
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      if (!child.killed && !child.kill()) {
        clearTimeout(timer);
        reject(
          new Error("Could not stop local server; desktop update blocked."),
        );
      }
    });
  }
  if (nextServerProcess === child) {
    nextServerProcess = null;
    bundledServerUrl = null;
  }
}

async function prepareDesktopStorageForInstall() {
  const hadLocalServer = nextServerProcess !== null;
  await stopBundledServer();
  if (hadLocalServer || !getDesktopServerConfig().serverUrl) {
    prepareDesktopDataRoot(path.dirname(findStandaloneServerPath()));
  }
}

async function startStandaloneNextServer() {
  if (
    bundledServerUrl &&
    nextServerProcess?.exitCode === null &&
    !nextServerProcess.killed
  )
    return bundledServerUrl;
  if (nextServerProcess) await stopBundledServer();
  loadLocalEnv();
  const port =
    Number(process.env.BIDTOOL_DESKTOP_PORT) || (await findAvailablePort());
  const serverPath = findStandaloneServerPath();
  const serverDir = path.dirname(serverPath);
  const dataRoot = prepareDesktopDataRoot(serverDir);
  const url = `http://${HOST}:${port}`;
  const instanceId = crypto.randomUUID();
  let exited = false;

  const serverProcess = spawn(process.execPath, [serverPath], {
    cwd: serverDir,
    env: {
      ...process.env,
      BIDTOOL_DESKTOP: "1",
      BIDTOOL_DESKTOP_INSTANCE: instanceId,
      BIDTOOL_DATA_DIR: dataRoot,
      ELECTRON_RUN_AS_NODE: "1",
      FORCE_COLOR: "0",
      HOSTNAME: HOST,
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  nextServerProcess = serverProcess;

  serverProcess.stdout?.on("data", (chunk) => {
    if (!app.isPackaged) {
      process.stdout.write(chunk);
    }
  });
  serverProcess.stderr?.on("data", (chunk) => {
    if (!app.isPackaged) {
      process.stderr.write(chunk);
    }
  });
  serverProcess.once("exit", (code) => {
    exited = true;
    const servingLocalWindow =
      nextServerProcess === serverProcess &&
      lastAppUrl !== null &&
      parseHttpUrl(lastAppUrl)?.origin === url;
    if (!isQuitting && !serverProcess.killed && servingLocalWindow) {
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
    if (await probeUrl(`${url}/api/health`, instanceId)) {
      bundledServerUrl = url;
      return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for local Next.js server at ${url}`);
}

/**
 * @param {Electron.WebContents} webContents
 * @param {() => string | undefined} getAppOrigin
 */
function guardAppNavigation(webContents, getAppOrigin) {
  /** @param {string} url */
  function openExternalLink(url) {
    void shell.openExternal(url).catch((error) => {
      console.warn("Could not open external link.", errorMessage(error));
    });
  }

  webContents.setWindowOpenHandler(({ url }) => {
    const policy = classifyNavigation(url, getAppOrigin(), true);
    if (policy.action === "external") openExternalLink(policy.url);
    return { action: policy.action === "allow" ? "allow" : "deny" };
  });

  webContents.on("will-navigate", (event) => {
    const policy = classifyNavigation(event.url, getAppOrigin(), true);
    if (policy.action === "allow") return;
    event.preventDefault();
    if (policy.action === "external") openExternalLink(policy.url);
  });

  webContents.on("will-redirect", (event) => {
    if (
      event.isMainFrame &&
      classifyNavigation(event.url, getAppOrigin(), false).action !== "allow"
    ) {
      event.preventDefault();
    }
  });

  webContents.on("did-create-window", (window, { url }) => {
    // Same-origin viewers such as catalog PDFs keep the opener's URL policy.
    const origin = parseHttpUrl(url)?.origin;
    guardAppNavigation(window.webContents, () => origin);
  });
}

/** @param {Electron.BrowserWindow} window @param {string} startUrl */
async function loadAppWindow(window, startUrl) {
  const appOrigin = parseHttpUrl(startUrl)?.origin;
  if (!appOrigin)
    throw new Error("Địa chỉ ứng dụng desktop phải dùng HTTP hoặc HTTPS.");

  const { webContents } = window;
  const previousOrigin = appWindowOrigins.get(webContents);
  // Set the origin before loading so redirects and startup IPC use the new URL.
  appWindowOrigins.set(webContents, appOrigin);
  try {
    await window.loadURL(startUrl);
    lastAppUrl = startUrl;
  } catch (error) {
    if (previousOrigin) {
      appWindowOrigins.set(webContents, previousOrigin);
    } else appWindowOrigins.delete(webContents);
    throw error;
  }
}

/** @param {string} startUrl */
async function createMainWindow(startUrl) {
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

  const { webContents } = mainWindow;
  guardAppNavigation(webContents, () => appWindowOrigins.get(webContents));

  await loadAppWindow(mainWindow, startUrl);
}

async function resolveStartUrl() {
  const devUrl = process.env.BIDTOOL_DESKTOP_DEV_URL?.trim();
  if (devUrl) {
    return waitForUrl(devUrl, START_TIMEOUT_MS);
  }

  const serverConfig = getDesktopServerConfig();
  if (serverConfig.serverUrl) {
    return waitForUrl(serverConfig.serverUrl, START_TIMEOUT_MS);
  }

  return await startStandaloneNextServer();
}

async function reloadWindowsToStartUrl() {
  if (reloadInFlight || updateInstallInFlight)
    throw new Error("BidTool đang chuyển server hoặc cài bản cập nhật.");
  reloadInFlight = true;
  try {
    const serverConfig = getDesktopServerConfig();
    const startUrl = await resolveStartUrl();

    const windows = BrowserWindow.getAllWindows().filter(
      (window) =>
        !window.isDestroyed() && appWindowOrigins.has(window.webContents),
    );
    const previousAppUrl = lastAppUrl;
    const results = await Promise.allSettled(
      windows.map((window) => loadAppWindow(window, startUrl)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure) {
      if (previousAppUrl) {
        const settingsUrl = new URL("/settings/desktop", previousAppUrl).href;
        await Promise.allSettled(
          windows.map((window) => loadAppWindow(window, settingsUrl)),
        );
      }
      throw failure.reason;
    }

    // Keep the bundled server available until the configured app has loaded.
    if (
      serverConfig.serverUrl &&
      !process.env.BIDTOOL_DESKTOP_DEV_URL?.trim()
    ) {
      await stopBundledServer().catch((error) => {
        console.warn(
          "Could not stop the local BidTool server after switching.",
          errorMessage(error),
        );
      });
    }

    return { loadedUrl: startUrl, serverConfig: getDesktopServerConfig() };
  } finally {
    reloadInFlight = false;
  }
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

/** @param {string} channel @param {(arg: unknown) => unknown} listener */
function handleAppIpc(channel, listener) {
  ipcMain.handle(channel, (event, arg) => {
    if (!isApprovedIpcSender(event, appWindowOrigins)) {
      throw new Error("Chỉ cửa sổ ứng dụng BidTool được phép gọi IPC desktop.");
    }
    return listener(arg);
  });
}

handleAppIpc(UPDATE_GET_STATE_CHANNEL, () => desktopUpdateState);
handleAppIpc(UPDATE_CHECK_CHANNEL, () => checkForDesktopUpdates("manual"));
handleAppIpc(UPDATE_DOWNLOAD_CHANNEL, downloadDesktopUpdate);
handleAppIpc(UPDATE_INSTALL_CHANNEL, installDesktopUpdate);
handleAppIpc(SERVER_CONFIG_GET_CHANNEL, getDesktopServerConfig);
handleAppIpc(SERVER_CONFIG_SET_CHANNEL, saveDesktopServerUrl);
handleAppIpc(SERVER_CONFIG_CLEAR_CHANNEL, clearDesktopServerUrl);
handleAppIpc(SERVER_CONFIG_RELOAD_CHANNEL, reloadWindowsToStartUrl);
handleAppIpc(EXPORT_PICK_FOLDER_CHANNEL, async (defaultPath) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    defaultPath:
      typeof defaultPath === "string" && defaultPath.trim().length > 0
        ? defaultPath.trim()
        : app.getPath("downloads"),
    title: "Chọn thư mục export",
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { path: null };
  }
  return { path: result.filePaths[0] ?? null };
});

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
    const startUrl = lastAppUrl ?? (await resolveStartUrl());
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
