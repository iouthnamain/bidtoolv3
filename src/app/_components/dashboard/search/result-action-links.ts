import type { SearchItem } from "./search-types";

export function detailHrefForItem(item: SearchItem) {
  if (item.entityType === "plan") {
    return `/plan-details/${encodeURIComponent(item.externalId)}?sourceUrl=${encodeURIComponent(item.sourceUrl)}`;
  }

  if (item.entityType === "project") {
    return `/project-details/${encodeURIComponent(item.externalId)}?sourceUrl=${encodeURIComponent(item.sourceUrl)}`;
  }

  return `/package-details/${encodeURIComponent(item.externalId)}?sourceUrl=${encodeURIComponent(item.sourceUrl)}`;
}

export function isPackageItem(item: SearchItem) {
  return item.entityType === "package";
}

export function primaryLinkForItem(item: SearchItem) {
  return isPackageItem(item) ? item.sourceUrl : detailHrefForItem(item);
}

export function primaryLinkOpensExternally(item: SearchItem) {
  return isPackageItem(item);
}

export function toSavePayload(item: SearchItem) {
  if (item.entityType === "plan") {
    return {
      entityType: "plan" as const,
      externalId: item.externalId,
      title: item.title,
      owner: item.owner,
      province: item.province,
      field: item.field,
      procurementMethod: item.procurementMethod,
      budget: item.budget,
      publishedAt: item.publishedAt,
      timeline: item.timeline,
      sourceUrl: item.sourceUrl,
    };
  }

  if (item.entityType === "project") {
    return {
      entityType: "project" as const,
      externalId: item.externalId,
      title: item.title,
      owner: item.owner,
      province: item.province,
      projectGroup: item.projectGroup,
      budget: item.budget,
      publishedAt: item.publishedAt,
      approvedAt: item.approvedAt,
      relatedPlanCount: item.relatedPlanCount,
      sourceUrl: item.sourceUrl,
    };
  }

  return {
    entityType: "package" as const,
    externalId: item.externalId,
    title: item.title,
    inviter: item.inviter,
    province: item.province,
    category: item.category,
    budget: item.budget,
    publishedAt: item.publishedAt,
    closingAt: item.closingAt,
    sourceUrl: item.sourceUrl,
    matchScore: item.matchScore,
  };
}
