# Releases

This folder contains release metadata tracked in git.

## `pins.json`

Committed artifact pins used by:

- rollback workflow
- runtime version checks via raw GitHub URL
- release audit trail

Do not edit `pins.json` by hand during normal development. The release workflow updates it after each tagged release.

## Local staging

Use this folder as a local staging area for release deliverables before upload.

Typical artifacts elsewhere:

- on-prem package tarballs from `dist-onprem/`
- Linux AppImage files from `dist-electron/`
- Windows installer files from GitHub Actions, staged under `windows/`

Do not commit generated release binaries here. GitHub Releases remains the source of truth for customer-downloadable artifacts.
