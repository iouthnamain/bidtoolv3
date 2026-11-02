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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = releaseVersion(
    `v${(process.env.TARGET_VERSION ?? "").replace(/^v/, "")}`,
  );
  const pins = parseReleasePins(
    JSON.parse(readFileSync("releases/pins.json", "utf8")) as unknown,
  );
  const pin = pins.releases[version];
  if (!pin) throw new Error("Requested pin is missing");
  if (
    !/^dpl_[a-zA-Z0-9]+$/.test(pin.web.buildId) ||
    !pin.web.deploymentUrl.startsWith("https://")
  )
    throw new Error("Pin has no real web deployment");
  const source = imageCoordinate(
    pin.onprem.image,
    pin.onprem.digest,
    process.env.GITHUB_REPOSITORY ?? "",
  );
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT required");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${version}\nsource_ref=${source}\nweb_build_id=${pin.web.buildId}\n`,
  );
}
