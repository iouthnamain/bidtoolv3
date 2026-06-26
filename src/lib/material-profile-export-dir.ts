const STORAGE_KEY = "bidtool.materialProfile.lastExportDir";

export type MaterialProfileExportDownloadBundle = {
  excelFileName: string;
  workbookBase64: string;
  catalogFiles: Array<{ fileName: string; base64: string }>;
  catalogCount: number;
  missingCount: number;
  warnings: string[];
};

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

export function isMaterialProfileBrowserFolderPickerSupported() {
  return typeof window.showDirectoryPicker === "function";
}

export async function pickMaterialProfileExportDir(defaultPath?: string | null) {
  const bridge = window.bidtoolDesktop;
  if (!bridge?.isDesktop) {
    return null;
  }

  const initialPath =
    defaultPath?.trim() ||
    getLastMaterialProfileExportDir() ||
    undefined;
  const result = await bridge.pickExportFolder(initialPath);
  return result.path?.trim() || null;
}

function base64ToUint8Array(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function downloadBase64File(fileName: string, base64: string, mimeType: string) {
  const blob = new Blob([base64ToUint8Array(base64)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function writeBase64File(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  base64: string,
) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(base64ToUint8Array(base64));
  await writable.close();
}

export async function pickMaterialProfileBrowserExportDirectory() {
  if (!isMaterialProfileBrowserFolderPickerSupported()) {
    return null;
  }
  return window.showDirectoryPicker();
}

export async function saveMaterialProfileExportBundleInBrowser(
  bundle: MaterialProfileExportDownloadBundle,
  directoryHandle?: FileSystemDirectoryHandle | null,
) {
  if (directoryHandle) {
    await writeBase64File(
      directoryHandle,
      bundle.excelFileName,
      bundle.workbookBase64,
    );
    const catalogDir = await directoryHandle.getDirectoryHandle("Catalog", {
      create: true,
    });
    for (const file of bundle.catalogFiles) {
      await writeBase64File(catalogDir, file.fileName, file.base64);
    }
    return {
      mode: "directory" as const,
      label: directoryHandle.name,
    };
  }

  downloadBase64File(
    bundle.excelFileName,
    bundle.workbookBase64,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );

  for (const file of bundle.catalogFiles) {
    downloadBase64File(
      file.fileName,
      file.base64,
      "application/pdf",
    );
    await new Promise((resolve) => {
      window.setTimeout(resolve, 250);
    });
  }

  return {
    mode: "download" as const,
    label: bundle.excelFileName,
  };
}
