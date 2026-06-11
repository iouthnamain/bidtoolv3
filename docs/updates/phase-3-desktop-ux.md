# Phase 3: Desktop UX

## UI surfaces

- Sidebar update pill in [`sidebar-update-pill.tsx`](../../src/app/_components/dashboard/sidebar-update-pill.tsx)
- Settings → About desktop controls in [`about-version-section.tsx`](../../src/app/_components/dashboard/about-version-section.tsx)

## State sync

Desktop update state uses React Query via [`desktop-update-react-query.ts`](../../src/lib/desktop-update-react-query.ts):

- `staleTime: Infinity`
- `refetchOnMount: "always"`
- Main-process push updates through `bidtool:update-state`

## IPC bridge

Preload exposes:

- `getUpdateState`
- `checkForUpdate`
- `downloadUpdate`
- `installUpdate`
- `onUpdateState`

Install requires confirmation and warns that running tasks may be interrupted.

## Mock update server

For local updater testing:

```bash
bun run start:mock-update-server
BIDTOOL_DESKTOP_MOCK_UPDATES=1 bun run desktop:start
```

Build mock artifacts into `release-mock/` and point the mock server at that directory.

## Electron runtime env

- `BIDTOOL_DESKTOP_MOCK_UPDATES=1`
- `BIDTOOL_DESKTOP_MOCK_UPDATE_PORT=3000`
