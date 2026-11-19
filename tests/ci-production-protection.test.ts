import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { verifyProductionProtection } from "../scripts/ci/production-protection";

const repository = "owner/app";
const base = `repos/${repository}/environments/production`;
function environment() {
  return {
    name: "Production",
    can_admins_bypass: false,
    protection_rules: [
      {
        type: "required_reviewers",
        prevent_self_review: true,
        reviewers: [{ type: "Team", reviewer: { id: 42 } }],
      },
    ],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  };
}
function verify(
  metadata: unknown,
  policies: unknown = {
    total_count: 1,
    branch_policies: [{ type: "tag", name: "v*" }],
  },
  ref = "refs/tags/v1.2.3",
) {
  const reads: string[] = [];
  verifyProductionProtection(repository, ref, (endpoint) => {
    reads.push(endpoint);
    if (endpoint === base) return metadata;
    if (endpoint.startsWith(`${base}/deployment-branch-policies?`))
      return policies;
    throw new Error(`Unexpected API read ${endpoint}`);
  });
  return reads;
}

test("valid reviewer and typed tag policy permits the workflow ref without reading secrets", () => {
  expect(verify(environment())).toEqual([
    base,
    `${base}/deployment-branch-policies?per_page=100&page=1`,
  ]);
});

test.each([
  ["missing", undefined],
  ["null", null],
  ["wrong environment", { ...environment(), name: "preview" }],
  ["missing rules", { ...environment(), protection_rules: undefined }],
  ["no reviewers", { ...environment(), protection_rules: [] }],
  [
    "empty reviewers",
    {
      ...environment(),
      protection_rules: [
        { ...environment().protection_rules[0], reviewers: [] },
      ],
    },
  ],
  [
    "invalid reviewer",
    {
      ...environment(),
      protection_rules: [
        {
          ...environment().protection_rules[0],
          reviewers: [{ type: "User", reviewer: {} }],
        },
      ],
    },
  ],
  [
    "self review",
    {
      ...environment(),
      protection_rules: [
        { ...environment().protection_rules[0], prevent_self_review: false },
      ],
    },
  ],
  ["admin bypass", { ...environment(), can_admins_bypass: true }],
  ["unknown bypass state", { ...environment(), can_admins_bypass: undefined }],
  [
    "unknown protection type",
    {
      ...environment(),
      protection_rules: [
        ...environment().protection_rules,
        { type: "unknown" },
      ],
    },
  ],
  ["no restrictions", { ...environment(), deployment_branch_policy: null }],
  [
    "disabled restrictions",
    {
      ...environment(),
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: false,
      },
    },
  ],
  [
    "ambiguous restrictions",
    {
      ...environment(),
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: true,
      },
    },
  ],
])("rejects %s protection metadata", (_label, metadata) => {
  expect(() => verify(metadata)).toThrow();
});

test.each([
  { total_count: 0, branch_policies: [] },
  { total_count: 1, branch_policies: [{ type: "branch", name: "v*" }] },
  { total_count: 1, branch_policies: [{ type: "tag", name: "v9*" }] },
  { total_count: 1, branch_policies: [{ type: "other", name: "v*" }] },
  { total_count: 1, branch_policies: [{ type: "tag" }] },
  { total_count: 2, branch_policies: [{ type: "tag", name: "v*" }] },
  { total_count: 1, branch_policies: [{ type: "tag", name: "v[0-9]*" }] },
])(
  "rejects missing, mismatched, incomplete or unsupported deployment policy %j",
  (policies) => {
    expect(() => verify(environment(), policies)).toThrow();
  },
);

test("selected branches use GITHUB_REF, with slash boundaries and exact literal matching", () => {
  const policies = {
    total_count: 1,
    branch_policies: [{ type: "branch", name: "release/*" }],
  };
  expect(() =>
    verify(environment(), policies, "refs/heads/release/one"),
  ).not.toThrow();
  expect(() =>
    verify(environment(), policies, "refs/heads/release/one/two"),
  ).toThrow();
  expect(() =>
    verify(environment(), policies, "refs/tags/release/one"),
  ).toThrow();
  const exact = {
    total_count: 1,
    branch_policies: [{ type: "branch", name: "main.1" }],
  };
  expect(() => verify(environment(), exact, "refs/heads/main.1")).not.toThrow();
  expect(() => verify(environment(), exact, "refs/heads/mainX1")).toThrow();
  const wildcard = {
    total_count: 1,
    branch_policies: [{ type: "branch", name: "*" }],
  };
  expect(() => verify(environment(), wildcard, "refs/heads/.hidden")).toThrow();
});

test("unreadable selected-ref policies cannot pass after valid environment metadata", () => {
  expect(() =>
    verifyProductionProtection(repository, "refs/tags/v1.2.3", (endpoint) => {
      if (endpoint === base) return environment();
      throw new Error("API unavailable");
    }),
  ).toThrow("API unavailable");
});

