const distDir = process.env.BIDTOOL_NEXT_DIST_DIR?.trim();

/** @type {import("next").NextConfig} */
const config = {
  ...(distDir ? { distDir } : {}),
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  serverExternalPackages: ["@sparticuz/chromium-min", "playwright-core"],
  logging: {
    incomingRequests: false,
  },
};

export default config;
