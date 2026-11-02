import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function createFakeDocker(failCommand = "", exitCode = 23) {
  const dir = await mkdtemp(path.join(tmpdir(), "bidtool-fake-docker-"));
  const log = path.join(dir, "commands.jsonl");
  await writeFile(log, "");
  await writeFile(
    path.join(dir, "docker"),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
process.exit(process.env.FAKE_DOCKER_FAIL && args.includes(process.env.FAKE_DOCKER_FAIL) ? Number(process.env.FAKE_DOCKER_EXIT) : 0);
`,
    { mode: 0o755 },
  );
  return {
    dir,
    env: {
      PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
      FAKE_DOCKER_LOG: log,
      FAKE_DOCKER_FAIL: failCommand,
      FAKE_DOCKER_EXIT: String(exitCode),
    },
    async commands(): Promise<string[][]> {
      const lines = (await readFile(log, "utf8")).trim();
      return lines
        ? lines.split("\n").map((line) => JSON.parse(line) as string[])
        : [];
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
