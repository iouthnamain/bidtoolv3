# Technical Architecture - Search + Workflow dashboard

## 1. Mục tiêu kỹ thuật

Mở rộng app Next.js + tRPC hiện tại để hỗ trợ:

- Search tùy chỉnh có khả năng lưu bộ lọc.
- Workflow tự động có trigger và action cơ bản.
- Dashboard insights tổng hợp theo user.

## 2. Kiến trúc tổng quan

Frontend (Next.js App Router)
- /dashboard
- /search
- /workflows
- /insights

API (tRPC routers)
- searchRouter
- watchlistRouter
- workflowRouter
- insightRouter
- notificationRouter

Data layer
- DB chính (khuyến nghị Postgres)
- Hàng đợi task (BullMQ/Redis hoặc pg-based queue)
- Data ingestion từ nhiều nguồn

## 3. Sơ đồ module đề xuất

src/server/api/routers/
- search.ts
- watchlist.ts
- workflow.ts
- insight.ts
- notification.ts

src/server/services/
- search-service.ts
- workflow-engine.ts
- notification-service.ts
- ingest-service.ts

src/app/(dashboard)/
- dashboard/page.tsx
- search/page.tsx
- workflows/page.tsx
- insights/page.tsx

src/app/_components/dashboard/
- kpi-card.tsx
- alert-card.tsx
- workflow-card.tsx
- smart-filter-panel.tsx

## 4. Data model tối thiểu cho MVP

1. saved_filters
- id
- user_id
- name
- keyword
- provinces[]
- categories[]
- budget_min
- budget_max
- notification_frequency
- created_at

2. watchlists
- id
- user_id
- type (package|inviter|competitor|commodity)
- ref_key
- metadata_json
- created_at

3. workflows
- id
- user_id
- name
- trigger_type
- trigger_config_json
- action_type
- action_config_json
- is_active
- created_at
- updated_at

4. workflow_runs
- id
- workflow_id
- status (success|failed|running)
- started_at
- finished_at
- log_json

5. notifications
- id
- user_id
- channel (in_app|email)
- title
- body
- severity
- is_read
- created_at

## 5. tRPC contracts đề xuất

searchRouter
- queryPackages(input)
- saveFilter(input)
- listSavedFilters()
- deleteSavedFilter(id)

watchlistRouter
- addItem(input)
- removeItem(id)
- listItems(type?)

workflowRouter
- create(input)
- update(input)
- setActive(input)
- list()
- getRuns(workflowId)

insightRouter
- getDashboardSummary()
- getMarketTrend(input)

notificationRouter
- list(input)
- markAsRead(id)
- markAllAsRead()

## 6. Luồng xử lý workflow

1. Trigger (event mới hoặc cron) đưa task vào queue.
2. Worker lấy workflow config, kiểm tra điều kiện.
3. Nếu match, tạo notification và ghi workflow_run.
4. Nếu fail, retry theo chính sách, ghi log lỗi.

## 7. Non-functional requirements

- Idempotency cho workflow runs.
- Logging có correlation id.
- Rate limit cho endpoint search.
- Pagination/cursor cho danh sách lớn.
- Audit log cho thao tác quan trọng.

## 8. Rủi ro và giảm thiểu

- Rủi ro pháp lý dữ liệu: cần whitelist nguồn và chính sách sử dụng.
- Rủi ro nhiều cảnh báo rác: thêm scoring + ngưỡng ưu tiên.
- Rủi ro tải hệ thống khi scan dữ liệu: tách ingest batch và giới hạn tần suất.

## Checklist Kỹ thuật

- [ ] Tạo đầy đủ routers theo thiết kế: search, watchlist, workflow, insight, notification.
- [ ] Chốt schema DB MVP và migration đầu tiên.
- [ ] Dựng workflow worker + queue và log workflow_runs.
- [ ] Áp dụng pagination/rate limit cho endpoint search.
- [ ] Bổ sung logging có correlation id cho các luồng quan trọng.