import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const environmentSchema = z.object({
  name: z.string().refine((name) => name.toLowerCase() === "production"),
  can_admins_bypass: z.literal(false),
  protection_rules: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("required_reviewers"),
        prevent_self_review: z.literal(true),
        reviewers: z
          .array(
            z.object({
              type: z.enum(["User", "Team"]),
              reviewer: z.object({ id: z.number().int().positive() }),
            }),
          )
          .min(1),
      }),
      z.object({
        type: z.literal("wait_timer"),
        wait_timer: z.number().int().min(0).max(43200),
      }),
      z.object({ type: z.literal("branch_policy") }),
    ]),
  ),
  deployment_branch_policy: z
    .object({
      protected_branches: z.boolean(),
      custom_branch_policies: z.boolean(),
    })
    .refine(
      (policy) => policy.protected_branches !== policy.custom_branch_policies,
    ),
});
const policyPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  branch_policies: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(["branch", "tag"]),
    }),
  ),
});
type ReadMetadata = (endpoint: string) => unknown;

function githubMetadata(endpoint: string): unknown {
  try {
    return JSON.parse(
      execFileSync(
        "gh",
        [
          "api",
          "--hostname",
          "github.com",
          "--method",
          "GET",
          "-H",
          "Accept: application/vnd.github+json",
          "-H",
          "X-GitHub-Api-Version: 2022-11-28",
          endpoint,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
      ),
    );
  } catch {
    // Do not echo API bodies, credentials or child-process environment on failure.
    throw new Error(`Cannot read GitHub protection metadata: ${endpoint}`);
  }
}

function matchesPolicy(pattern: string, name: string) {
  // GitHub uses Ruby fnmatch with slash boundaries. Support exact names and the
  // common */? subset; fail closed rather than guess at other Ruby glob syntax.
  if (
    /[\[\]{}\\]/.test(pattern) ||
    pattern.includes("**") ||
    [...pattern].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error(
      "Unsupported deployment policy pattern; protection is unverified",
    );
  // Ruby fnmatch does not let a wildcard consume a leading dot in a segment.
  if (
    name
      .split("/")
      .some(
        (part, index) =>
          part.startsWith(".") && !pattern.split("/")[index]?.startsWith("."),
      )
  )
    return false;
  const expression = [...pattern]
    .map((character) =>
      character === "*"
        ? "[^/]*"
        : character === "?"
          ? "[^/]"
          : character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${expression}$`).test(name);
}

export function verifyProductionProtection(
  repository: string,
  ref: string,
  read: ReadMetadata = githubMetadata,
) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
    throw new Error(
      "GITHUB_REPOSITORY is required for protection verification",
    );
  const match = /^refs\/(heads|tags)\/(.+)$/.exec(ref);
  if (
    !match?.[2] ||
    [...ref].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error(
      "A branch/tag GITHUB_REF is required for protection verification",
    );
  const type = match[1] === "heads" ? "branch" : "tag";
  const name = match[2];
  const base = `repos/${repository}/environments/production`;
  const parsed = environmentSchema.safeParse(read(base));
  if (!parsed.success)
    throw new Error(
      "Production protection is missing or invalid (reviewers, self-review, admin bypass or branch/tag policy)",
    );
  const environment = parsed.data;
  if (
    !environment.protection_rules.some(
      (rule) => rule.type === "required_reviewers",
    )
  )
    throw new Error("Production requires configured required reviewers");

  if (environment.deployment_branch_policy.protected_branches) {
    // GitHub permits all branches when no branch protections exist. A flag alone
    // is insufficient, and it does not establish an applicable tag restriction.
    if (type !== "branch")
      throw new Error(
        "Protected-branches-only policy does not verify tag restrictions",
      );
    const branch = z
      .object({ name: z.literal(name), protected: z.literal(true) })
      .safeParse(
        read(`repos/${repository}/branches/${encodeURIComponent(name)}`),
      );
    if (!branch.success)
      throw new Error("Workflow branch protection is missing or unreadable");
  } else {
    const policies: z.infer<typeof policyPageSchema>["branch_policies"] = [];
    let total: number | undefined;
    do {
      const page = policyPageSchema.parse(
        read(
          `${base}/deployment-branch-policies?per_page=100&page=${Math.floor(policies.length / 100) + 1}`,
        ),
      );
      total ??= page.total_count;
      if (
        total !== page.total_count ||
        page.branch_policies.length > 100 ||
        (policies.length + page.branch_policies.length < total &&
          page.branch_policies.length !== 100)
      )
        throw new Error(
          "Incomplete or changing deployment branch/tag policy metadata",
        );
      policies.push(...page.branch_policies);
      if (policies.length > total)
        throw new Error("Invalid deployment policy count");
    } while (policies.length < total);
    // Evaluate all same-kind patterns so unsupported syntax cannot be silently
    // hidden behind another matching entry. GITHUB_REF is the event ref, not RELEASE_TAG.
    const matches = policies
      .filter((policy) => policy.type === type)
      .map((policy) => matchesPolicy(policy.name, name));
    if (!matches.some(Boolean))
      throw new Error(
        "No deployment branch/tag policy permits the workflow GITHUB_REF",
      );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    verifyProductionProtection(
      process.env.GITHUB_REPOSITORY ?? "",
      process.env.GITHUB_REF ?? "",
    );
    console.log(
      "Production reviewer and workflow-ref protections verified (read-only metadata)",
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Production protection is unverified",
    );
    process.exitCode = 1;
  }
}
