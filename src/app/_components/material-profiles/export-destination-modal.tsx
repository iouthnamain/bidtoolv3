"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";

import { Button } from "~/app/_components/ui/button";
import { FilterField } from "~/app/_components/ui/filter-field";
import { getLastMaterialProfileExportDir } from "~/lib/material-profile-export-dir";
import { api } from "~/trpc/react";

export function ExportDestinationModal({
  open,
  isExporting,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  isExporting: boolean;
  onConfirm: (outputDirPath: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [outputDirPath, setOutputDirPath] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const defaultExportDirQuery = api.materialProfile.getDefaultExportDir.useQuery(
    undefined,
    { enabled: open },
  );

  useEffect(() => {
    setIsDesktop(!!window.bidtoolDesktop?.isDesktop);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      confirmRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const remembered = getLastMaterialProfileExportDir();
    if (remembered) {
      setOutputDirPath(remembered);
      return;
    }
    if (defaultExportDirQuery.data?.path) {
      setOutputDirPath(defaultExportDirQuery.data.path);
    }
  }, [defaultExportDirQuery.data?.path, open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape" && !isExporting) {
        event.preventDefault();
        onCancel();
      }
    },
    [isExporting, onCancel],
  );

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDialogElement>) => {
      if (event.target === dialogRef.current && !isExporting) {
        onCancel();
      }
    },
    [isExporting, onCancel],
  );

  const browseFolder = async () => {
    const bridge = window.bidtoolDesktop;
    if (!bridge?.isDesktop) return;
    const result = await bridge.pickExportFolder(outputDirPath || undefined);
    if (result.path) {
      setOutputDirPath(result.path);
    }
  };

  const handleConfirm = () => {
    const trimmed = outputDirPath.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-auto w-full max-w-lg rounded border border-slate-400 bg-white p-0 shadow-xl backdrop:bg-slate-900/40 "
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      aria-labelledby="export-destination-title"
      aria-describedby="export-destination-desc"
    >
      <div className="p-5" onClick={(event) => event.stopPropagation()}>
        <h2
          id="export-destination-title"
          className="text-base font-semibold text-slate-900"
        >
          Chọn thư mục export
        </h2>
        <p
          id="export-destination-desc"
          className="mt-1.5 text-sm leading-relaxed text-slate-600"
        >
          Excel và folder Catalog sẽ được lưu trực tiếp vào thư mục bạn chọn.
          Export lại cùng thư mục sẽ ghi đè file Excel và catalog trùng tên.
        </p>

        <div className="mt-4 space-y-3">
          <FilterField label="Thư mục đích">
            <div className="flex gap-2">
              <input
                value={outputDirPath}
                onChange={(event) => setOutputDirPath(event.target.value)}
                placeholder="/home/user/Downloads"
                className="min-w-0 flex-1 rounded border border-slate-400 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                disabled={isExporting}
              />
              {isDesktop ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void browseFolder()}
                  disabled={isExporting}
                  leftIcon={<FolderOpen className="h-4 w-4" />}
                >
                  Browse
                </Button>
              ) : null}
            </div>
          </FilterField>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={isExporting}
          >
            Hủy
          </Button>
          <Button
            ref={confirmRef}
            size="sm"
            onClick={handleConfirm}
            isLoading={isExporting}
            disabled={!outputDirPath.trim()}
          >
            Export
          </Button>
        </div>
      </div>
    </dialog>
  );
}
