const VN_LOCALE = "vi-VN";

/** Vietnamese locale; times render in the runtime local timezone (browser or Node). */
const localDateFormatter = new Intl.DateTimeFormat(VN_LOCALE);

const localDateTimeFormatter = new Intl.DateTimeFormat(VN_LOCALE, {
  dateStyle: "short",
  timeStyle: "short",
});

function parseDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function formatDateTime(
  value: string | Date | null | undefined,
): string {
  if (value === null || value === undefined || value === "") {
    return "Chưa có";
  }

  const date = parseDate(value);
  if (!date) {
    return typeof value === "string" ? value : "Chưa có";
  }

  return date.toLocaleString(VN_LOCALE);
}

export function formatDateTimeShort(
  value: string | Date | null | undefined,
  emptyLabel = "-",
): string {
  if (value === null || value === undefined || value === "") {
    return emptyLabel;
  }

  const normalized =
    typeof value === "string" && !value.includes("T")
      ? value.replace(" ", "T")
      : value;
  const date = parseDate(normalized);
  if (!date) {
    return typeof value === "string" ? value : emptyLabel;
  }

  return localDateTimeFormatter.format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "Chưa có";
  }

  const date = parseDate(value);
  if (!date) {
    return typeof value === "string" ? value : "Chưa có";
  }

  return localDateFormatter.format(date);
}

export function formatDateShort(
  value: string | Date | null | undefined,
  emptyLabel = "-",
): string {
  if (value === null || value === undefined || value === "") {
    return emptyLabel;
  }

  const normalized =
    typeof value === "string" && !value.includes("T")
      ? value.replace(" ", "T")
      : value;
  const date = parseDate(normalized);
  if (!date) {
    return typeof value === "string" ? value : emptyLabel;
  }

  return localDateFormatter.format(date);
}

/** HH:mm:ss.mmm in the runtime local timezone (for dev log lines). */
export function formatLogTimestamp(date = new Date()): string {
  const time = date.toLocaleTimeString(VN_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${time}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0";
  }

  return value.toLocaleString(VN_LOCALE);
}
