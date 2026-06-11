# Rollback

Rollback uses committed artifact pins in [`releases/pins.json`](../releases/pins.json).

## Workflow

Run [`.github/workflows/rollback.yml`](../../.github/workflows/rollback.yml) manually with `target_version`.

The workflow:

1. Loads the pinned web deployment and promotes it on Vercel
2. Retags the pinned on-prem digest as `:latest` on GHCR
3. Prints a summary

## Limitations

- Desktop clients stay on their installed version until users update manually
- Database migrations are forward-only
- Rolling back app artifacts after migrations may require a forward hotfix release instead of a downgrade

## Hotfix playbook

If rollback is unsafe because migrations already ran:

1. Identify the broken behavior
2. Ship `v0.2.1` with a forward-compatible fix
3. Leave `releases/pins.json` current pointer on the hotfix version
