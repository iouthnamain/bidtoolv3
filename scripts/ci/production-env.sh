#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?Full production delivery requires VERCEL_TOKEN}"
: "${VERCEL_ORG_ID:?Full production delivery requires VERCEL_ORG_ID}"
: "${VERCEL_PROJECT_ID:?Full production delivery requires VERCEL_PROJECT_ID}"
