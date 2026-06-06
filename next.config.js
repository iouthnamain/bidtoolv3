/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

const distDir = process.env.BIDTOOL_NEXT_DIST_DIR?.trim();

/** @type {import("next").NextConfig} */
const config = {
  ...(distDir ? { distDir } : {}),
  output: "standalone",
};

export default config;
