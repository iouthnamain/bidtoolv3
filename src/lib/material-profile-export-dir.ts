const STORAGE_KEY = "bidtool.materialProfile.lastExportDir";

export function getLastMaterialProfileExportDir() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = localStorage.getItem(STORAGE_KEY)?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setLastMaterialProfileExportDir(dirPath: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, dirPath.trim());
  } catch {
    // Ignore quota / privacy errors.
  }
}
