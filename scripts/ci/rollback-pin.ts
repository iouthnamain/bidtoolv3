import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseReleasePins } from "../../src/lib/release-manifest";
import { releaseVersion } from "./source";

export function imageCoordinate(
  image: string,
  digest: string,
  repository: string,
) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
    throw new Error("Invalid GitHub repository");
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error("A full SHA256 digest is required");
  const expected = `ghcr.io/${repository.toLowerCase()}`;
  if (!image.startsWith(`${expected}:`) && !image.startsWith(`${expected}@`))
    throw new Error("Pin must use this repository's GHCR image");
  if (
    !new RegExp(
      `^${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?::[a-zA-Z0-9_.-]+|@sha256:[a-f0-9]{64})$`,
    ).test(image)
  )
    throw new Error("Invalid pinned image");
  if (image.includes("@") && image.split("@")[1] !== digest)
    throw new Error("Image and digest disagree");
  return `${expected}@${digest}`;
}

export function rollbackPin(
  input: unknown,
  target: string,
  repository: string,
) {
  const version = releaseVersion(`v${target.replace(/^v/, "")}`);
  const pin = parseReleasePins(input).releases[version];
  if (!pin) throw new Error("Requested pin is missing");
  const source = imageCoordinate(
    pin.onprem.image,
    pin.onprem.digest,
    repository,
  );
  if (pin.web.buildId === "skipped") {
    return { version, source, web: { kind: "skipped" as const } };
  }
  if (
    !/^dpl_[a-zA-Z0-9]+$/.test(pin.web.buildId) ||
    !pin.web.deploymentUrl.startsWith("https://")
  )
    throw new Error(
      "Pin has no real web deployment or explicit skipped marker",
    );
  return {
    version,
    source,
    web: { kind: "deployment" as const, buildId: pin.web.buildId },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pin = rollbackPin(
    JSON.parse(readFileSync("releases/pins.json", "utf8")) as unknown,
    process.env.TARGET_VERSION ?? "",
    process.env.GITHUB_REPOSITORY ?? "",
  );
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT required");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${pin.version}\nsource_ref=${pin.source}\nweb_skipped=${pin.web.kind === "skipped"}\nweb_build_id=${pin.web.kind === "deployment" ? pin.web.buildId : ""}\n`,
  );
}
