import { spawn } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { createStorageDocker } from "./storage-fixture";

async function script(
  fake: Awaited<ReturnType<typeof createStorageDocker>>,
  name: string,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
) {
  return new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      let output = "";
      const child = spawn("sh", [`scripts/onprem-${name}.sh`, ...args], {
        env: { NODE_ENV: "test", ...fake.env, ...extraEnv },
        stdio: "pipe",
      });
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    },
  );
}
async function bundle(fake: Awaited<ReturnType<typeof createStorageDocker>>) {
  const result = await script(fake, "backup");
  expect(result, result.output).toMatchObject({ code: 0 });
  const root = path.join(fake.dir, "backups");
  return path.join(
    root,
    (await readdir(root)).find((file) => file.endsWith(".bundle"))!,
  );
}
const starts = (commands: string[][]) =>
  commands.filter((args) => args.includes("up") || args.includes("start"));

test("backup stops writers, copies all artifact trees, verifies checksums, then resumes only its app", async () => {
  const fake = await createStorageDocker();
  try {
    const directory = await bundle(fake);
    const manifest = JSON.parse(
      await readFile(path.join(directory, "manifest.json"), "utf8"),
    );
    expect(manifest.version).toBe(1);
    expect(
      manifest.entries.filter((e: { kind: string }) => e.kind === "file"),
    ).toHaveLength(3);
    expect(manifest.externalOutputs).toEqual([
      { path: "/operator/exports", included: false },
    ]);
    const commands = await fake.commands();
    const stop = commands.findIndex((args) => args.includes("stop"));
    expect(
      commands.findIndex((args) => args.includes("pg_dump")),
    ).toBeGreaterThan(stop);
    expect(commands.findIndex((args) => args[0] === "cp")).toBeGreaterThan(
      stop,
    );
    expect(starts(commands)).toHaveLength(1);
    expect(starts(commands)[0]).toContain("start");
    expect(
      await readFile(
        path.join(directory, "files/material-profiles/workspace/source.xlsx"),
        "utf8",
      ),
    ).toBe("workbook-bytes");
  } finally {
    await fake.cleanup();
  }
});

test.each(["backup", "update"])(
  "%s never recreates on failed copy and retains incomplete evidence",
  async (name) => {
    const fake = await createStorageDocker("cp");
    try {
      const result = await script(
        fake,
        name,
        name === "update" ? ["--schema-compatible"] : [],
      );
      expect(result.code).toBe(23);
      expect((await fake.commands()).some((args) => args.includes("up"))).toBe(
        false,
      );
      expect(
        (await readdir(path.join(fake.dir, "backups"))).some((file) =>
          file.endsWith(".bundle"),
        ),
      ).toBe(false);
    } finally {
      await fake.cleanup();
    }
  },
);

test("backup rejects an out-of-root DB setting and missing referenced bytes", async () => {
  for (const outside of [true, false]) {
    const fake = await createStorageDocker();
    try {
      if (outside) {
        Object.assign(fake.state.metadata.settings, {
          bidtool_excel_research_dir: "/external/research",
        });
        await fake.saveState();
      } else await rm(path.join(fake.files, "catalog-pdfs/1/upload.pdf"));
      const result = await script(fake, "backup");
      expect(result.code).not.toBe(0);
      expect(result.output).toContain(
        outside ? "outside" : "Missing referenced file",
      );
      expect(starts(await fake.commands())).toHaveLength(0);
    } finally {
      await fake.cleanup();
    }
  }
});

test("a complete restore stages and checks DB/files before activation and retains old database", async () => {
  const fake = await createStorageDocker();
  try {
    const directory = await bundle(fake);
    await writeFile(path.join(fake.dir, "commands.jsonl"), "");
    const result = await script(fake, "restore", [directory], {
      FAKE_APP_PRESENT: "false",
    });
    expect(result, result.output).toMatchObject({ code: 0 });
    const commands = await fake.commands();
    expect(commands.find((args) => args.includes("pg_restore"))).toEqual(
      expect.arrayContaining(["--exit-on-error", "--single-transaction"]),
    );
    expect(
      commands.find((args) => args[0] === "volume" && args.includes("create")),
    ).toContain("com.docker.compose.volume=bidtool-onprem-app-data");
    const restore = commands.findIndex((args) => args.includes("pg_restore"));
    const copy = commands.findIndex((args) => args[0] === "run");
    const swap = commands.findIndex((args) =>
      args.at(-1)?.includes("ALTER DATABASE"),
    );
    const start = commands.findIndex((args) => args.includes("up"));
    expect(copy).toBeGreaterThan(restore);
    expect(swap).toBeGreaterThan(copy);
    expect(start).toBeGreaterThan(swap);
    expect(commands[swap]!.at(-1)).toContain("bidtool_previous_");
    const env = await readFile(fake.envFile, "utf8");
    expect(env).toContain("BIDTOOL_DATA_VOLUME=");
    expect(
      JSON.parse(await readFile(path.join(fake.dir, "activation.json"), "utf8"))
        .image,
    ).toBe(fake.state.image);
    expect(result.output).toContain("runtime/download proof remains");
  } finally {
    await fake.cleanup();
  }
});

