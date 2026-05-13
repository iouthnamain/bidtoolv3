const { app, BrowserWindow, dialog, shell } = require("electron");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 90_000;

/** @type {import("node:child_process").ChildProcess | null} */
let nextServerProcess = null;
/** @type {string | null} */
let appOrigin = null;
let isQuitting = false;

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
  const candidates = [
    path.join(app.getAppPath(), ".next", "standalone", "server.js"),
    path.join(process.cwd(), ".next", "standalone", "server.js"),
  ];

  const fs = require("node:fs");
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "Missing .next/standalone/server.js. Run `bun run build && bun run desktop:prepare` first.",
    );
  }

  return found;
}

async function startStandaloneNextServer() {
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

  return await startStandaloneNextServer();
}

app.on("before-quit", () => {
  isQuitting = true;
  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill();
  }
});

app.whenReady().then(async () => {
  try {
    const startUrl = await resolveStartUrl();
    await createMainWindow(startUrl);
  } catch (error) {
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
