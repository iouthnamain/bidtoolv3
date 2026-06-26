"use client";

import {
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type FloatingRect = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  transform?: string;
};

function measureFloatingRect(
  anchor: HTMLElement,
  offset = 4,
): FloatingRect {
  const rect = anchor.getBoundingClientRect();
  const viewportPadding = 8;
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
  const spaceAbove = rect.top - viewportPadding;
  const openBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;

  if (openBelow) {
    return {
      top: rect.bottom + offset,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(120, Math.min(320, spaceBelow - offset)),
    };
  }

  return {
    top: rect.top - offset,
    left: rect.left,
    width: rect.width,
    maxHeight: Math.max(120, Math.min(320, spaceAbove - offset)),
    transform: "translateY(-100%)",
  };
}

export function FloatingPanel({
  anchorRef,
  contentRef,
  open,
  children,
  className = "",
  offset = 4,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  contentRef?: RefObject<HTMLDivElement | null>;
  open: boolean;
  children: ReactNode;
  className?: string;
  offset?: number;
}) {
  const [rect, setRect] = useState<FloatingRect | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setRect(null);
      return;
    }

    const update = () => {
      if (!anchorRef.current) return;
      setRect(measureFloatingRect(anchorRef.current, offset));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, offset, open]);

  if (!open || !rect || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={contentRef}
      className={`fixed z-[100] ${className}`}
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        maxHeight: rect.maxHeight,
        transform: rect.transform,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
