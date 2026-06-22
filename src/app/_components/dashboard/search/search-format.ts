import {
  formatDateShort,
  formatDateTimeShort,
} from "~/lib/datetime";
import type { SearchItem } from "./search-types";

export function formatCurrency(value: number) {
  return `${Number(value).toLocaleString("vi-VN")} VNĐ`;
}

export function formatCompactCurrency(value: number) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("vi-VN", {
      maximumFractionDigits: 1,
    })} tỷ`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("vi-VN", {
      maximumFractionDigits: 0,
    })} triệu`;
  }

  return value.toLocaleString("vi-VN");
}

export function formatDate(value?: string | null) {
  return formatDateShort(value);
}

export function formatDateTime(value?: string | null) {
  return formatDateTimeShort(value);
}

export function summarizeSelected(values: string[], fallback: string): string {
  if (values.length === 0) {
    return fallback;
  }

  if (values.length <= 2) {
    return values.join(", ");
  }

  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

export function ownerTextForItem(item: SearchItem) {
  return item.entityType === "package" ? item.inviter : item.owner;
}

export function fieldTextForItem(item: SearchItem) {
  if (item.entityType === "plan") {
    return [item.field, item.procurementMethod].filter(Boolean).join(" / ");
  }

  if (item.entityType === "project") {
    return item.projectGroup;
  }

  return item.category;
}

export function idHeaderForEntity(entityType: SearchItem["entityType"]) {
  if (entityType === "plan") {
    return "Mã KHLCNT";
  }

  if (entityType === "project") {
    return "Mã dự án";
  }

  return "Số TBMT";
}

export function titleHeaderForEntity(entityType: SearchItem["entityType"]) {
  if (entityType === "plan") {
    return "Tên KHLCNT";
  }

  if (entityType === "project") {
    return "Tên dự án";
  }

  return "Tên gói thầu";
}

export function deadlineHeaderForEntity(entityType: SearchItem["entityType"]) {
  if (entityType === "plan") {
    return "Tiến độ";
  }

  if (entityType === "project") {
    return "Phê duyệt";
  }

  return "Đóng thầu";
}

export function budgetHeaderForEntity(entityType: SearchItem["entityType"]) {
  if (entityType === "project") {
    return "Tổng mức đầu tư";
  }

  return "Giá gói thầu";
}

export function deadlineTextForItem(item: SearchItem) {
  if (item.entityType === "package") {
    return formatDate(item.closingAt);
  }

  if (item.entityType === "plan") {
    return item.timeline ?? "-";
  }

  return formatDate(item.approvedAt);
}