test("user reviewers and a known wait timer preserve the same protection requirement", () => {
  expect(() =>
    verify({
      ...environment(),
      protection_rules: [
        {
          type: "required_reviewers",
          prevent_self_review: true,
          reviewers: [{ type: "User", reviewer: { id: 9 } }],
        },
        { type: "wait_timer", wait_timer: 10 },
        { type: "branch_policy" },
      ],
    }),
  ).not.toThrow();
});

test("reads all pages before accepting a selected-ref policy", () => {
  const seen: string[] = [];
  verifyProductionProtection(repository, "refs/tags/v1.2.3", (endpoint) => {
    seen.push(endpoint);
    if (endpoint === base) return environment();
    if (endpoint.endsWith("page=1"))
      return {
        total_count: 101,
        branch_policies: Array.from({ length: 100 }, () => ({
          type: "branch",
          name: "main",
        })),
      };
    return { total_count: 101, branch_policies: [{ type: "tag", name: "v*" }] };
  });
  expect(seen.at(-1)).toContain("page=2");
});

test("protected-branches mode requires actual current branch protection, never infers tag protection", () => {
  const metadata = {
    ...environment(),
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
  };
  function check(ref: string, branch: unknown) {
    verifyProductionProtection(repository, ref, (endpoint) => {
      if (endpoint === base) return metadata;
      expect(endpoint).toBe(`repos/${repository}/branches/release%2Fone`);
      return branch;
    });
  }
  expect(() =>
    check("refs/heads/release/one", { name: "release/one", protected: true }),
  ).not.toThrow();
  for (const branch of [
    null,
    {},
    { name: "release/one", protected: false },
    { name: "other", protected: true },
  ])
    expect(() => check("refs/heads/release/one", branch)).toThrow();
  expect(() => check("refs/tags/v1.2.3", { protected: true })).toThrow(
    "tag restrictions",
  );
});

test.each(["", "main", "refs/pull/1/merge"])(
  "rejects unknown event ref %s before API access",
  (ref) => {
    expect(() =>
      verifyProductionProtection(repository, ref, () => {
        throw new Error("must not read");
      }),
    ).toThrow("GITHUB_REF");
  },
);

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test.each([
  "valid",
  "malformed-json",
  "unprotected",
  "401",
  "403",
  "404",
  "500",
])(
  "real shell/CLI fails closed for %s API state with no credential disclosure",
  (mode) => {
    const directory = mkdtempSync(path.join(tmpdir(), "bidtool-protection-"));
    directories.push(directory);
    const requests = path.join(directory, "requests.jsonl");
    writeFileSync(
      path.join(directory, "environment.json"),
      JSON.stringify(
        mode === "unprotected"
          ? {
              ...environment(),
              protection_rules: [],
              deployment_branch_policy: null,
            }
          : environment(),
      ),
    );
    writeFileSync(
      path.join(directory, "policies.json"),
      JSON.stringify({
        total_count: 1,
        branch_policies: [{ type: "branch", name: "main" }],
      }),
    );
    writeFileSync(
      path.join(directory, "gh"),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_REQUESTS, JSON.stringify(args) + '\\n');
if (['401','403','404','500'].includes(process.env.FIXTURE_MODE)) { console.error('fixture-token must not escape'); process.exit(1); }
if (process.env.FIXTURE_MODE === 'malformed-json') { process.stdout.write('not-json'); process.exit(0); }
process.stdout.write(fs.readFileSync(process.env.FIXTURE_DIRECTORY + (args.at(-1).includes('deployment-branch-policies') ? '/policies.json' : '/environment.json')));
`,
      { mode: 0o755 },
    );
    const result = spawnSync("bash", ["scripts/ci/production-env.sh"], {
      env: {
        NODE_ENV: "test",
        PATH: `${directory}:${process.env.PATH}`,
        GH_TOKEN: "fixture-token",
        VERCEL_TOKEN: "fixture-vercel-token",
        VERCEL_ORG_ID: "fixture-org",
        VERCEL_PROJECT_ID: "fixture-project",
        GITHUB_REPOSITORY: repository,
        GITHUB_REF: "refs/heads/main",
        FIXTURE_MODE: mode,
        FIXTURE_DIRECTORY: directory,
        FIXTURE_REQUESTS: requests,
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(mode === "valid" ? 0 : 1);
    expect(result.stdout + result.stderr).not.toContain("fixture-token");
    expect(result.stdout + result.stderr).not.toContain("fixture-vercel-token");
    if (mode !== "valid")
      expect(result.stdout).not.toContain("protections verified");
    const reads = readFileSync(requests, "utf8")
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line) as unknown);
    expect(reads).toHaveLength(mode === "valid" ? 2 : 1);
    for (const args of reads) {
      expect(args).toContain("GET");
      expect(args).toContain("github.com");
    }
  },
);
