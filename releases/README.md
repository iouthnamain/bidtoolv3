# Releases

Use this folder as a local staging area for release deliverables before upload.

Typical artifacts:

- on-prem package tarballs from `dist-onprem/`
- Linux AppImage files from `dist-electron/`
- Windows installer files from GitHub Actions, staged under `windows/`

Do not commit generated release binaries here. GitHub Releases remains the
source of truth for customer-downloadable artifacts.
