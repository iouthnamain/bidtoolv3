export * from "~/lib/materials/profile-candidate-capture";

export const PROFILE_SOURCE_THRESHOLD = 0.75;
export const PROFILE_SOURCE_MARGIN = 0.05;
export const PROFILE_TARGET_THRESHOLD = 0.85;
export const PROFILE_TARGET_MARGIN = 0.05;

export function isProfilePdfSource(url: string) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return /\.pdf(?:$|[?#])/i.test(url.trim());
  }
}

export function profileSourceEligibility(input: {
  selectedScore: number | null | undefined;
  runnerUpScore?: number | null;
  manuallySelected?: boolean;
}) {
  const score = input.selectedScore ?? 0;
  if (score < PROFILE_SOURCE_THRESHOLD) {
    return { eligible: false, reason: "Nguồn có điểm dưới 75%." } as const;
  }
  if (
    !input.manuallySelected &&
    input.runnerUpScore != null &&
    score - input.runnerUpScore < PROFILE_SOURCE_MARGIN
  ) {
    return {
      eligible: false,
      reason: "Nguồn đứng đầu chưa hơn nguồn kế tiếp ít nhất 5 điểm phần trăm.",
    } as const;
  }
  return { eligible: true, reason: null } as const;
}
