import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0e7490 0%, #075985 50%, #115e59 100%)",
          borderRadius: 6,
        }}
      >
        <svg
          width={22}
          height={22}
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
    ),
    { ...size },
  );
}