test.each(["checksum", "missing-tree", "dump"])(
  "corrupt %s bundle cannot restore or start",
  async (corruption) => {
    const fake = await createStorageDocker();
    try {
      const directory = await bundle(fake);
      await writeFile(path.join(fake.dir, "commands.jsonl"), "");
      if (corruption === "missing-tree")
        await rm(path.join(directory, "files/excel-research"), {
          recursive: true,
        });
      else
        await writeFile(
          path.join(
            directory,
            corruption === "dump"
              ? "database.dump"
              : "files/catalog-pdfs/1/upload.pdf",
          ),
          "corrupt",
        );
      const result = await script(fake, "restore", [directory]);
      expect(result.code).not.toBe(0);
      const commands = await fake.commands();
      expect(commands.some((args) => args.includes("pg_restore"))).toBe(false);
      expect(starts(commands)).toHaveLength(0);
    } finally {
      await fake.cleanup();
    }
  },
);

test.each(["stop", "pg_restore", "run"])(
  "complete restore %s failure cannot start app",
  async (failure) => {
    const fake = await createStorageDocker();
    try {
      const directory = await bundle(fake);
      await writeFile(path.join(fake.dir, "commands.jsonl"), "");
      const result = await script(fake, "restore", [directory], {
        FAKE_DOCKER_FAIL: failure,
        FAKE_APP_PRESENT: "false",
      });
      expect(result.code).toBe(23);
      const commands = await fake.commands();
      expect(starts(commands)).toHaveLength(0);
      if (failure === "stop")
        expect(
          commands.some(
            (args) =>
              args.includes("createdb") ||
              args.includes("pg_restore") ||
              args[0] === "run",
          ),
        ).toBe(false);
    } finally {
      await fake.cleanup();
    }
  },
);

test("update copies old bytes and publishes a complete bundle before any replacement", async () => {
  const fake = await createStorageDocker();
  try {
    const result = await script(fake, "update", ["--schema-compatible"]);
    expect(result, result.output).toMatchObject({ code: 0 });
    const activation = JSON.parse(
      await readFile(path.join(fake.dir, "activation.json"), "utf8"),
    );
    expect(activation.volume).toMatch(/_data_/);
    expect(activation.image).toBe(fake.state.image);
    const commands = await fake.commands();
    expect(commands.findIndex((args) => args[0] === "cp")).toBeLessThan(
      commands.findIndex((args) => args.includes("up")),
    );
    expect(commands.findIndex((args) => args.includes("pg_dump"))).toBeLessThan(
      commands.findIndex((args) => args[0] === "run"),
    );
    expect(
      (await readdir(path.join(fake.dir, "backups"))).some((file) =>
        file.endsWith(".bundle"),
      ),
    ).toBe(true);
    expect(
      await readFile(
        path.join(fake.files, "catalog-pdfs/1/upload.pdf"),
        "utf8",
      ),
    ).toBe("%PDF-upload-test");
  } finally {
    await fake.cleanup();
  }
});

test("a stopped app stays stopped after backup", async () => {
  const fake = await createStorageDocker();
  try {
    fake.state.container.State.Running = false;
    await fake.saveState();
    await bundle(fake);
    expect(starts(await fake.commands())).toHaveLength(0);
  } finally {
    await fake.cleanup();
  }
});

test("legacy restore requires explicit selection and leaves app stopped after success", async () => {
  const fake = await createStorageDocker();
  try {
    const sql = path.join(fake.dir, "legacy.sql");
    await writeFile(sql, "-- trusted fixture dump");
    const rejected = await script(fake, "restore", [sql], {
      FAKE_APP_PRESENT: "false",
    });
    expect(rejected.code).not.toBe(0);
    expect((await fake.commands()).some((args) => args.includes("stop"))).toBe(
      false,
    );
    const result = await script(
      fake,
      "restore",
      [sql, "--database-only", "--schema-compatible"],
      { FAKE_APP_PRESENT: "false" },
    );
    expect(result, result.output).toMatchObject({ code: 0 });
    expect(result.output).toContain("app LEFT STOPPED");
    expect(result.output).toContain("Document bytes are unavailable");
    expect(starts(await fake.commands())).toHaveLength(0);
  } finally {
    await fake.cleanup();
  }
});

