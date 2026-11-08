#!/usr/bin/env bash
set -euo pipefail

# All targets are validated/preflighted before either promotion. The EXIT report
# preserves partial results; a failed second action cannot claim full success.
task_dir=$(mktemp -d)
phase='input validation'
image_preflight='not run'
web_preflight='not run'
web_promotion='not run'
image_promotion='not run'
report() {
  result=$?
  trap - EXIT
  {
    printf 'Image preflight: %s\nWeb preflight: %s\nWeb promotion: %s\nImage promotion: %s\n' \
      "$image_preflight" "$web_preflight" "$web_promotion" "$image_promotion"
    if (( result == 0 )); then
      printf 'Artifact rollback completed for %s (%s).\n' "$VERSION" "$SOURCE_REF"
    else
      printf 'Artifact rollback incomplete; failed during %s (exit %s).\n' "$phase" "$result"
    fi
    printf 'No customer host, desktop installation, database or persisted bytes were rolled back.\n'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
  rm -rf -- "$task_dir"
  exit "$result"
}
trap report EXIT

: "${GITHUB_REPOSITORY:?}" "${GITHUB_ACTOR:?}" "${GH_TOKEN:?}"
: "${VERSION:?}" "${SOURCE_REF:?}" "${WEB_SKIPPED:?}"
[[ "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
[[ "$GITHUB_REPOSITORY" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]]
image="ghcr.io/${GITHUB_REPOSITORY,,}"
[[ "$SOURCE_REF" == "$image@sha256:"* ]]
digest="${SOURCE_REF#"$image@"}"
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
case "$WEB_SKIPPED" in
  true) web_preflight='skipped'; web_promotion='skipped' ;;
  false) [[ "${WEB_BUILD_ID:-}" =~ ^dpl_[a-zA-Z0-9]+$ ]] ;;
  *) echo 'Invalid skipped-web state' >&2; exit 1 ;;
esac

guard() {
  # Image-only rollback still requires exactly the same production protections,
  # but no Vercel credentials or Vercel command for an explicitly skipped pin.
  if [[ "$WEB_SKIPPED" == true ]]; then
    bun run scripts/ci/production-protection.ts
  else
    bash scripts/ci/production-env.sh
  fi
}

phase='image preflight'; image_preflight='failed'
guard
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
actual=$(docker buildx imagetools inspect "$SOURCE_REF" --format '{{.Manifest.Digest}}')
[[ "$actual" == "$digest" ]]
image_preflight='passed'

if [[ "$WEB_SKIPPED" == false ]]; then
  phase='web preflight'; web_preflight='failed'
  bunx vercel@65.9.0 inspect "$WEB_BUILD_ID" --token="$VERCEL_TOKEN" --json > "$task_dir/web.json"
  jq -e --arg id "$WEB_BUILD_ID" '.id == $id and .readyState == "READY"' "$task_dir/web.json" >/dev/null
  web_preflight='passed'
  phase='web promotion'; web_promotion='failed'
  guard
  bunx vercel@65.9.0 promote "$WEB_BUILD_ID" --yes --token="$VERCEL_TOKEN"
  web_promotion='promoted'
fi

phase='image promotion'; image_promotion='failed'
guard
docker buildx imagetools create --prefer-index=false --tag "$image:latest" "$SOURCE_REF"
image_promotion='promoted'
