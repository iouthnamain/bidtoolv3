# BidTool v3

BidTool v3 là bàn điều hành hồ sơ thầu dành cho một người vận hành: tìm kiếm cơ hội, chuẩn hóa danh mục vật tư và theo dõi quy trình BidWinner mà không phải ghép nhiều bảng tính rời rạc.

Mã nguồn được xây dựng với Next.js App Router, tRPC, Drizzle, PostgreSQL và Tailwind CSS.

## Tải ứng dụng Windows

- **Windows v0.1.0:** [Tải tệp cài đặt](https://github.com/iouthnamain/bidtoolv3/releases/download/v0.1.0/BidTool.v3.Setup.0.1.0.exe)
- [Xem ghi chú phát hành](https://github.com/iouthnamain/bidtoolv3/releases/tag/v0.1.0)

Bản cài hiện tại chưa ký mã; Windows SmartScreen có thể hiển thị cảnh báo khi mở. Ứng dụng desktop cần `BIDTOOL_SERVER_URL` trỏ tới máy chủ BidTool có thể truy cập, hoặc PostgreSQL có thể kết nối qua `DATABASE_URL` khi chạy ở chế độ máy chủ cục bộ.

## Requirements

Node.js, Bun và Docker chỉ cần khi phát triển hoặc chạy dự án từ mã nguồn; người dùng tải bản cài Windows không cần cài các công cụ này.

- Node.js `20+` and Bun `1.3+`
- Docker Engine with the Docker Compose plugin (runs local PostgreSQL)

## Local Workflow

```bash
bun run dev:install   # first-time setup: deps, .env, PostgreSQL, migrations
bun run dev:update    # after git pull: refresh deps, PostgreSQL, migrations
bun run dev:run       # daily startup, then open http://localhost:3000
```

Demo data is never seeded automatically. To load it, set `ENABLE_DEMO_SEED="true"` in `.env` and run `bun run db:seed`.

## Conventions

- Single-user tool: no auth, sessions, ownership columns, or per-user limits.
- Migrations: edit `src/server/db/schema.ts`, run `bun run db:generate`, review SQL in `drizzle/`, then `bun run db:migrate`. Don't call `drizzle-kit migrate` directly.
- Server-only code under `src/server/`, client utilities under `src/lib/` or `src/app/_components/`.
- User-facing copy is Vietnamese (`vi-VN`).

## Common Scripts

```bash
bun run dev           # Next.js only, no stack checks
bun run check         # ESLint + TypeScript
bun run test          # Vitest
bun run db:migrate    # apply migrations
bun run db:studio     # Drizzle Studio
```

## Deployment

- **Vercel (web):** promoted by the release workflow on `v*` tags. Served at `https://bidtoolv3.vercel.app`. Requires a non-empty `DATABASE_URL`; apply production migrations with `node scripts/db-migrate-runtime.mjs` after schema changes.
- **On-prem (B2B):** isolated Docker stack (Caddy + app + PostgreSQL). Manage with `bun run onprem:install` / `onprem:update` / `onprem:backup` / `onprem:restore` / `onprem:bundle`.
- **Desktop (Electron):** `bun run desktop:dev` for development, `desktop:pack` / `desktop:build` to package. Set `BIDTOOL_SERVER_URL` to connect to an on-prem server, otherwise it runs the local server.

Releases (desktop, on-prem bundle, on-prem image) are built by GitHub Actions. Tag with `bun run release patch` or `git tag v0.1.0 && git push origin v0.1.0`. See [`docs/updates/README.md`](docs/updates/README.md).

## Documentation

- [Main workflows](docs/workflows.md) — routes, tRPC procedures, services, and background jobs
- [Docs index](docs/README.md) — all documentation

## Troubleshooting

- Docker errors: ensure the Docker daemon is running before `dev:*` commands.
- PostgreSQL still starting: rerun `bun run dev:run` or `bun run db:migrate` after a few seconds.
- Env validation failures: refresh `.env` from `.env.example` and reapply local changes.
- New `.env` files use `POSTGRES_HOST_PORT="55432"` to avoid local conflicts.
