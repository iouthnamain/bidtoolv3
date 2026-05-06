const VN_LOCALE = "vi-VN";

export function formatDateTime(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "Chưa có";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "Chưa có";
  }

  return date.toLocaleString(VN_LOCALE);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "Chưa có";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "Chưa có";
  }

  return date.toLocaleDateString(VN_LOCALE);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0";
  }

  return value.toLocaleString(VN_LOCALE);
}
