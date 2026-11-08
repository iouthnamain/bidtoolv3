module.exports = {
  appId: "local.bidtoolv3",
  productName: "BidTool v3",
  asar: true,
  asarUnpack: [".next/standalone/**/*"],
  directories: {
    output: "../../dist-electron",
  },
  electronVersion: "42.0.1",
  // electron-builder excludes nested node_modules by default, but Next's
  // standalone trace keeps the server's runtime closure in this directory.
  files: ["**/*", ".next/standalone/node_modules/**/*"],
  npmRebuild: false,
  publish: [
    {
      provider: "github",
      owner: "iouthnamain",
      repo: "bidtoolv3",
    },
  ],
  win: {
    icon: "../../public/desktop-icon.ico",
    target: ["nsis"],
  },
  linux: {
    target: ["AppImage"],
    category: "Office",
  },
};
