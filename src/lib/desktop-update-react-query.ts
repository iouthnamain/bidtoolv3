"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { DesktopUpdateState } from "~/lib/desktop-update";

export const desktopUpdateQueryKeys = {
  all: ["desktop-update"] as const,
  state: () => [...desktopUpdateQueryKeys.all, "state"] as const,
};

export function desktopUpdateStateQueryOptions() {
  return {
    queryKey: desktopUpdateQueryKeys.state(),
    queryFn: async (): Promise<DesktopUpdateState | null> => {
      const bridge = window.bidtoolDesktop;
      if (!bridge || typeof bridge.getUpdateState !== "function") {
        return null;
      }
      return bridge.getUpdateState();
    },
    staleTime: Infinity,
    refetchOnMount: "always" as const,
  };
}

export function setDesktopUpdateStateQueryData(
  queryClient: ReturnType<typeof useQueryClient>,
  nextState: DesktopUpdateState,
) {
  queryClient.setQueryData(desktopUpdateQueryKeys.state(), nextState);
}

export function useDesktopUpdateState() {
  const queryClient = useQueryClient();
  const query = useQuery(desktopUpdateStateQueryOptions());

  useEffect(() => {
    const bridge = window.bidtoolDesktop;
    if (!bridge || typeof bridge.onUpdateState !== "function") {
      return;
    }

    return bridge.onUpdateState((nextState) => {
      setDesktopUpdateStateQueryData(queryClient, nextState);
    });
  }, [queryClient]);

  return query;
}
