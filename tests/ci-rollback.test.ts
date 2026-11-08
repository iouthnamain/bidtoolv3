import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { rollbackPin } from "../scripts/ci/rollback-pin";

const digest = `sha256:${"a".repeat(64)}`;
const source = `ghcr.io/owner/app@${digest}`;
const entry = {
  releasedAt: "2026-01-01T00:00:00.000Z",
  manifestUrl: "https://example.invalid/manifest.json",
  web: {
    buildId: "dpl_fixture",
    deploymentUrl: "https://example.invalid",
    buildMetadata: "1.2.3+web.fixture",
  },
  onprem: {
    image: "ghcr.io/owner/app:1.2.3",
    digest,
    buildMetadata: "1.2.3+onprem.fixture",
  },
  desktop: {},
};
const pins = (pin: unknown = entry) => ({
  current: "1.2.3",
  releases: { "1.2.3": pin },
});
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const executable = (name: string) =>
  execFileSync("which", [name], { encoding: "utf8" }).trim();
const bun = executable("bun");

test("only an explicit skipped marker selects image-only rollback; invalid pins fail closed", () => {
  expect(rollbackPin(pins(), "v1.2.3", "owner/app")).toMatchObject({
    source,
    web: { kind: "deployment" },
  });
  expect(
    rollbackPin(
      pins({ ...entry, web: { ...entry.web, buildId: "skipped" } }),
      "1.2.3",
      "owner/app",
    ),
  ).toMatchObject({ source, web: { kind: "skipped" } });
  for (const pin of [
    { ...entry, web: { ...entry.web, buildId: "" } },
    { ...entry, web: { ...entry.web, buildId: "unknown" } },
    { ...entry, onprem: { ...entry.onprem, digest: undefined } },
    { ...entry, onprem: { ...entry.onprem, digest: "sha256:bad" } },
    { ...entry, onprem: { ...entry.onprem, image: "ghcr.io/other/app:1.2.3" } },
  ])
    expect(() => rollbackPin(pins(pin), "1.2.3", "owner/app")).toThrow();
});

const workflow = z
  .object({
    jobs: z.object({
      rollback: z.object({
        steps: z.array(
          z.object({
            uses: z.string().optional(),
            with: z.record(z.unknown()).optional(),
            run: z.string().optional(),
          }),
        ),
      }),
    }),
  })
  .parse(
    JSON.parse(
      execFileSync(
        bun,
        [
          "-e",
          'console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(".github/workflows/rollback.yml").text())))',
        ],
        { encoding: "utf8" },
      ),
    ) as unknown,
  );

