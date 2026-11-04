import "server-only";

import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-onprem-update");

function _canApplyInAppOnPremUpdates(): boolean {
  // The packaged app has no supported boundary for controlling the Docker host.
  return false;
}

// Keep the legacy service signature for callers; updates must run on the host.
async function _applyOnPremUpdate(_targetVersion: string): Promise<{
  message: string;
  version: string;
}> {
  throw new Error(
    "Cập nhật on-prem trong ứng dụng không được hỗ trợ. Sao chép lệnh cập nhật và chạy trên máy chủ hosting Docker.",
  );
}

export const canApplyInAppOnPremUpdates = traceFn(
  log,
  "canApplyInAppOnPremUpdates",
  _canApplyInAppOnPremUpdates,
);
export const applyOnPremUpdate = traceFn(log, "applyOnPremUpdate", _applyOnPremUpdate);
