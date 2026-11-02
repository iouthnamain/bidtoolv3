import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function git(args: string[], cwd = process.cwd()) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function releaseVersion(tag: string) {
  // Stable releases only: existing pin selection does not order prereleases.
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error("Release tag must be a stable version such as v0.1.0");
  }
  return tag.slice(1);
}

export function requireSha(sha: string) {
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error("Expected full immutable commit SHA");
  return sha;
}

export function resolveTag(tag: string, cwd = process.cwd()) {
  releaseVersion(tag);
  // Fetch a single remote tag into a private ref; never trust stale local tags.
  git(
    [
      "fetch",
      "--no-tags",
      "--force",
      "origin",
      `refs/tags/${tag}:refs/ci/release-tag`,
    ],
    cwd,
  );
  return requireSha(
    git(["rev-parse", "--verify", "refs/ci/release-tag^{commit}"], cwd),
  );
}

export function assertHead(sha: string, cwd = process.cwd()) {
  requireSha(sha);
  if (git(["rev-parse", "HEAD"], cwd) !== sha)
    throw new Error("Checkout does not match resolved source SHA");
}

export function assertRelease(tag: string, sha: string, cwd = process.cwd()) {
  assertHead(sha, cwd);
  if (resolveTag(tag, cwd) !== sha)
    throw new Error("Release tag moved since resolution");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sha = process.env.SOURCE_SHA ?? "";
  const tag = process.env.RELEASE_TAG ?? "";
  switch (process.argv[2]) {
    case "resolve": {
      const resolved = resolveTag(tag);
      if (!process.env.GITHUB_OUTPUT)
        throw new Error("GITHUB_OUTPUT is required");
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `source_sha=${resolved}\nshort_sha=${resolved.slice(0, 7)}\nversion=${releaseVersion(tag)}\nrelease_tag=${tag}\n`,
      );
      break;
    }
    case "assert":
      assertRelease(tag, sha);
      break;
    case "head":
      assertHead(sha);
      break;
    default:
      throw new Error("Usage: source.ts resolve|assert|head");
  }
}
