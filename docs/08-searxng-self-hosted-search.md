# SearXNG Self-hosted Search

Cập nhật: 2026-04-26

## Kết luận áp dụng

BidTool dùng SearXNG ở lớp `product-web-search` cho flow `excel workspace -> search product`, vì nhu cầu hiện tại là tìm candidate sản phẩm công khai, lưu evidence, rồi để user review. Đây là metasearch phù hợp để tự host và giảm phụ thuộc API SaaS.

Luồng tìm sản phẩm hiện chỉ dùng SearXNG. Provider hiện tại:

- `PRODUCT_WEB_SEARCH_PROVIDER=searxng`: dùng SearXNG.
- `PRODUCT_WEB_SEARCH_PROVIDER=auto`: tương thích cấu hình cũ, vẫn dùng SearXNG.

## Cấu hình local

1. Bật SearXNG profile:

```bash
docker compose --profile search up -d searxng
```

2. Cấu hình app:

```env
PRODUCT_WEB_SEARCH_PROVIDER="searxng"
SEARXNG_BASE_URL="http://localhost:8080"
SEARXNG_TIMEOUT_MS="15000"
SEARXNG_MAX_RESULTS="8"
SEARXNG_LANGUAGE="vi-VN"
SEARXNG_ENGINES=""
```

3. Kiểm tra JSON API:

```bash
curl 'http://localhost:8080/search?q=may%20khoan%20gia%20Viet%20Nam&format=json'
```

Nếu trả về 403, kiểm tra `deploy/searxng/settings.yml` có `search.formats` gồm `json`.

## Lưu ý vận hành

- Không expose public instance nếu chưa có reverse proxy, rate limit, secret và policy rõ ràng.
- SearXNG gọi tiếp các search engine bên ngoài; vẫn cần tôn trọng robots/chính sách nguồn và giới hạn tần suất.
- Local compose đang tắt `server.limiter` để app gọi JSON API trực tiếp qua localhost; nếu public qua reverse proxy thì bật lại limiter và cấu hình IP headers/rate limit rõ ràng.
- `outgoing.request_timeout` đang đặt 5s để tránh làm chậm thao tác review dòng Excel.
- Kết quả SearXNG thường chỉ có title/url/snippet; nếu cần raw page text sâu hơn, thêm crawler riêng sau bước user chọn nguồn.

## Nguồn chính

- SearXNG Search API: https://docs.searxng.org/dev/search_api.html
- SearXNG Docker installation: https://docs.searxng.org/admin/installation-docker.html
- SearXNG `search.formats`: https://docs.searxng.org/admin/settings/settings_search.html
- SearXNG `server.limiter` và `image_proxy`: https://docs.searxng.org/admin/settings/settings_server.html
- SearXNG outgoing timeouts: https://docs.searxng.org/admin/settings/settings_outgoing.html
