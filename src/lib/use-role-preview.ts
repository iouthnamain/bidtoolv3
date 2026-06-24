"use client";

import { useCallback, useEffect, useState } from "react";

import { ROLES, type Role } from "~/lib/permissions";

export const ROLE_PREVIEW_STORAGE_KEY = "bidtool:role-preview";

function isRole(value: string | null): value is Role {
  return !!value && (ROLES as readonly string[]).includes(value);
}

export function isRolePreviewAvailable(): boolean {
  return process.env.NODE_ENV === "development";
}

function readPreviewRole(): Role | null {
  if (!isRolePreviewAvailable() || typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(ROLE_PREVIEW_STORAGE_KEY);
    return isRole(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writePreviewRole(role: Role | null) {
  if (!isRolePreviewAvailable() || typeof window === "undefined") {
    return;
  }

  try {
    if (role) {
      window.localStorage.setItem(ROLE_PREVIEW_STORAGE_KEY, role);
    } else {
      window.localStorage.removeItem(ROLE_PREVIEW_STORAGE_KEY);
    }
    window.dispatchEvent(new Event("bidtool:role-preview-change"));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function useRolePreview() {
  const [role, setRoleState] = useState<Role | null>(null);
  const available = isRolePreviewAvailable();

  useEffect(() => {
    if (!available) return;

    const sync = () => setRoleState(readPreviewRole());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("bidtool:role-preview-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("bidtool:role-preview-change", sync);
    };
  }, [available]);

  const setRole = useCallback((nextRole: Role | null) => {
    writePreviewRole(nextRole);
    setRoleState(nextRole);
  }, []);

  return {
    available,
    role: available ? role : null,
    setRole,
    clear: useCallback(() => setRole(null), [setRole]),
  };
}
