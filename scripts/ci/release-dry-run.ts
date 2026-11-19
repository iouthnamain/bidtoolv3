import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type YamlMap = Record<string, unknown>;

declare const Bun: { YAML: { parse(input: string): unknown } };

const repository = path.resolve(".");
const sourceScript = path.join(repository, "scripts/ci/source.ts");
const rollbackScript = path.join(repository, "scripts/ci/rollback-pin.ts");

function asMap(value: unknown, label: string): YamlMap {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be a mapping`);
  return value as YamlMap;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function falseValue(value: unknown, label: string) {
  if (value !== false && value !== "false")
    throw new Error(`${label} must be false`);
}

function trueValue(value: unknown, label: string) {
  if (value !== true && value !== "true")
    throw new Error(`${label} must be true`);
}

function mapValue(map: YamlMap, key: string, label: string): unknown {
  if (!(key in map)) throw new Error(`${label} is missing ${key}`);
  return map[key];
}

function job(workflow: YamlMap, name: string): YamlMap {
  const jobs = asMap(mapValue(workflow, "jobs", "workflow"), "workflow.jobs");
  return asMap(mapValue(jobs, name, `workflow.jobs.${name}`), `job ${name}`);
}

function needs(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  return asArray(value, label).map((item, index) =>
    stringValue(item, `${label}[${index}]`),
  );
}

function expectEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}

function checkoutRef(jobDefinition: YamlMap, label: string): string {
  const steps = asArray(
    mapValue(jobDefinition, "steps", label),
    `${label}.steps`,
  );
  const checkout = steps
    .map((step, index) => asMap(step, `${label}.steps[${index}]`))
    .find((step) => step.uses === "actions/checkout@v4");
  if (!checkout) throw new Error(`${label} has no actions/checkout@v4 step`);
  const options = asMap(
    mapValue(checkout, "with", `${label}.checkout`),
    `${label}.checkout.with`,
  );
  falseValue(
    mapValue(options, "persist-credentials", `${label}.checkout.with`),
    `${label}.checkout.with.persist-credentials`,
  );
  return stringValue(
    mapValue(options, "ref", `${label}.checkout.with`),
    `${label}.checkout.with.ref`,
  );
}

function runText(jobDefinition: YamlMap, label: string): string {
  const steps = asArray(
    mapValue(jobDefinition, "steps", label),
    `${label}.steps`,
  );
  return steps
    .map((step, index) => asMap(step, `${label}.steps[${index}]`).run)
    .filter((run): run is string => typeof run === "string")
    .join("\n");
}

function envValue(jobDefinition: YamlMap, key: string, label: string): string {
  const env = asMap(mapValue(jobDefinition, "env", label), `${label}.env`);
  return stringValue(mapValue(env, key, `${label}.env`), `${label}.env.${key}`);
}

function stepEnvValue(
  jobDefinition: YamlMap,
  runNeedle: string,
  key: string,
  label: string,
): string {
  const steps = asArray(
    mapValue(jobDefinition, "steps", label),
    `${label}.steps`,
  );
  const step = steps
    .map((value, index) => asMap(value, `${label}.steps[${index}]`))
    .find(
      (value) => typeof value.run === "string" && value.run.includes(runNeedle),
    );
  if (!step) throw new Error(`${label} has no step containing ${runNeedle}`);
  const env = asMap(
    mapValue(step, "env", `${label}.${runNeedle}`),
    `${label}.${runNeedle}.env`,
  );
  return stringValue(
    mapValue(env, key, `${label}.${runNeedle}.env`),
    `${label}.${runNeedle}.env.${key}`,
  );
}

function workflowInput(
  workflow: YamlMap,
  input: string,
  label: string,
): YamlMap {
  const triggers = asMap(mapValue(workflow, "on", label), `${label}.on`);
  const dispatch = asMap(
    mapValue(triggers, "workflow_dispatch", label),
    `${label}.workflow_dispatch`,
  );
  const inputs = asMap(
    mapValue(dispatch, "inputs", `${label}.workflow_dispatch`),
    `${label}.workflow_dispatch.inputs`,
  );
  return asMap(
    mapValue(inputs, input, `${label}.workflow_dispatch.inputs`),
    `${label}.${input}`,
  );
}

function before(text: string, earlier: string, later: string, label: string) {
  const earlierIndex = text.indexOf(earlier);
  const laterIndex = text.indexOf(later);
  if (earlierIndex < 0) throw new Error(`${label} is missing ${earlier}`);
  if (laterIndex >= 0 && earlierIndex > laterIndex)
    throw new Error(`${label} runs ${earlier} after ${later}`);
}

function assertProtectionGuards(
  definition: YamlMap,
  label: string,
  commands: string[],
) {
  const steps = asArray(mapValue(definition, "steps", label), `${label}.steps`);
  for (const value of steps) {
    const step = asMap(value, `${label}.step`);
    if (typeof step.run !== "string") continue;
    let failClosed = false;
    let guarded = false;
    for (const line of step.run.split("\n")) {
      if (line.trim() === "set -euo pipefail") failClosed = true;
      if (line.trim() === "bash scripts/ci/production-env.sh") guarded = true;
      const command = commands.find((command) => line.includes(command));
      if (command) {
        if (!failClosed || !guarded)
          throw new Error(
            `${label} must fail closed on protection metadata before ${command}`,
          );
        guarded = false;
      }
    }
  }
}

function assertReleaseGraph() {
  const release = asMap(
    Bun.YAML.parse(
      readFileSync(
        path.join(repository, ".github/workflows/release.yml"),
        "utf8",
      ),
    ),
    "release workflow",
  );
  const validate = asMap(
    Bun.YAML.parse(
      readFileSync(
        path.join(repository, ".github/workflows/validate.yml"),
        "utf8",
      ),
    ),
    "validate workflow",
  );

  const resolve = job(release, "resolve");
  const releaseValidate = job(release, "validate");
  const desktop = job(release, "desktop");
  const verify = job(release, "verify-artifacts");
  const publish = job(release, "publish");
  const releaseTagInput = workflowInput(release, "release_tag", "release");
  expectEqual(releaseTagInput.type, "string", "release tag input type");
  trueValue(releaseTagInput.required, "release tag input required");
  expectEqual(
    stepEnvValue(
      resolve,
      "scripts/ci/source.ts resolve",
      "RELEASE_TAG",
      "release.resolve",
    ),
    "${{ inputs.release_tag || github.ref_name }}",
    "workflow dispatch tag reaches resolver",
  );
  expectEqual(
    needs(releaseValidate.needs, "release.validate.needs"),
    ["resolve"],
    "validate depends on resolve",
  );
  expectEqual(
    needs(desktop.needs, "release.desktop.needs").sort(),
    ["resolve", "validate"],
    "desktop dependencies",
  );
  expectEqual(
    needs(verify.needs, "release.verify-artifacts.needs").sort(),
    ["desktop", "resolve", "validate"],
    "artifact verification dependencies",
  );
  expectEqual(
    needs(publish.needs, "release.publish.needs").sort(),
    ["resolve", "verify-artifacts"],
    "publication dependencies",
  );

  const validateWith = asMap(
    mapValue(releaseValidate, "with", "release.validate"),
    "release.validate.with",
  );
  expectEqual(
    validateWith.source_sha,
    "${{ needs.resolve.outputs.source_sha }}",
    "reusable validation source propagation",
  );
  const resolveOutputs = asMap(
    mapValue(resolve, "outputs", "release.resolve"),
    "release.resolve.outputs",
  );
  expectEqual(
    resolveOutputs.source_sha,
    "${{ steps.source.outputs.source_sha }}",
    "resolved source output",
  );
  if (
    !runText(resolve, "release.resolve").includes(
      "scripts/ci/source.ts resolve",
    )
  )
    throw new Error("resolve must execute the source resolver");

  for (const [name, definition] of [
    ["desktop", desktop],
    ["verify-artifacts", verify],
    ["publish", publish],
  ] as const) {
    expectEqual(
      checkoutRef(definition, `release.${name}`),
      "${{ needs.resolve.outputs.source_sha }}",
      `${name} checks out the resolved SHA`,
    );
    expectEqual(
      envValue(definition, "SOURCE_SHA", `release.${name}`),
      "${{ needs.resolve.outputs.source_sha }}",
      `${name} receives the resolved SHA`,
    );
    if (
      !runText(definition, `release.${name}`).includes("scripts/ci/source.ts")
    )
      throw new Error(`${name} must assert the checked-out source`);
  }

  const validateJobs = asMap(
    mapValue(validate, "jobs", "validate workflow"),
    "validate.jobs",
  );
  for (const name of ["integration", "quality", "runtime", "bundle"]) {
    const definition = asMap(
      mapValue(validateJobs, name, `validate.jobs.${name}`),
      `validate job ${name}`,
    );
    expectEqual(
      checkoutRef(definition, `validate.${name}`),
      "${{ inputs.source_sha }}",
      `${name} checks out the propagated SHA`,
    );
    expectEqual(
      envValue(definition, "SOURCE_SHA", `validate.${name}`),
      "${{ inputs.source_sha }}",
      `${name} receives the propagated SHA`,
    );
    if (
      !runText(definition, `validate.${name}`).includes(
        "scripts/ci/source.ts head",
      )
    )
      throw new Error(`${name} must assert the checked-out source`);
  }
  expectEqual(
    needs(
      asMap(
        mapValue(validateJobs, "runtime", "validate.jobs"),
        "validate.runtime",
      ).needs,
      "validate.runtime.needs",
    ),
    ["quality"],
    "runtime waits for quality",
  );
  expectEqual(
    needs(
      asMap(
        mapValue(validateJobs, "bundle", "validate.jobs"),
        "validate.bundle",
      ).needs,
      "validate.bundle.needs",
    ),
    ["quality"],
    "bundle waits for quality",
  );

  const publicationCommands = [
    "docker push",
    "vercel@65.9.0 deploy",
    "gh release create",
  ];
  const publishRuns = runText(publish, "release.publish");
  const assertIndex = publishRuns.indexOf("scripts/ci/source.ts assert");
  if (assertIndex < 0)
    throw new Error("publish must recheck the resolved source");
  for (const command of publicationCommands) {
    const commandIndex = publishRuns.indexOf(command);
    if (commandIndex >= 0 && commandIndex < assertIndex)
      throw new Error(
        `publication command ${command} runs before source assertion`,
      );
  }

  const releasePermissions = asMap(
    mapValue(release, "permissions", "release"),
    "release.permissions",
  );
  expectEqual(
    releasePermissions.contents,
    "read",
    "release default permissions",
  );
  const releaseConcurrency = asMap(
    mapValue(release, "concurrency", "release"),
    "release.concurrency",
  );
  expectEqual(
    releaseConcurrency.group,
    "bidtool-production-delivery",
    "release lock group",
  );
  falseValue(
    releaseConcurrency["cancel-in-progress"],
    "release lock cancellation",
  );
  expectEqual(
    publish.environment,
    "production",
    "release publication environment",
  );
  const publishPermissions = asMap(
    mapValue(publish, "permissions", "release.publish"),
    "release.publish.permissions",
  );
  expectEqual(
    publishPermissions.contents,
    "write",
    "release publication contents permission",
  );
  expectEqual(
    publishPermissions.packages,
    "write",
    "release publication packages permission",
  );
  expectEqual(
    publishPermissions.actions,
    "read",
    "release protection metadata permission",
  );
  assertProtectionGuards(publish, "release.publish", [
    "docker push",
    "vercel@65.9.0 deploy",
    "gh release create",
    "docker buildx imagetools create",
  ]);
  before(
    publishRuns,
    "scripts/ci/production-env.sh",
    "docker push",
    "release publication guard",
  );
  before(
    publishRuns,
    "scripts/ci/production-env.sh",
    "vercel@65.9.0 deploy",
    "release web guard",
  );
}

function assertRollbackContract() {
  const rollback = asMap(
    Bun.YAML.parse(
      readFileSync(
        path.join(repository, ".github/workflows/rollback.yml"),
        "utf8",
      ),
    ),
    "rollback workflow",
  );
  const targetVersion = workflowInput(rollback, "target_version", "rollback");
  expectEqual(targetVersion.type, "string", "rollback version input type");
  trueValue(targetVersion.required, "rollback version input required");
  const permissions = asMap(
    mapValue(rollback, "permissions", "rollback"),
    "rollback.permissions",
  );
  expectEqual(permissions.contents, "read", "rollback default permissions");
  const concurrency = asMap(
    mapValue(rollback, "concurrency", "rollback"),
    "rollback.concurrency",
  );
  expectEqual(
    concurrency.group,
    "bidtool-production-delivery",
    "rollback lock group",
  );
  falseValue(concurrency["cancel-in-progress"], "rollback lock cancellation");
  const definition = job(rollback, "rollback");
  expectEqual(
    checkoutRef(definition, "rollback.rollback"),
    "${{ github.sha }}",
    "rollback checks out the workflow SHA",
  );
  expectEqual(definition.environment, "production", "rollback environment");
  const jobPermissions = asMap(
    mapValue(definition, "permissions", "rollback.rollback"),
    "rollback.rollback.permissions",
  );
  expectEqual(jobPermissions.contents, "read", "rollback contents permission");
  expectEqual(jobPermissions.packages, "write", "rollback packages permission");
  expectEqual(
    jobPermissions.actions,
    "read",
    "rollback protection metadata permission",
  );
  const runs = runText(definition, "rollback.rollback");
  before(
    runs,
    "scripts/ci/rollback-pin.ts",
    "bash scripts/ci/rollback.sh",
    "rollback pin validation",
  );
  if (!runs.includes("bash scripts/ci/rollback.sh"))
    throw new Error("rollback must run the reviewed action helper");
  const actions = readFileSync(
    path.join(repository, "scripts/ci/rollback.sh"),
    "utf8",
  );
  for (const guard of ["production-protection.ts", "production-env.sh"])
    if (!actions.includes(guard)) throw new Error(`rollback missing ${guard}`);
  before(
    actions,
    "imagetools inspect",
    "vercel@65.9.0 promote",
    "rollback preflight",
  );
  before(actions, "guard\n", "docker login", "rollback protection guard");
  assertRollbackPinFixture();
}

function assertRollbackPinFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bidtool-r10-rollback-"));
  try {
    mkdirSync(path.join(directory, "releases"), { recursive: true });
    const digest = `sha256:${"a".repeat(64)}`;
    const entry = {
      releasedAt: "2026-01-01T00:00:00.000Z",
      manifestUrl: "https://example.invalid/manifest.json",
      web: {
        buildId: "dpl_fixture",
        deploymentUrl: "https://example.invalid",
        buildMetadata: "1.2.3+web.fixture",
      },
      onprem: {
        image: "ghcr.io/iouthnamain/bidtoolv3:1.2.3",
        digest,
        buildMetadata: "1.2.3+onprem.fixture",
      },
      desktop: {},
    };
    const pinsFile = path.join(directory, "releases/pins.json");
    const output = path.join(directory, "github-output");
    const writePins = (value: YamlMap) =>
      writeFileSync(
        pinsFile,
        JSON.stringify({ current: "1.2.3", releases: { "1.2.3": value } }),
      );
    const runPin = () =>
      execFileSync("bun", [rollbackScript], {
        cwd: directory,
        env: {
          ...process.env,
          TARGET_VERSION: "1.2.3",
          GITHUB_REPOSITORY: "iouthnamain/bidtoolv3",
          GITHUB_OUTPUT: output,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    writePins(entry);
    runPin();
    const validOutput = readFileSync(output, "utf8");
    if (
      !validOutput.includes(
        `source_ref=ghcr.io/iouthnamain/bidtoolv3@${digest}\n`,
      ) ||
      !validOutput.includes("web_build_id=dpl_fixture\n")
    )
      throw new Error(
        "valid rollback pin did not produce a qualified immutable target",
      );
    writePins({ ...entry, web: { ...entry.web, buildId: "skipped" } });
    rmSync(output, { force: true });
    runPin();
    const skippedOutput = readFileSync(output, "utf8");
    if (!skippedOutput.includes("web_skipped=true\nweb_build_id=\n"))
      throw new Error("skipped web pin must be an explicit image-only plan");
    writePins({
      ...entry,
      onprem: { ...entry.onprem, image: "ghcr.io/other/project:1.2.3" },
    });
    mustFail("wrong rollback image repository", runPin);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function source(command: string, cwd: string, env: Record<string, string>) {
  return execFileSync("bun", [sourceScript, command], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function mustFail(label: string, action: () => void) {
  try {
    action();
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function commit(cwd: string, value: string): string {
  writeFileSync(path.join(cwd, "source"), value);
  git(["add", "source"], cwd);
  git(["commit", "-m", value], cwd);
  return git(["rev-parse", "HEAD"], cwd);
}

function assertSourceResolution() {
  const directory = mkdtempSync(path.join(tmpdir(), "bidtool-r10-source-"));
  try {
    const remote = path.join(directory, "remote.git");
    const checkout = path.join(directory, "checkout");
    const output = path.join(directory, "github-output");
    git(["init", "--bare", remote], directory);
    execFileSync("git", ["clone", remote, checkout], { stdio: "ignore" });
    git(["config", "user.name", "R10 fixture"], checkout);
    git(["config", "user.email", "r10-fixture@example.invalid"], checkout);
    const tagCommit = commit(checkout, "tag A");
    git(["tag", "v1.2.3"], checkout);
    git(["push", "origin", "HEAD", "--tags"], checkout);
    const dispatchCommit = commit(checkout, "dispatch B");
    git(["push", "origin", "HEAD"], checkout);

    source("resolve", checkout, {
      RELEASE_TAG: "v1.2.3",
      GITHUB_SHA: dispatchCommit,
      GITHUB_OUTPUT: output,
    });
    const resolved = readFileSync(output, "utf8");
    if (
      !resolved.includes(`source_sha=${tagCommit}\n`) ||
      resolved.includes(dispatchCommit)
    )
      throw new Error("dispatch B did not resolve tag A exactly");

    mustFail("missing tag", () =>
      source("resolve", checkout, {
        RELEASE_TAG: "v9.9.9",
        GITHUB_SHA: dispatchCommit,
        GITHUB_OUTPUT: output,
      }),
    );
    const blob = git(["hash-object", "source"], checkout);
    git(["tag", "v2.0.0", blob], checkout);
    git(["push", "origin", "refs/tags/v2.0.0"], checkout);
    mustFail("non-commit tag", () =>
      source("resolve", checkout, {
        RELEASE_TAG: "v2.0.0",
        GITHUB_SHA: dispatchCommit,
        GITHUB_OUTPUT: output,
      }),
    );
    mustFail("wrong checkout", () =>
      source("head", checkout, { SOURCE_SHA: tagCommit }),
    );

    git(
      ["push", "origin", `${dispatchCommit}:refs/tags/v1.2.3`, "--force"],
      checkout,
    );
    git(["checkout", "--detach", tagCommit], checkout);
    mustFail("moved tag", () =>
      source("assert", checkout, {
        RELEASE_TAG: "v1.2.3",
        SOURCE_SHA: tagCommit,
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

assertReleaseGraph();
assertRollbackContract();
assertSourceResolution();
console.log(
  "R10 dry run passed: dispatch tag wiring, exact source propagation, negative tag paths, quality gates, and protected rollback pin guards.",
);
