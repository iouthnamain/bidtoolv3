import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  assertHead,
  assertRelease,
  git,
  releaseVersion,
  resolveTag,
} from "../scripts/ci/source";
import { imageCoordinate } from "../scripts/ci/rollback-pin";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bidtool-source-"));
  directories.push(directory);
  const remote = path.join(directory, "remote.git");
  const checkout = path.join(directory, "checkout");
  execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
  execFileSync("git", ["clone", remote, checkout], { stdio: "ignore" });
  git(["config", "user.name", "CI fixture"], checkout);
  git(["config", "user.email", "ci@example.invalid"], checkout);
  function commit(value: string) {
    writeFileSync(path.join(checkout, "source"), value);
    git(["add", "."], checkout);
    git(["commit", "-m", value], checkout);
    return git(["rev-parse", "HEAD"], checkout);
  }
  const a = commit("tag source A");
  git(["tag", "v1.2.3"], checkout);
  git(["tag", "-a", "v1.2.4", "-m", "annotated tag", a], checkout);
  git(["push", "origin", "HEAD", "--tags"], checkout);
  const b = commit("dispatch B");
  return { checkout, a, b, commit };
}

test("dispatch at B resolves lightweight and annotated tags at A; wrong checkout blocks delivery", () => {
  const { checkout, a, b } = fixture();
  expect(a).not.toBe(b);
  expect(resolveTag("v1.2.3", checkout)).toBe(a);
  expect(resolveTag("v1.2.4", checkout)).toBe(a);
  expect(() => assertRelease("v1.2.3", a, checkout)).toThrow("Checkout");
  git(["checkout", "--detach", a], checkout);
  expect(() => assertRelease("v1.2.3", a, checkout)).not.toThrow();
  expect(() => assertHead(a.slice(0, 7), checkout)).toThrow("full immutable");
});

test("missing, non-commit and moved remote tags block delivery despite stale local tags", () => {
  const { checkout, a, b } = fixture();
  expect(() => resolveTag("v9.9.9", checkout)).toThrow();
  const blob = git(["hash-object", "source"], checkout);
  git(["tag", "v2.0.0", blob], checkout);
  git(["push", "origin", "refs/tags/v2.0.0"], checkout);
  expect(() => resolveTag("v2.0.0", checkout)).toThrow();
  git(["push", "origin", `${b}:refs/tags/v1.2.3`, "--force"], checkout);
  git(["checkout", "--detach", a], checkout);
  expect(() => assertRelease("v1.2.3", a, checkout)).toThrow("moved");
  git(["push", "origin", ":refs/tags/v1.2.3"], checkout);
  expect(() => assertRelease("v1.2.3", a, checkout)).toThrow();
});

test.each([
  "v01.2.3",
  "v1.2.3-rc1",
  "v1.2.3+build",
  "v1.2.3\nsource_sha=bad",
  "main",
  "--help",
])("rejects unsupported or unsafe release identity %s", (tag) => {
  expect(() => releaseVersion(tag)).toThrow();
});

test("rollback qualifies digest with the authoritative repository and rejects conflicting coordinates", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  expect(imageCoordinate("ghcr.io/owner/app:1.2.3", digest, "Owner/App")).toBe(
    `ghcr.io/owner/app@${digest}`,
  );
  expect(() =>
    imageCoordinate("ghcr.io/other/app:1.2.3", digest, "owner/app"),
  ).toThrow();
  expect(() =>
    imageCoordinate("ghcr.io/owner/app:latest", "sha256:deadbeef", "owner/app"),
  ).toThrow();
  expect(() =>
    imageCoordinate(
      `ghcr.io/owner/app@sha256:${"b".repeat(64)}`,
      digest,
      "owner/app",
    ),
  ).toThrow("disagree");
});

test("resolver CLI writes the tag commit, ignoring dispatch SHA", () => {
  const { checkout, a, b } = fixture();
  const output = path.join(checkout, "outputs");
  execFileSync("bun", [path.resolve("scripts/ci/source.ts"), "resolve"], {
    cwd: checkout,
    env: {
      ...process.env,
      RELEASE_TAG: "v1.2.4",
      GITHUB_SHA: b,
      GITHUB_OUTPUT: output,
    },
  });
  const content = readFileSync(output, "utf8");
  expect(content).toContain(`source_sha=${a}\n`);
  expect(content).toContain(`short_sha=${a.slice(0, 7)}\n`);
  expect(content).not.toContain(b);
});

test.each(["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"])(
  "missing %s fails full delivery without a deployment claim",
  (missing) => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      VERCEL_TOKEN: "fixture-token",
      VERCEL_ORG_ID: "fixture-org",
      VERCEL_PROJECT_ID: "fixture-project",
      [missing]: "",
    };
    const result = spawnSync("bash", ["scripts/ci/production-env.sh"], {
      env,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(missing);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("fixture-token");
  },
);
