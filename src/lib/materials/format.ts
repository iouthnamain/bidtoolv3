export function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseNumberOrDefault(value: string, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function parseIntegerOrDefault(value: string, fallback: number) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

export function formatMoney(
  value: number | null | undefined,
  currency = "VND",
  emptyLabel = "-",
) {
  if (value == null) {
    return emptyLabel;
  }
  return `${value.toLocaleString("vi-VN")} ${currency}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("vi-VN");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("vi-VN");
}

export function formatCoverage(value: number, total: number) {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((value / total) * 100).toLocaleString("vi-VN")}%`;
}
