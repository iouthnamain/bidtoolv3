import JSZip from "jszip";

const STORAGE_KEY = "bidtool.materialProfile.lastExportDir";

export type MaterialProfileExportDownloadBundle = {
  outputFolderName: string;
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

function downloadBlob(fileName: string, blob: Blob) {
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

async function getExportOutputDirectory(
  parentHandle: FileSystemDirectoryHandle,
  outputFolderName: string,
) {
  return parentHandle.getDirectoryHandle(outputFolderName, { create: true });
}

async function writeBundleToDirectory(
  outputDirectoryHandle: FileSystemDirectoryHandle,
  bundle: MaterialProfileExportDownloadBundle,
) {
  await writeBase64File(
    outputDirectoryHandle,
    bundle.excelFileName,
    bundle.workbookBase64,
  );
  const catalogDir = await outputDirectoryHandle.getDirectoryHandle("Catalog", {
    create: true,
  });
  for (const file of bundle.catalogFiles) {
    await writeBase64File(catalogDir, file.fileName, file.base64);
  }
}

async function downloadBundleAsZip(bundle: MaterialProfileExportDownloadBundle) {
  const zip = new JSZip();
  const root = zip.folder(bundle.outputFolderName);
  if (!root) {
    throw new Error("Không tạo được folder export.");
  }

  root.file(bundle.excelFileName, base64ToUint8Array(bundle.workbookBase64), {
    binary: true,
  });
  const catalogDir = root.folder("Catalog");
  if (!catalogDir) {
    throw new Error("Không tạo được folder Catalog.");
  }
  for (const file of bundle.catalogFiles) {
    catalogDir.file(file.fileName, base64ToUint8Array(file.base64), {
      binary: true,
    });
  }

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(`${bundle.outputFolderName}.zip`, blob);
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
    const outputDirectoryHandle = await getExportOutputDirectory(
      directoryHandle,
      bundle.outputFolderName,
    );
    await writeBundleToDirectory(outputDirectoryHandle, bundle);
    return {
      mode: "directory" as const,
      label: `${directoryHandle.name}/${bundle.outputFolderName}`,
    };
  }

  await downloadBundleAsZip(bundle);
  return {
    mode: "download" as const,
    label: `${bundle.outputFolderName}.zip`,
  };
}
