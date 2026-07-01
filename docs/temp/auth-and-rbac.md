# Authentication & RBAC · Xác thực & Phân quyền

Authentication, role-based access control (RBAC), and multi-tenancy for BidTool
v3. The app originally shipped with **no authentication by design** — a
single-user / single-tenant tool with network isolation handled by Caddy and
host ports. This document describes the implemented system: **multiple users
with differentiated permissions and tenant-isolated customers** across all three
deployment surfaces.

> Status: **implemented.** Gated behind `AUTH_ENABLED` (default `false`), so the
> app behaves exactly as the pre-auth single-tenant tool until the flag is
> flipped. Library: [Better Auth](https://better-auth.com) — self-hosted, Drizzle
> adapter, `admin` plugin. Auth method: email + password, sessions in HTTP-only
> cookies.

**Why Better Auth:** TypeScript-native, fully self-hosted (no third-party calls,
works in an air-gapped on-prem Docker stack), first-class Drizzle adapter, and an
`admin` plugin for credential/session primitives.

> **🇻🇳 Tiếng Việt** — Xác thực, phân quyền theo vai trò (RBAC) và đa tổ chức
> (multi-tenant) cho BidTool v3. Ban đầu ứng dụng **không có xác thực theo thiết
> kế** — một công cụ đơn người dùng / đơn tổ chức, cách ly mạng bằng Caddy và
> cổng host. Tài liệu này mô tả hệ thống đã triển khai: **nhiều người dùng với
> quyền khác nhau và khách hàng được cô lập theo tổ chức** trên cả ba môi trường
> triển khai.
>
> Trạng thái: **đã triển khai.** Được kiểm soát bằng `AUTH_ENABLED` (mặc định
> `false`), nên ứng dụng hoạt động đúng như công cụ đơn tổ chức trước đây cho đến
> khi bật cờ này. Thư viện: Better Auth — tự host, adapter Drizzle, plugin
> `admin`. Phương thức: email + mật khẩu, phiên lưu trong cookie HTTP-only.
>
> **Vì sao Better Auth:** thuần TypeScript, tự host hoàn toàn (không gọi bên thứ
> ba, chạy được trong Docker on-prem cô lập mạng), adapter Drizzle hạng nhất, và
> plugin `admin` cung cấp các nguyên hàm phiên/đăng nhập.

---

## Roles (locked) · Vai trò (đã chốt)

Four roles, defined in `src/lib/permissions.ts` (`ROLES`). This differs
intentionally from the original `admin/editor/viewer` sketch.

| Role       | Tenant-scoped? | Surface            | Capability                                                               |
| ---------- | -------------- | ------------------ | ------------------------------------------------------------------------ |
| `admin`    | No (internal)  | Dashboard          | Everything — all permissions                                             |
| `manager`  | No (internal)  | Dashboard          | Governance only: `settings:manage`, `users:manage`. No operational work. |
| `staff`    | No (internal)  | Dashboard          | All operational writes/runs. No governance.                              |
| `customer` | **Yes**        | Portal (`/portal`) | Read-only, confined to its own tenant. No permissions.                   |

`isInternalRole()` returns true for admin/manager/staff (dashboard access);
customers are routed to the portal.

> **🇻🇳** Bốn vai trò, định nghĩa trong `src/lib/permissions.ts` (`ROLES`). Cố ý
> khác với phác thảo ban đầu `admin/editor/viewer`.
>
> | Vai trò    | Theo tổ chức?  | Giao diện          | Khả năng                                                              |
> | ---------- | -------------- | ------------------ | --------------------------------------------------------------------- |
> | `admin`    | Không (nội bộ) | Dashboard          | Toàn quyền                                                            |
> | `manager`  | Không (nội bộ) | Dashboard          | Chỉ quản trị: `settings:manage`, `users:manage`. Không làm nghiệp vụ. |
> | `staff`    | Không (nội bộ) | Dashboard          | Mọi thao tác nghiệp vụ. Không quản trị.                               |
> | `customer` | **Có**         | Portal (`/portal`) | Chỉ đọc, giới hạn trong tổ chức của mình. Không có quyền.             |
>
> `isInternalRole()` trả về true cho admin/manager/staff (vào được dashboard);
> khách hàng được điều hướng sang portal.

### Permissions · Quyền

`PERMISSIONS` in `src/lib/permissions.ts`:
`material:write`, `material:delete`, `watchlist:write`, `excelResearch:run`,
`enrichment:run`, `ai:run`, `scrape:run`, `catalog:write`, `workflow:write`,
`settings:manage`, `users:manage`, `onprem:admin`.

`ROLE_PERMISSIONS` map:

- `admin` = all permissions
- `manager` = `settings:manage`, `users:manage`
- `staff` = all operational permissions (the `*:write` / `*:run` set), no
  governance
- `customer` = none

Only mutations and runs are gated as permissions. Reads (search, dashboard,
viewing materials/notifications) are open to any authenticated user;
customer-facing reads are additionally tenant-filtered (see Multi-tenancy).

> **🇻🇳** `PERMISSIONS` trong `src/lib/permissions.ts` (danh sách ở trên). Ánh xạ
> `ROLE_PERMISSIONS`:
>
> - `admin` = tất cả quyền
> - `manager` = `settings:manage`, `users:manage`
> - `staff` = toàn bộ quyền nghiệp vụ (nhóm `*:write` / `*:run`), không quản trị
> - `customer` = không có
>
> Chỉ các thao tác ghi (mutation) và chạy job mới được gắn quyền. Thao tác đọc
> (tìm kiếm, dashboard, xem vật tư/thông báo) mở cho mọi người dùng đã đăng nhập;
> riêng phần đọc của khách hàng còn bị lọc theo tổ chức (xem Đa tổ chức).

---

## Multi-tenancy · Đa tổ chức

A `tenant` is a customer organization (`tenant` table: `id`, `name`, `slug`
[unique], timestamps). The tenancy rule (single source of truth in
`src/server/api/tenant-scope.ts`):

- **Internal roles (admin/manager/staff) and the auth-off state see ALL rows** —
  no tenant filter. Internal users have `tenantId = null` by design.
- **Only `customer` is restricted** to its own tenant. A customer whose
  `tenantId` is null sees **nothing** (`sql\`false\``, fail-closed) — never a leak
  of un-tenanted/global rows.

`user.tenantId` references `tenant.id` with `onDelete: set null`. Eight owned
tables carry a nullable `tenantId` (`saved_filters`, `watchlist_items`,
`workflows`, `notifications`, `shop_scrape_jobs`, `shop_import_jobs`,
`excel_research_jobs`, `material_enrichment_jobs`), each with a `tenant_id` index.

Helpers routers/services use: `withTenant(ctx, column)` (read filter),
`stampTenant(ctx, values)` (attribute inserts to the creator's tenant),
`tenantScopeValue` / `tenantConditionForValue` (for service code without `ctx`).

> **🇻🇳** Một `tenant` là một tổ chức khách hàng (bảng `tenant`: `id`, `name`,
> `slug` [duy nhất], timestamps). Quy tắc tổ chức (nguồn chân lý duy nhất tại
> `src/server/api/tenant-scope.ts`):
>
> - **Vai trò nội bộ (admin/manager/staff) và khi tắt auth thấy TẤT CẢ dữ liệu** —
>   không lọc tổ chức. Người dùng nội bộ có `tenantId = null` theo thiết kế.
> - **Chỉ `customer` bị giới hạn** trong tổ chức của mình. Khách hàng có
>   `tenantId` null thì **không thấy gì** (`sql\`false\``, fail-closed) — không bao
>   giờ rò rỉ dữ liệu chung/không thuộc tổ chức.
>
> `user.tenantId` tham chiếu `tenant.id` với `onDelete: set null`. Tám bảng dữ
> liệu sở hữu mang cột `tenantId` (nullable) kèm index `tenant_id`. Các hàm hỗ
> trợ: `withTenant` (lọc khi đọc), `stampTenant` (gán insert theo tổ chức người
> tạo), `tenantScopeValue` / `tenantConditionForValue` (cho service không có
> `ctx`).

---

## Environment · Biến môi trường

New env vars in `src/env.js` (and `.env` / `.env.example`):

| Variable                  | Required           | Default                    | Notes                                                      |
| ------------------------- | ------------------ | -------------------------- | ---------------------------------------------------------- |
| `AUTH_ENABLED`            | no                 | `false`                    | Master switch. While `false`, the whole system is a no-op. |
| `BETTER_AUTH_SECRET`      | yes (when auth on) | —                          | Min 32 chars. `openssl rand -base64 32`                    |
| `BETTER_AUTH_URL`         | recommended        | derive from `APP_BASE_URL` | Base URL for auth callbacks                                |
| `AUTH_BOOTSTRAP_TOKEN`    | no                 | —                          | One-time token gating `/setup` (web/on-prem)               |
| `AUTH_DESKTOP_AUTO_ADMIN` | no                 | `true`                     | Desktop: auto-create a local admin on first run            |

> **🇻🇳** Các biến môi trường mới trong `src/env.js` (và `.env` / `.env.example`):
>
> | Biến                      | Bắt buộc          | Mặc định                 | Ghi chú                                              |
> | ------------------------- | ----------------- | ------------------------ | ---------------------------------------------------- |
> | `AUTH_ENABLED`            | không             | `false`                  | Công tắc chính. Khi `false`, toàn hệ thống là no-op. |
> | `BETTER_AUTH_SECRET`      | có (khi bật auth) | —                        | Tối thiểu 32 ký tự. `openssl rand -base64 32`        |
> | `BETTER_AUTH_URL`         | nên có            | suy ra từ `APP_BASE_URL` | URL gốc cho callback xác thực                        |
> | `AUTH_BOOTSTRAP_TOKEN`    | không             | —                        | Token một lần để mở `/setup` (web/on-prem)           |
> | `AUTH_DESKTOP_AUTO_ADMIN` | không             | `true`                   | Desktop: tự tạo admin cục bộ ở lần chạy đầu          |

---

## Schema · Lược đồ CSDL

Better Auth tables in `src/server/db/schema.ts` (migration `0020`):

- `user` — id, email, name, emailVerified, image, `role` (`user_role` enum:
  `admin|manager|staff|customer`, default `customer`), `banned`, `banReason`,
  `banExpires`, **`tenantId`** (FK → tenant, `set null`), timestamps
- `session` — id, userId (FK, cascade), token (unique), expiresAt, ipAddress,
  userAgent, impersonatedBy, timestamps
- `account` — credentials (hashed password), provider linkage, userId (FK,
  cascade)
- `verification` — identifier, value, expiresAt
- `tenant` — id, name, slug (unique), timestamps

`session` and `account` cascade on user delete, so deleting a user cleans up
their sessions and credentials automatically.

> **🇻🇳** Các bảng Better Auth trong `src/server/db/schema.ts` (migration `0020`):
>
> - `user` — id, email, name, emailVerified, image, `role` (enum `user_role`:
>   `admin|manager|staff|customer`, mặc định `customer`), `banned`, `banReason`,
>   `banExpires`, **`tenantId`** (FK → tenant, `set null`), timestamps
> - `session` — id, userId (FK, cascade), token (duy nhất), expiresAt, ipAddress,
>   userAgent, impersonatedBy, timestamps
> - `account` — thông tin đăng nhập (mật khẩu đã băm), liên kết provider, userId
>   (FK, cascade)
> - `verification` — identifier, value, expiresAt
> - `tenant` — id, name, slug (duy nhất), timestamps
>
> `session` và `account` cascade khi xóa user, nên xóa một người dùng sẽ tự dọn
> phiên và thông tin đăng nhập của họ.

---

## Auth core · Lõi xác thực

- `src/server/auth.ts` — `betterAuth({ database: drizzleAdapter(db, "pg"),
emailAndPassword: { enabled: true, requireEmailVerification: false },
user: { additionalFields: { tenantId } }, plugins: [admin({ defaultRole:
"customer", adminRoles: ["admin"] })], advanced: { useSecureCookies: surface
!== "desktop-bundled" } })`. `tenantId` is declared as an additional field with
  `input: false` so it is included in the session payload but cannot be set
  through Better Auth's own APIs (it is managed via the tenant/user tRPC routers
  instead).
- `src/app/api/auth/[...all]/route.ts` — mounts the Better Auth handler.
- `src/lib/auth-client.ts` — `createAuthClient` with `adminClient()` +
  `inferAdditionalFields<typeof auth>()`.

> **🇻🇳** `src/server/auth.ts` cấu hình `betterAuth(...)` như trên. `tenantId`
> khai báo là additional field với `input: false` — nên nó có trong payload phiên
> nhưng **không** đặt được qua API của Better Auth (quản lý qua router tRPC
> tenant/user). `src/app/api/auth/[...all]/route.ts` gắn handler Better Auth.
> `src/lib/auth-client.ts` dùng `createAuthClient` với `adminClient()` +
> `inferAdditionalFields`.

---

## tRPC integration · Tích hợp tRPC (`src/server/api/trpc.ts`)

- `createTRPCContext` resolves the session via `auth.api.getSession({ headers })`
  and attaches `{ user, session, tenantId, authEnabled }`. When `AUTH_ENABLED` is
  off it skips session resolution entirely — context is byte-for-byte the
  pre-auth shape (no DB session lookup). A session-lookup failure degrades to
  anonymous rather than 500-ing.
- Procedures, layered on the existing rate-limit → timing chain:
  - `publicProcedure` — no special permission required, but still requires a
    user when auth is on; passes through when auth is off.
  - `protectedProcedure` — requires a user when auth is on; passes through
    (null user) when auth is off. It is currently an alias of `publicProcedure`.
  - `requirePermission(perm)` — checks `can(role, perm)`, throws `FORBIDDEN`
    otherwise. No-op when auth is off.
- Mutating routers are gated with `requirePermission(...)`; permissionless reads
  still require login when auth is on and use `withTenant(...)` for customer
  isolation where data is tenant-owned.
- The rate-limit token bucket is **keyed per user id** (falls back to a shared
  `anon` bucket when there is no user, preserving the old global behavior when
  auth is off).

> **🇻🇳** `createTRPCContext` phân giải phiên qua `auth.api.getSession` và gắn
> `{ user, session, tenantId, authEnabled }`. Khi `AUTH_ENABLED` tắt, nó bỏ qua
> hoàn toàn việc phân giải phiên — context giống hệt thời chưa có auth (không truy
> vấn phiên trong DB). Lỗi tra cứu phiên sẽ hạ xuống ẩn danh thay vì lỗi 500.
>
> Các procedure xếp chồng trên chuỗi rate-limit → timing sẵn có:
> `publicProcedure` (không cần quyền riêng nhưng vẫn yêu cầu user khi auth bật),
> `protectedProcedure` (hiện là alias của `publicProcedure`) và
> `requirePermission(perm)` (kiểm tra `can(role, perm)`, ném `FORBIDDEN`; no-op
> khi tắt). Router có ghi được gắn `requirePermission(...)`; thao tác đọc không
> cần quyền riêng vẫn yêu cầu đăng nhập khi auth bật và dùng `withTenant(...)` để
> cô lập khách hàng. Token bucket rate-limit **khóa theo user id** (lùi về bucket
> `anon` chung khi không có user, giữ đúng hành vi toàn cục cũ khi tắt auth).

---

## User & tenant management · Quản lý người dùng & tổ chức

User and tenant lifecycle run through **dedicated tRPC routers**, not direct
`authClient.admin.*` calls from the client. Reason: Better Auth's admin plugin is
configured `adminRoles: ["admin"]`, so it rejects every admin call from a
`manager` — yet the app grants managers `users:manage`. Routing through tRPC
makes `src/lib/permissions.ts` the single source of truth and lets us enforce
guards the plugin can't.

- `src/server/api/routers/tenant.ts` + `src/server/services/tenant-management.ts`
  — list (with live per-tenant user counts) / create (auto-unique slug from name,
  diacritic-safe) / rename / delete. **Delete refuses while any user still
  belongs to the tenant** (the FK is `set null`; deleting would silently orphan
  customers into the fail-closed null state).
- `src/server/api/routers/user.ts` + `src/server/services/user-management.ts`
  — list / create / setRole / setTenant / ban / delete. Users are created via
  `auth.api.signUpEmail` (so passwords hash exactly like sign-up), then role +
  tenant are applied with a direct DB update (mirrors `/api/setup`).

Both routers are gated by `requirePermission("users:manage")` (admin + manager).
Guards enforced in the service layer (so they hold regardless of caller):

- **Admin-tier protection** — only `admin` may create, promote-to, or modify
  `admin` accounts. Managers manage staff/customer only.
- **Last-admin lockout prevention** — refuses to demote, ban, or delete the final
  active admin.
- **No self-harm** — cannot ban or delete your own account.
- **Ban revokes sessions** — banning deletes the user's session rows so they are
  kicked on the next request.
- **Tenancy invariant** — customers must have a tenant; internal roles are forced
  to `tenantId = null`.

> **🇻🇳** Vòng đời người dùng và tổ chức chạy qua **router tRPC riêng**, không gọi
> trực tiếp `authClient.admin.*` từ client. Lý do: plugin admin của Better Auth
> cấu hình `adminRoles: ["admin"]` nên từ chối mọi lệnh admin của `manager` —
> trong khi app cấp `users:manage` cho manager. Đi qua tRPC giúp
> `src/lib/permissions.ts` là nguồn chân lý duy nhất và cho phép áp các guard mà
> plugin không làm được.
>
> - `routers/tenant.ts` + `services/tenant-management.ts` — liệt kê (kèm số người
>   dùng theo tổ chức theo thời gian thực) / tạo (tự sinh slug duy nhất từ tên, an
>   toàn dấu tiếng Việt) / đổi tên / xóa. **Từ chối xóa khi còn người dùng thuộc
>   tổ chức** (FK là `set null`; xóa sẽ âm thầm đẩy khách hàng về trạng thái null
>   fail-closed).
> - `routers/user.ts` + `services/user-management.ts` — liệt kê / tạo / đổi vai
>   trò / gán tổ chức / khóa / xóa. Người dùng được tạo qua `auth.api.signUpEmail`
>   (băm mật khẩu y như đăng ký), rồi gán vai trò + tổ chức bằng update DB trực
>   tiếp (giống `/api/setup`).
>
> Cả hai router gắn `requirePermission("users:manage")` (admin + manager). Các
> guard ở tầng service (đúng dù caller là ai):
>
> - **Bảo vệ tầng admin** — chỉ `admin` mới tạo, nâng lên, hoặc sửa tài khoản
>   `admin`. Manager chỉ quản lý staff/customer.
> - **Chống khóa hết admin** — từ chối hạ cấp, khóa, hoặc xóa admin hoạt động cuối
>   cùng.
> - **Không tự hại** — không thể tự khóa hoặc tự xóa tài khoản của mình.
> - **Khóa thu hồi phiên** — khi khóa, xóa các bản ghi phiên để người dùng bị đẩy
>   ra ở request kế tiếp.
> - **Bất biến tổ chức** — khách hàng phải có tổ chức; vai trò nội bộ bị ép
>   `tenantId = null`.

---

## Route / RSC / file guards · Bảo vệ route / RSC / tệp

- `src/middleware.ts` — optimistic cookie check (not full validation); redirects
  unauthenticated requests to `/login` preserving a `redirect` param. No-op when
  `AUTH_ENABLED` is off. Public allowlist: `/login`, `/setup`, `/api/auth/*`,
  **`/api/setup`**, `/api/health`, `/api/version`, `/api/trpc/*`, static assets.
- `src/app/(dashboard)/layout.tsx` — authoritative RSC guard (defense in depth):
  validates the session, redirects anonymous → `/login`, and non-internal
  (customer) → `/portal`.
- `src/app/(dashboard)/settings/require-page-permission.ts` — finer-grained RSC
  guard applied to `/settings/users` and `/settings/tenants`: redirects users
  lacking `users:manage` back to `/settings` (so a `staff` user can't even load
  the route, not just have the contents hidden).
- `src/app/api/catalog-pdfs/[id]/file/route.ts` — returns 401 when unauthenticated
  under auth.
- `src/app/(portal)/` — the customer portal surface (read-only, tenant-isolated).

> **🇻🇳** `src/middleware.ts` — kiểm tra cookie kiểu lạc quan (không xác thực đầy
> đủ); chuyển hướng request chưa đăng nhập về `/login` kèm tham số `redirect`.
> No-op khi `AUTH_ENABLED` tắt. Danh sách công khai: `/login`, `/setup`,
> `/api/auth/*`, **`/api/setup`**, `/api/health`, `/api/version`, `/api/trpc/*`,
> tài nguyên tĩnh. `(dashboard)/layout.tsx` — guard RSC có thẩm quyền (phòng thủ
> nhiều lớp): xác thực phiên, chuyển ẩn danh → `/login`, không-nội-bộ (khách hàng)
> → `/portal`. `settings/require-page-permission.ts` — guard RSC chi tiết hơn cho
> `/settings/users` và `/settings/tenants`: đẩy người thiếu `users:manage` về
> `/settings` (staff không thể tải route, chứ không chỉ ẩn nội dung).
> `api/catalog-pdfs/[id]/file/route.ts` trả 401 khi chưa đăng nhập. `(portal)/` là
> giao diện khách hàng (chỉ đọc, cô lập theo tổ chức).

---

## UI · Giao diện

- `/login`, `/setup` (first-admin bootstrap, gated by `AUTH_BOOTSTRAP_TOKEN`).
- `/settings/users` — `UserManagementSection`: create users with a role + (for
  customers) a **tenant dropdown**, reassign role/tenant, ban/unban, delete.
  Admin-only controls are hidden from managers.
- `/settings/tenants` — `TenantManagementSection`: create / rename / delete
  tenants with live user counts; delete disabled while members remain.
- `usePermissions()` (`src/lib/use-permissions.ts`) — `{ role, can, isInternal,
user, isPending }`, backed by the same `permissions.ts` map, for hiding/disabling
  actions. Header shows the current user + sign-out (`UserControl`).

> **🇻🇳** `/login`, `/setup` (khởi tạo admin đầu tiên, mở bằng
> `AUTH_BOOTSTRAP_TOKEN`). `/settings/users` — `UserManagementSection`: tạo người
> dùng với vai trò + (với khách hàng) **dropdown tổ chức**, đổi vai trò/tổ chức,
> khóa/mở khóa, xóa. Điều khiển chỉ-admin được ẩn với manager. `/settings/tenants`
> — `TenantManagementSection`: tạo / đổi tên / xóa tổ chức kèm số người dùng; nút
> xóa bị vô hiệu khi còn thành viên. `usePermissions()` trả `{ role, can,
isInternal, user, isPending }` dựa trên cùng bản đồ `permissions.ts`, để ẩn/vô
> hiệu thao tác. Header hiển thị người dùng hiện tại + đăng xuất (`UserControl`).

---

## Surface-aware behavior · Hành vi theo môi trường

Gate on `BIDTOOL_DEPLOYMENT_SURFACE`:

- **web / on-prem** — auth required. First admin created via the one-time
  `/setup` page gated by `AUTH_BOOTSTRAP_TOKEN` (`src/app/api/setup/route.ts`:
  constant-time token compare, refuses once any user exists).
- **desktop-bundled** — auth still on, but `ensureDesktopAdmin()`
  (`src/server/services/auth-bootstrap.ts`, called from `instrumentation.ts`)
  seeds a deterministic local admin (`desktop-admin@localhost`) when
  `AUTH_DESKTOP_AUTO_ADMIN=true` and no user exists, so the solo local user is
  never blocked. Gated strictly to the desktop surface; never runs on web/onprem.

> **🇻🇳** Quyết định theo `BIDTOOL_DEPLOYMENT_SURFACE`:
>
> - **web / on-prem** — bắt buộc xác thực. Admin đầu tiên tạo qua trang `/setup`
>   một lần, mở bằng `AUTH_BOOTSTRAP_TOKEN` (`api/setup/route.ts`: so sánh token
>   thời gian hằng số, từ chối khi đã có người dùng).
> - **desktop-bundled** — vẫn bật auth, nhưng `ensureDesktopAdmin()`
>   (`services/auth-bootstrap.ts`, gọi từ `instrumentation.ts`) seed một admin cục
>   bộ cố định (`desktop-admin@localhost`) khi `AUTH_DESKTOP_AUTO_ADMIN=true` và
>   chưa có người dùng, để người dùng đơn lẻ không bị chặn. Chỉ chạy ở môi trường
>   desktop; không bao giờ chạy trên web/onprem.

---

## Rollout / operations · Triển khai / vận hành

Order matters — **ship the migration before flipping `AUTH_ENABLED`**:

1. Run migrations (the on-prem entrypoint runs `db-migrate-runtime.mjs` on boot).
2. Run `bun run auth:backfill` (`scripts/auth-backfill.ts`) — creates the `host`
   tenant and attributes existing owned rows to it.
3. Set `AUTH_ENABLED=true` (and `BETTER_AUTH_SECRET`, `AUTH_BOOTSTRAP_TOKEN`).
4. Create the first admin at `/setup`, then sign in at `/login`.
5. Create additional users/tenants under `/settings/users` and
   `/settings/tenants`.

> **🇻🇳** Thứ tự quan trọng — **chạy migration trước khi bật `AUTH_ENABLED`**:
>
> 1. Chạy migration (entrypoint on-prem chạy `db-migrate-runtime.mjs` khi khởi
>    động).
> 2. Chạy `bun run auth:backfill` — tạo tổ chức `host` và gán dữ liệu sở hữu hiện
>    có vào đó.
> 3. Đặt `AUTH_ENABLED=true` (cùng `BETTER_AUTH_SECRET`, `AUTH_BOOTSTRAP_TOKEN`).
> 4. Tạo admin đầu tiên ở `/setup`, rồi đăng nhập ở `/login`.
> 5. Tạo thêm người dùng/tổ chức ở `/settings/users` và `/settings/tenants`.

---

## Risks & things to watch · Rủi ro & lưu ý

- **Migration ordering.** Auth tables must migrate before `AUTH_ENABLED=true`, or
  existing deployments lock out. Sequence each release as "ship migrations, then
  flip the flag."
- **Backfill before flip.** Without `auth:backfill`, pre-existing owned rows have
  `tenantId = null`. Internal users still see everything (the rule ignores null
  for them), but run it so the data model is coherent before real use.
- **No SMTP on-prem.** Air-gapped installs have no outbound email.
  `requireEmailVerification: false`; admins reset passwords directly.
- **Secure cookies.** HTTPS-only cookies on web/on-prem; relaxed only for
  `desktop-bundled` local (`http://localhost`).
- **Admin-vs-manager boundary.** Better Auth's `adminRoles: ["admin"]` means the
  plugin's own admin endpoints reject managers; all manager-capable user
  management therefore goes through the tRPC routers, which honor the app's
  `users:manage` model. Keep new user/tenant operations on that path, not on
  `authClient.admin.*`.

> **🇻🇳**
>
> - **Thứ tự migration.** Bảng auth phải migrate trước khi `AUTH_ENABLED=true`,
>   nếu không các deployment hiện có sẽ bị khóa. Mỗi bản phát hành theo trình tự
>   "chạy migration rồi mới bật cờ".
> - **Backfill trước khi bật.** Không chạy `auth:backfill` thì dữ liệu sở hữu cũ
>   có `tenantId = null`. Người dùng nội bộ vẫn thấy tất cả (quy tắc bỏ qua null
>   với họ), nhưng nên chạy để mô hình dữ liệu nhất quán trước khi dùng thật.
> - **Không có SMTP on-prem.** Bản cô lập mạng không gửi được email.
>   `requireEmailVerification: false`; admin đặt lại mật khẩu trực tiếp.
> - **Cookie an toàn.** Cookie chỉ-HTTPS trên web/on-prem; chỉ nới lỏng cho
>   `desktop-bundled` cục bộ (`http://localhost`).
> - **Ranh giới admin–manager.** `adminRoles: ["admin"]` của Better Auth khiến các
>   endpoint admin của plugin từ chối manager; do đó mọi quản lý người dùng mà
>   manager làm được đều đi qua router tRPC (tôn trọng mô hình `users:manage` của
>   app). Giữ thao tác user/tenant mới trên đường đó, không dùng `authClient.admin.*`.

---

## Not yet implemented · Chưa triển khai

- **Per-role URL surfaces** (`/admin/*`, `/staff/*`, `/manager/*`) with
  role-filtered nav and hard-blocked routes — designed, not built.
- Backfilling the `actor` audit columns with real `user.id`s.

> **🇻🇳** Giao diện URL theo vai trò (`/admin/*`, `/staff/*`, `/manager/*`) với
> nav lọc theo vai trò và route chặn cứng — đã thiết kế, chưa làm. Backfill cột
> audit `actor` bằng `user.id` thật.

---

## References · Tham khảo

- [Better Auth docs](https://better-auth.com/docs)
- [Better Auth admin plugin](https://better-auth.com/docs/plugins/admin)
- `docs/deployment.md` — deployment surfaces and env var reference
- `src/lib/permissions.ts` — role/permission source of truth
- `src/server/api/tenant-scope.ts` — tenancy rule
