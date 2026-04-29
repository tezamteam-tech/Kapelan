"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./utils";
import { X } from "lucide-react";

export function RightSideCard({
  open,
  onClose,
  title,
  children,
  defaultWidth = 640,
  minWidth = 640,
  maxWidth = 940,
  className,
  overlayClassName,
  showHeader = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
  overlayClassName?: string;
  showHeader?: boolean;
}) {
  const [width, setWidth] = useState(defaultWidth);
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startWidth: number;
    pointerId?: number;
  }>({ dragging: false, startX: 0, startWidth: defaultWidth });

  useEffect(() => {
    if (open) setWidth((w) => (w ? w : defaultWidth));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clamp = useMemo(() => {
    return (w: number) => Math.max(minWidth, Math.min(maxWidth, w));
  }, [minWidth, maxWidth]);

  function onPointerDownResize(e: React.PointerEvent<HTMLDivElement>) {
    if (!open) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current.dragging = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startWidth = width;
    dragRef.current.pointerId = e.pointerId;
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragRef.current.dragging) return;
      // Card anchored to the right edge, so drag in x affects width.
      const dx = dragRef.current.startX - e.clientX; // dragging to the left increases width
      const next = clamp(dragRef.current.startWidth + dx);
      setWidth(next);
    }
    function onUp(e: PointerEvent) {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      try {
        if (dragRef.current.pointerId !== undefined) {
          (e.target as any)?.releasePointerCapture?.(dragRef.current.pointerId);
        }
      } catch {
        // ignore
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [clamp]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className={cn("absolute inset-0 bg-black/50", overlayClassName)}
        onMouseDown={(e) => {
          // Close only if click on overlay itself.
          if (e.target === e.currentTarget) onClose();
        }}
      />

      <div
        className={cn(
          "absolute top-4 bottom-4 right-0 bg-transparent flex",
          className,
        )}
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Resize handle (drag left edge to change width) */}
        <div
          onPointerDown={onPointerDownResize}
          className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize"
          aria-label="Resize card"
          role="separator"
        />

        <div className="relative w-full h-full bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
          {showHeader && (
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 flex-shrink-0 bg-white">
              <h2 className="font-bold text-slate-800 text-sm">{title}</h2>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
                <X size={20} />
              </button>
            </div>
          )}
          <div className={cn(showHeader ? "flex-1 overflow-y-auto" : "h-full")}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