function fixture(pin: unknown, fault = "", skipCredentials = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "bidtool-r12-"));
  directories.push(directory);
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  mkdirSync(path.join(directory, "releases"));
  symlinkSync(path.resolve("scripts"), path.join(directory, "scripts"), "dir");
  writeFileSync(
    path.join(directory, "releases/pins.json"),
    JSON.stringify(pins(pin)),
  );
  const record = path.join(directory, "commands.jsonl");
  const fake = `#!${process.execPath}
const fs = require('node:fs');
const tool = require('node:path').basename(process.argv[1]); const args = process.argv.slice(2);
fs.appendFileSync(process.env.R12_RECORD, JSON.stringify({tool,args})+'\\n');
const fault = process.env.R12_FAULT;
function fail() { console.error('fixture action refused'); process.exit(17); }
if (tool === 'gh') {
 if (fault === 'protection') fail();
 const reads = fs.readFileSync(process.env.R12_RECORD,'utf8').trim().split('\\n').map(JSON.parse).filter(c=>c.tool==='gh' && !c.args.at(-1).includes('deployment-branch-policies')).length;
 if ((fault === 'protection-web' && reads === 2) || (fault === 'protection-image' && reads === 3)) fail();
 console.log(JSON.stringify(args.at(-1).includes('deployment-branch-policies')
  ? {total_count:1,branch_policies:[{type:'branch',name:'main'}]}
  : {name:'Production',can_admins_bypass:false,protection_rules:[{type:'required_reviewers',prevent_self_review:true,reviewers:[{type:'Team',reviewer:{id:42}}]}],deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}}));
} else if (tool === 'docker' && args[0] === 'login') { process.stdin.resume(); }
else if (tool === 'docker' && args.includes('inspect')) { if (fault === 'image-inspect') fail(); console.log(fault === 'image-digest' ? 'sha256:'+'b'.repeat(64) : process.env.R12_DIGEST); }
else if (tool === 'docker' && args.includes('create')) { if (fault === 'image-retag') fail(); }
else if (tool === 'bunx' && args[1] === 'inspect') { if (fault === 'web-inspect') fail(); console.log(JSON.stringify({id:fault==='web-id'?'dpl_wrong':'dpl_fixture',readyState:fault==='web-state'?'ERROR':'READY'})); }
else if (tool === 'bunx' && args[1] === 'promote') { if (fault === 'web-promote') fail(); }
else { console.error('unexpected fixture command'); process.exit(99); }
`;
  for (const name of ["gh", "docker", "bunx"])
    writeFileSync(path.join(bin, name), fake, { mode: 0o755 });
  for (const name of ["bash", "dirname", "mktemp", "rm", "jq"])
    symlinkSync(executable(name), path.join(bin, name));
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: bin,
    HOME: directory,
    TMPDIR: directory,
    GITHUB_REPOSITORY: "owner/app",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR: "fixture",
    GH_TOKEN: "synthetic-gh",
    TARGET_VERSION: "1.2.3",
    GITHUB_OUTPUT: path.join(directory, "outputs"),
    GITHUB_STEP_SUMMARY: path.join(directory, "summary"),
    R12_RECORD: record,
    R12_FAULT: fault,
    R12_DIGEST: digest,
    ...(skipCredentials
      ? {}
      : {
          VERCEL_TOKEN: "synthetic-vercel",
          VERCEL_ORG_ID: "fixture-org",
          VERCEL_PROJECT_ID: "fixture-project",
        }),
  };
  // PATH deliberately begins with no Bun. Emulate setup-bun's PATH activation
  // using the installed runtime; the pinned version/order is checked separately.
  expect(spawnSync("bun", ["--version"], { env }).error).toMatchObject({
    code: "ENOENT",
  });
  symlinkSync(bun, path.join(bin, "bun"));
  const pinResult = spawnSync("bun", ["scripts/ci/rollback-pin.ts"], {
    cwd: directory,
    env,
    encoding: "utf8",
  });
  if (pinResult.status !== 0)
    return {
      status: pinResult.status,
      commands: [],
      summary: "",
      output: pinResult.stdout + pinResult.stderr,
    };
  const outputs = Object.fromEntries(
    readFileSync(env.GITHUB_OUTPUT!, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  const result = spawnSync("bash", ["scripts/ci/rollback.sh"], {
    cwd: directory,
    env: {
      ...env,
      VERSION: outputs.version,
      SOURCE_REF: outputs.source_ref,
      WEB_SKIPPED: outputs.web_skipped,
      WEB_BUILD_ID: outputs.web_build_id,
    },
    encoding: "utf8",
  });
  const commands = z
    .array(z.object({ tool: z.string(), args: z.array(z.string()) }))
    .parse(
      (existsSync(record) ? readFileSync(record, "utf8") : "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown),
    );
  return {
    status: result.status,
    commands,
    summary: readFileSync(env.GITHUB_STEP_SUMMARY!, "utf8"),
    output: result.stdout + result.stderr,
  };
}

test("workflow activates repository-pinned Bun before pin evaluation or any bunx", () => {
  const steps = workflow.jobs.rollback.steps;
  const setup = steps.findIndex((step) => step.uses === "oven-sh/setup-bun@v2");
  expect(steps[setup]?.with?.["bun-version"]).toBe(
    JSON.parse(readFileSync("package.json", "utf8")).packageManager.replace(
      "bun@",
      "",
    ),
  );
  for (const [index, step] of steps.entries())
    if (step.run?.includes("bun")) expect(index).toBeGreaterThan(setup);
  expect(steps.some((step) => step.run === "bash scripts/ci/rollback.sh")).toBe(
    true,
  );
});

test("valid clean-PATH fixture preflights both targets, then promotes each exact target", () => {
  const result = fixture(entry);
  expect(result.status).toBe(0);
  const external = result.commands.filter((call) => call.tool !== "gh");
  expect(
    external.map((call) => [call.tool, call.args[0], call.args[1]]),
  ).toEqual([
    ["docker", "login", "ghcr.io"],
    ["docker", "buildx", "imagetools"],
    ["bunx", "vercel@65.9.0", "inspect"],
    ["bunx", "vercel@65.9.0", "promote"],
    ["docker", "buildx", "imagetools"],
  ]);
  expect(external[1]?.args).toContain(source);
  expect(external[4]?.args).toContain(source);
  expect(external[4]?.args).toContain("--prefer-index=false");
  expect(result.commands.filter((call) => call.tool === "gh")).toHaveLength(6);
  expect(result.summary).toContain("Web promotion: promoted");
  expect(result.summary).toContain("Image promotion: promoted");
  expect(result.summary).toContain("Artifact rollback completed");
});

test("explicit skipped web never invokes Vercel or needs its credentials, but retains protection guards", () => {
  const result = fixture(
    { ...entry, web: { ...entry.web, buildId: "skipped" } },
    "",
    true,
  );
  expect(result.status).toBe(0);
  expect(result.commands.some((call) => call.tool === "bunx")).toBe(false);
  expect(result.commands.filter((call) => call.tool === "gh")).toHaveLength(4);
  expect(result.summary).toContain("Web promotion: skipped");
  expect(result.summary).toContain("Image promotion: promoted");
});

test.each([
  "image-inspect",
  "image-digest",
  "web-inspect",
  "web-id",
  "web-state",
  "protection",
])(
  "%s preflight failure performs no promotion and reports incomplete",
  (fault) => {
    const result = fixture(entry, fault);
    expect(result.status).not.toBe(0);
    expect(
      result.commands.some(
        (call) => call.args.includes("promote") || call.args.includes("create"),
      ),
    ).toBe(false);
    expect(result.summary).toContain("Artifact rollback incomplete");
    expect(result.summary).not.toContain("Artifact rollback completed");
  },
);

test.each(["web-promote", "image-retag"])(
  "%s failure preserves actual partial outcomes without full success",
  (fault) => {
    const result = fixture(entry, fault);
    expect(result.status).not.toBe(0);
    expect(result.summary).toContain("Artifact rollback incomplete");
    expect(result.summary).not.toContain("Artifact rollback completed");
    if (fault === "web-promote") {
      expect(result.summary).toContain("Web promotion: failed");
      expect(result.commands.some((call) => call.args.includes("create"))).toBe(
        false,
      );
    } else {
      expect(result.summary).toContain("Web promotion: promoted");
      expect(result.summary).toContain("Image promotion: failed");
    }
  },
);

test.each(["protection-web", "protection-image"])(
  "%s metadata change fails closed at the next promotion boundary",
  (fault) => {
    const result = fixture(entry, fault);
    expect(result.status).not.toBe(0);
    expect(result.commands.some((call) => call.args.includes("create"))).toBe(
      false,
    );
    expect(result.commands.some((call) => call.args.includes("promote"))).toBe(
      fault === "protection-image",
    );
    expect(result.summary).toContain("Artifact rollback incomplete");
  },
);

test.each(["", "sha256:bad"])(
  "invalid digest %s rejects before any external command",
  (badDigest) => {
    const result = fixture({
      ...entry,
      onprem: { ...entry.onprem, digest: badDigest },
    });
    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual([]);
    expect(result.summary).toBe("");
  },
);

test.each([
  { ...entry, onprem: { ...entry.onprem, digest: undefined } },
  { ...entry, onprem: { ...entry.onprem, image: "ghcr.io/other/app:1.2.3" } },
])(
  "missing digest or wrong repository rejects before any external command",
  (pin) => {
    const result = fixture(pin);
    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual([]);
  },
);

test("selected web with missing credentials fails before external commands", () => {
  const result = fixture(entry, "", true);
  expect(result.status).not.toBe(0);
  expect(result.commands).toEqual([]);
  expect(result.summary).toContain("Artifact rollback incomplete");
  expect(result.output).not.toContain("synthetic-gh");
});
