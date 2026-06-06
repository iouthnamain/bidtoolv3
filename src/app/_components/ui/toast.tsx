"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";

type ToastVariant = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  durationMs: number;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant, durationMs?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

const variantStyles: Record<ToastVariant, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  error: "border-rose-300 bg-rose-50 text-rose-800",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  info: "border-sky-300 bg-sky-50 text-sky-800",
};

const variantIcons: Record<ToastVariant, ReactNode> = {
  success: (
    <CircleCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
  ),
  error: <CircleAlert className="h-4 w-4 text-rose-500" aria-hidden="true" />,
  warning: (
    <TriangleAlert className="h-4 w-4 text-amber-500" aria-hidden="true" />
  ),
  info: <Info className="h-4 w-4 text-sky-500" aria-hidden="true" />,
};

let nextId = 0;

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(toast.id), 200);
    }, toast.durationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.durationMs, onDismiss]);

  const handleDismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`toast-enter flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm font-medium shadow-md transition-[opacity,transform] duration-200 ${
        variantStyles[toast.variant]
      } ${exiting ? "translate-x-4 opacity-0" : "translate-x-0 opacity-100"}`}
    >
      <span className="mt-0.5 shrink-0">{variantIcons[toast.variant]}</span>
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        type="button"
        className="ml-1 shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
        onClick={handleDismiss}
        aria-label="Đóng thông báo"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info", durationMs = 4000) => {
      const id = ++nextId;
      setToasts((prev) => [
        ...prev.slice(-4),
        { id, message, variant, durationMs },
      ]);
    },
    [],
  );

  const value: ToastContextValue = {
    toast: addToast,
    success: useCallback((msg: string) => addToast(msg, "success"), [addToast]),
    error: useCallback(
      (msg: string) => addToast(msg, "error", 6000),
      [addToast],
    ),
    warning: useCallback(
      (msg: string) => addToast(msg, "warning", 5000),
      [addToast],
    ),
    info: useCallback((msg: string) => addToast(msg, "info"), [addToast]),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Thông báo"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-end gap-2 p-4 sm:p-6"
      >
        <div className="pointer-events-auto flex flex-col gap-2">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
