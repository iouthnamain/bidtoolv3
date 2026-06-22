import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";

import { normalizeReleaseVersion } from "~/lib/release-manifest";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-onprem-update");

function _canApplyInAppOnPremUpdates(): boolean {
  return process.env.BIDTOOL_ALLOW_IN_APP_UPDATES === "true";
}

async function _applyOnPremUpdate(targetVersion: string): Promise<{
  message: string;
  version: string;
}> {
  if (!canApplyInAppOnPremUpdates()) {
    throw new Error(
      "Cập nhật trong ứng dụng chưa được bật. Chạy lệnh on-prem trên máy chủ hosting Docker.",
    );
  }

  const version = normalizeReleaseVersion(targetVersion);
  const rootDir = process.cwd();
  const scriptPath = path.join(rootDir, "scripts", "onprem-update.sh");

  const output = await new Promise<{
    code: number;
    stderr: string;
    stdout: string;
  }>((resolve, reject) => {
    const child = spawn("sh", [scriptPath], {
      cwd: rootDir,
      env: {
        ...process.env,
        BIDTOOL_IMAGE_TAG: version,
      },
      shell: false,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({
        code: exitCode ?? 1,
        stderr,
        stdout,
      });
    });
  });

  if (output.code !== 0) {
    const message =
      [output.stderr, output.stdout].map((value) => value.trim()).find(Boolean) ??
      `exit code ${output.code}`;
    throw new Error(`Không thể áp dụng cập nhật on-prem: ${message}`);
  }

  return {
    message: `Đã áp dụng cập nhật on-prem ${version}.`,
    version,
  };
}

export const canApplyInAppOnPremUpdates = traceFn(log, "canApplyInAppOnPremUpdates", _canApplyInAppOnPremUpdates);
export const applyOnPremUpdate = traceFn(log, "applyOnPremUpdate", _applyOnPremUpdate);
