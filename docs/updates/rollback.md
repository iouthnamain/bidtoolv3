# Rollback

Rollback uses committed artifact pins in [`releases/pins.json`](../releases/pins.json).

## Workflow

Run [`.github/workflows/rollback.yml`](../../.github/workflows/rollback.yml) manually with `target_version`.

The workflow:

1. Loads the pinned web deployment and promotes it on Vercel by stored `dpl_...` deployment ID
2. Retags the pinned on-prem digest as `:latest` on GHCR
3. Prints a summary

## Limitations

- Desktop clients stay on their installed version until users update manually
- Database migrations are forward-only
- Rolling back app artifacts after migrations may require a forward hotfix release instead of a downgrade

## Hotfix playbook

If rollback is unsafe because migrations already ran:

1. Fix the issue on `main`
2. Ship a forward patch release:

   ```bash
   bun run release patch --yes
   ```

See [Release CLI](./release-cli.md).

## Related docs

- [Operating guide](./operating-guide.md)
- [CI/CD review](./ci-cd.md)
