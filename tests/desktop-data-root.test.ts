import crypto from "node:crypto";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, expect, test, vi } from "vitest";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup(failCopy = false) {
  const root = await mkdtemp(path.join(tmpdir(), "bidtool-desktop-data-"));
  roots.push(root);
  const serverDir = path.join(root, "resources/standalone");
  const userData = path.join(root, "user");
  await mkdir(path.join(serverDir, "data/catalog-pdfs/1"), { recursive: true });
  await writeFile(
    path.join(serverDir, "data/catalog-pdfs/1/catalog.pdf"),
    "%PDF-kept",
  );
  const source = await readFile("electron/main.cjs", "utf8");
  const start = source.indexOf("function desktopDataInventory(");
  const end = source.indexOf("async function startStandaloneNextServer()");
  const prepare: (serverDir: string) => string = vm.runInNewContext(
    source.slice(start, end) + ";prepareDesktopDataRoot",
    {
      path,
      crypto,
      process,
      app: { getPath: () => userData },
      fs: failCopy
        ? {
            ...fs,
            cpSync: () => {
              throw Error("copy failure");
            },
          }
        : fs,
    },
  );
  vi.stubEnv("BIDTOOL_DATA_DIR", "");
  return { root, userData, serverDir, prepare };
}
test("bundled desktop copies legacy bytes before spawn and preserves original on retry", async () => {
  const { userData, serverDir, prepare } = await setup();
  const target = prepare(serverDir);
  expect(target).toBe(path.join(userData, "data"));
  expect(
    await readFile(path.join(target, "catalog-pdfs/1/catalog.pdf"), "utf8"),
  ).toBe("%PDF-kept");
  expect(
    await readFile(
      path.join(serverDir, "data/catalog-pdfs/1/catalog.pdf"),
      "utf8",
    ),
  ).toBe("%PDF-kept");
  expect(prepare(serverDir)).toBe(target);
  await writeFile(
    path.join(target, "catalog-pdfs/1/catalog.pdf"),
    "%PDF-updated-after-migration",
  );
  expect(prepare(serverDir)).toBe(target);
  expect(
    await readFile(path.join(target, "catalog-pdfs/1/catalog.pdf"), "utf8"),
  ).toBe("%PDF-updated-after-migration");
});
test("explicit data root bypasses desktop migration", async () => {
  const { root, userData, serverDir, prepare } = await setup();
  vi.stubEnv("BIDTOOL_DATA_DIR", path.join(root, "explicit"));
  expect(prepare(serverDir)).toBe(path.join(root, "explicit"));
  expect(fs.existsSync(userData)).toBe(false);
});
test("conflicting destination or copy failure preserves the old bytes and blocks start", async () => {
  const fixture = await setup();
  await mkdir(path.join(fixture.userData, "data"), { recursive: true });
  await writeFile(path.join(fixture.userData, "data/keep"), "existing");
  expect(() => fixture.prepare(fixture.serverDir)).toThrow("conflicts");
  expect(await readFile(path.join(fixture.userData, "data/keep"), "utf8")).toBe(
    "existing",
  );
  const failing = await setup(true);
  expect(() => failing.prepare(failing.serverDir)).toThrow("copy failure");
  expect(fs.existsSync(path.join(failing.userData, "data"))).toBe(false);
  expect(
    await readFile(
      path.join(failing.serverDir, "data/catalog-pdfs/1/catalog.pdf"),
      "utf8",
    ),
  ).toBe("%PDF-kept");
});
test("remote server routing bypasses bundled startup and its migration", async () => {
  const source = await readFile("electron/main.cjs", "utf8");
  vi.stubEnv("BIDTOOL_DESKTOP_DEV_URL", "");
  const start = source.indexOf("async function resolveStartUrl()");
  const end = source.indexOf("async function reloadWindowsToStartUrl()");
  const spawn = vi.fn(() => {
    throw Error("Unexpected bundled child");
  });
  const resolve: () => Promise<string> = vm.runInNewContext(
    source.slice(start, end) + ";resolveStartUrl",
    {
      process,
      START_TIMEOUT_MS: 1,
      getDesktopServerConfig: () => ({ serverUrl: "http://fixture-server" }),
      waitForUrl: async () => undefined,
      startStandaloneNextServer: spawn,
    },
  );
  expect(await resolve()).toBe("http://fixture-server");
  expect(spawn).not.toHaveBeenCalled();
  expect(source).toContain("BIDTOOL_DATA_DIR: dataRoot");
});

test("updater waits for child exit before migration and blocks install on stop failure", async () => {
  const { EventEmitter } = await import("node:events");
  const source = await readFile("electron/main.cjs", "utf8");
  const start = source.indexOf(
    "async function prepareDesktopStorageForInstall()",
  );
  const end = source.indexOf("async function startStandaloneNextServer()");
  for (const stopSucceeds of [true, false]) {
    const child = new EventEmitter();
    const migrate = vi.fn();
    let exit = () => undefined;
    Object.assign(child, {
      exitCode: null,
      signalCode: null,
      kill: () => {
        exit = () => {
          child.emit("exit", 0);
        };
        return stopSucceeds;
      },
    });
    const prepare: () => Promise<void> = vm.runInNewContext(
      source.slice(start, end) + ";prepareDesktopStorageForInstall",
      {
        path,
        nextServerProcess: child,
        getDesktopServerConfig: () => ({}),
        findStandaloneServerPath: () => "/fixture/standalone/server.js",
        prepareDesktopDataRoot: migrate,
        setTimeout,
        clearTimeout,
      },
    );
    const pending = prepare();
    expect(migrate).not.toHaveBeenCalled();
    if (stopSucceeds) {
      exit();
      await pending;
      expect(migrate).toHaveBeenCalledWith("/fixture/standalone");
    } else {
      await expect(pending).rejects.toThrow("Could not stop local server");
      expect(migrate).not.toHaveBeenCalled();
    }
  }
});