test("restore image mismatch is rejected before stopping or mutating data", async () => {
  const fake = await createStorageDocker();
  try {
    const directory = await bundle(fake);
    fake.state.image = `sha256:${"b".repeat(64)}`;
    await fake.saveState();
    await writeFile(path.join(fake.dir, "commands.jsonl"), "");
    const result = await script(fake, "restore", [directory]);
    expect(result.output).toContain("exact recorded app image");
    expect(result.code).not.toBe(0);
    expect(
      (await fake.commands()).some(
        (args) => args.includes("stop") || args.includes("pg_restore"),
      ),
    ).toBe(false);
  } finally {
    await fake.cleanup();
  }
});

test("env directory override retains precedence over an out-of-root DB setting", async () => {
  const fake = await createStorageDocker();
  try {
    fake.state.container.Config.Env.push(
      "BIDTOOL_EXCEL_RESEARCH_DIR=/app/data/excel-research",
    );
    Object.assign(fake.state.metadata.settings, {
      bidtool_excel_research_dir: "/outside",
    });
    await fake.saveState();
    await bundle(fake);
  } finally {
    await fake.cleanup();
  }
});

test("failed startup after activation issues stop and retains the prior database", async () => {
  const fake = await createStorageDocker();
  try {
    const directory = await bundle(fake);
    await writeFile(path.join(fake.dir, "commands.jsonl"), "");
    const result = await script(fake, "restore", [directory], {
      FAKE_DOCKER_FAIL: "up",
      FAKE_APP_PRESENT: "false",
    });
    expect(result.code).toBe(23);
    const commands = await fake.commands();
    const up = commands.findIndex((args) => args.includes("up"));
    expect(up).toBeGreaterThan(0);
    expect(commands.at(-1)).toContain("stop");
    expect(
      commands.some((args) => args.at(-1)?.includes("bidtool_previous_")),
    ).toBe(true);
    expect(commands.slice(up + 1).some((args) => args.includes("start"))).toBe(
      false,
    );
  } finally {
    await fake.cleanup();
  }
});

test("backup cannot remove another operation's lock", async () => {
  const fake = await createStorageDocker();
  try {
    const { mkdir } = await import("node:fs/promises");
    const lock = path.join(
      fake.dir,
      "backups",
      `.${fake.env.BIDTOOL_ONPREM_PROJECT}.storage-lock`,
    );
    await mkdir(lock, { recursive: true });
    const result = await script(fake, "backup");
    expect(result.code).not.toBe(0);
    expect(await readdir(lock)).toEqual([]);
    expect(await fake.commands()).toHaveLength(2); // compose version and info only
  } finally {
    await fake.cleanup();
  }
});

test.each([
  ["FAKE_VOLUME_EXISTS", "Refusing existing destination"],
  ["FAKE_VOLUME_NONEMPTY", "Destination must be empty"],
  ["FAKE_CORRUPT_COPY", "Copy checksum"],
  ["FAKE_STAGE_MISMATCH", "Staged database metadata differs"],
])(
  "restore rejects %s before database activation or app start",
  async (flag, message) => {
    const fake = await createStorageDocker();
    try {
      const directory = await bundle(fake);
      await writeFile(path.join(fake.dir, "commands.jsonl"), "");
      const result = await script(fake, "restore", [directory], {
        [flag]: "true",
        FAKE_APP_PRESENT: "false",
      });
      expect(result.code).not.toBe(0);
      expect(result.output).toContain(message);
      const commands = await fake.commands();
      expect(starts(commands)).toHaveLength(0);
      expect(
        commands.some((args) => args.at(-1)?.includes("ALTER DATABASE")),
      ).toBe(false);
    } finally {
      await fake.cleanup();
    }
  },
);

test("mismatched old app DB target and missing compatibility flag fail before stop", async () => {
  for (const missingFlag of [true, false]) {
    const fake = await createStorageDocker();
    try {
      if (!missingFlag) {
        fake.state.container.Config.Env =
          fake.state.container.Config.Env.filter(
            (entry) => !entry.startsWith("DATABASE_URL="),
          );
        fake.state.container.Config.Env.push(
          "DATABASE_URL=postgresql://fixture@external/other",
        );
        await fake.saveState();
      }
      const result = await script(
        fake,
        "update",
        missingFlag ? [] : ["--schema-compatible"],
      );
      expect(result.code).not.toBe(0);
      expect(result.output).toContain(
        missingFlag ? "requires --schema-compatible" : "DATABASE_URL differs",
      );
      expect(
        (await fake.commands()).some(
          (args) =>
            args.includes("stop") ||
            args.includes("pg_dump") ||
            args.includes("up"),
        ),
      ).toBe(false);
    } finally {
      await fake.cleanup();
    }
  }
});
