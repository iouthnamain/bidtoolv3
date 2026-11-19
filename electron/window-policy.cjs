/** @param {string} rawUrl */
function parseHttpUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** @typedef {Pick<Electron.WebFrameMain, "isDestroyed" | "detached" | "origin" | "url">} AppFrame */
/** @typedef {{ isDestroyed: Electron.WebContents["isDestroyed"], mainFrame: AppFrame }} AppWebContents */

/** @param {AppFrame | null} frame @param {string} appOrigin */
function isApprovedAppFrame(frame, appOrigin) {
  return (
    frame !== null &&
    !frame.isDestroyed() &&
    !frame.detached &&
    frame.origin === appOrigin &&
    parseHttpUrl(frame.url)?.origin === appOrigin
  );
}

/**
 * @param {{ sender: AppWebContents, senderFrame: AppFrame | null }} event
 * @param {WeakMap<AppWebContents, string>} appWindowOrigins
 */
function isApprovedIpcSender(event, appWindowOrigins) {
  const { sender } = event;
  const appOrigin = appWindowOrigins.get(sender);
  if (!appOrigin || sender.isDestroyed()) return false;

  const { senderFrame } = event;
  return (
    senderFrame === sender.mainFrame &&
    isApprovedAppFrame(senderFrame, appOrigin)
  );
}

/**
 * @param {string} rawUrl
 * @param {string | undefined} appOrigin
 * @param {boolean} allowExternal
 * @returns {{ action: "allow" | "deny" } | { action: "external", url: string }}
 */
function classifyNavigation(rawUrl, appOrigin, allowExternal) {
  const url = parseHttpUrl(rawUrl);
  if (!url || !appOrigin) return { action: "deny" };
  if (url.origin === appOrigin) return { action: "allow" };
  if (allowExternal && !url.username && !url.password) {
    return { action: "external", url: url.href };
  }
  return { action: "deny" };
}

module.exports = {
  classifyNavigation,
  isApprovedAppFrame,
  isApprovedIpcSender,
  parseHttpUrl,
};
