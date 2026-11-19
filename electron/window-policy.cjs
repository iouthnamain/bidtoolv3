/** @param {string} rawUrl @param {URL} [base] */
function parseHttpUrl(rawUrl, base) {
  try {
    const url = new URL(rawUrl, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** @param {URL} from @param {string} location */
function resolveProbeRedirect(from, location) {
  const to = parseHttpUrl(location, from);
  if (!to || to.username || to.password) return null;
  return to.origin === from.origin ||
    (from.protocol === "http:" &&
      to.protocol === "https:" &&
      from.hostname === to.hostname)
    ? to.href
    : null;
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
  resolveProbeRedirect,
};
