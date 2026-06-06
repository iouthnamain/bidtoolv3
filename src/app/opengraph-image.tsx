import { ImageResponse } from "next/og";

export const alt =
  "BidTool v3 — Nền tảng điều hành, tìm kiếm và tự động hóa đấu thầu";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: 80,
        background:
          "linear-gradient(135deg, #082f49 0%, #0e7490 45%, #115e59 100%)",
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 96,
            height: 96,
            borderRadius: 20,
            background:
              "linear-gradient(135deg, #0e7490 0%, #075985 50%, #115e59 100%)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          }}
        >
          <svg
            width={64}
            height={64}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M5.5 4h6.8a4.2 4.2 0 0 1 4.2 4.2 3.8 3.8 0 0 1-1.6 3.1 4.2 4.2 0 0 1 2.1 3.7A4.2 4.2 0 0 1 12.8 19H5.5V4Zm3 2.6v3.6h3.7a1.8 1.8 0 0 0 0-3.6H8.5Zm0 6.1V16.4h4.2a1.85 1.85 0 0 0 0-3.7H8.5Z"
              fill="#ffffff"
            />
            <path
              d="m18.4 8.6 1.6 1.6 3.2-3.2"
              stroke="#5eead4"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: -1 }}>
            BidTool v3
          </div>
          <div
            style={{
              fontSize: 20,
              color: "#a5f3fc",
              letterSpacing: 4,
              textTransform: "uppercase",
              fontWeight: 600,
              marginTop: 4,
            }}
          >
            Procurement OS
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          fontSize: 56,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: -1,
          maxWidth: 960,
        }}
      >
        Điều hành tìm thầu, cảnh báo và sourcing từ một màn hình.
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 32,
          fontSize: 24,
          color: "#cffafe",
        }}
      >
        BidWinner • Smart View • Workflow • Excel Sourcing
      </div>
    </div>,
    { ...size },
  );
}
