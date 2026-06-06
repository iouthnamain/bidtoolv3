# Windows Builds

Stage Windows desktop release artifacts here when preparing a customer package.

Expected files from the GitHub `Release` workflow:

- `BidTool v3 Setup *.exe`
- `*.blockmap`
- `latest.yml`

These files are generated on the `windows-latest` runner because the Windows
installer uses Electron Builder's NSIS target. Keep generated binaries out of
Git; upload them to GitHub Releases or deliver them through the customer release
channel.
