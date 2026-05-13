module.exports = {
  appId: "local.bidtoolv3",
  productName: "BidTool v3",
  asar: true,
  asarUnpack: [".next/standalone/**/*"],
  directories: {
    output: "../../dist-electron",
  },
  electronVersion: "42.0.1",
  files: ["**/*"],
  npmRebuild: false,
  publish: [
    {
      provider: "github",
      owner: "iouthnamain",
      repo: "bidtoolv3",
    },
  ],
  win: {
    icon: "../../public/favicon.ico",
    target: ["nsis"],
  },
  linux: {
    target: ["AppImage"],
    category: "Office",
  },
};
