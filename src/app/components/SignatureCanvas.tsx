import React, {
  useRef,
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";

export interface SignatureCanvasHandle {
  hasDrawing: () => boolean;
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
}

interface Props {
  onDrawingChange?: (hasDrawing: boolean) => void;
  existingUrl?: string;
}

export const SignatureCanvas = forwardRef<SignatureCanvasHandle, Props>(
  ({ onDrawingChange, existingUrl }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawingRef = useRef(false);
    const lastPosRef = useRef<{ x: number; y: number } | null>(null);
    const [hasDrawing, setHasDrawing] = useState(false);
    const [showExisting, setShowExisting] = useState(!!existingUrl);

    // Setup canvas dimensions on mount
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    }, []);

    useImperativeHandle(ref, () => ({
      hasDrawing: () => hasDrawing,
      toBlob: () =>
        new Promise((resolve) => {
          const canvas = canvasRef.current;
          if (!canvas || !hasDrawing) {
            resolve(null);
            return;
          }
          // White background for saved image
          const off = document.createElement("canvas");
          off.width = canvas.width;
          off.height = canvas.height;
          const ctx = off.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, off.width, off.height);
          ctx.drawImage(canvas, 0, 0);
          off.toBlob((blob) => resolve(blob), "image/png", 0.92);
        }),
      clear: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        setHasDrawing(false);
        onDrawingChange?.(false);
      },
    }));

    const getPos = (
      e: React.TouchEvent | React.MouseEvent,
      canvas: HTMLCanvasElement
    ) => {
      const rect = canvas.getBoundingClientRect();
      if ("touches" in e && e.touches.length > 0) {
        return {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
      }
      const me = e as React.MouseEvent;
      return { x: me.clientX - rect.left, y: me.clientY - rect.top };
    };

    const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      isDrawingRef.current = true;
      lastPosRef.current = getPos(e, canvas);
      // If user starts drawing, hide old signature
      if (showExisting) setShowExisting(false);
    };

    const draw = (e: React.TouchEvent | React.MouseEvent) => {
      e.preventDefault();
      if (!isDrawingRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const pos = getPos(e, canvas);
      const last = lastPosRef.current;
      if (!last) return;

      ctx.strokeStyle = "#1e3a8a";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();

      lastPosRef.current = pos;
      if (!hasDrawing) {
        setHasDrawing(true);
        onDrawingChange?.(true);
      }
    };

    const endDraw = (e: React.TouchEvent | React.MouseEvent) => {
      e.preventDefault();
      isDrawingRef.current = false;
      lastPosRef.current = null;
    };

    const handleClear = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      setHasDrawing(false);
      setShowExisting(false);
      onDrawingChange?.(false);
    };

    return (
      <div className="space-y-2">
        {/* Show existing saved signature */}
        {showExisting && existingUrl && !hasDrawing && (
          <div className="relative">
            <img
              src={existingUrl}
              alt="Сохранённая подпись"
              className="w-full h-28 object-contain bg-white rounded-xl border-2 border-green-300 p-2"
            />
            <div className="absolute top-2 left-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              ✓ Сохранена
            </div>
          </div>
        )}

        {/* Canvas */}
        <div className={showExisting && existingUrl ? "hidden" : ""}>
          <canvas
            ref={canvasRef}
            className="w-full h-28 rounded-xl border-2 border-dashed border-blue-300 bg-white cursor-crosshair"
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
            style={{ touchAction: "none" }}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          {hasDrawing ? (
            <p className="text-xs text-blue-600 font-semibold">
              ✓ Подпись получена
            </p>
          ) : showExisting && existingUrl ? (
            <p className="text-xs text-green-600 font-semibold">
              ✓ Подпись сохранена
            </p>
          ) : (
            <p className="text-xs text-slate-400">
              Распишитесь в поле выше
            </p>
          )}

          {(hasDrawing || (showExisting && existingUrl)) && (
            <button
              onClick={handleClear}
              className="text-xs text-red-500 font-medium active:opacity-70"
            >
              🗑 Очистить
            </button>
          )}

          {!hasDrawing && showExisting && existingUrl && (
            <button
              onClick={() => setShowExisting(false)}
              className="text-xs text-blue-500 font-medium active:opacity-70"
            >
              ✏️ Переподписать
            </button>
          )}
        </div>
      </div>
    );
  }
);

SignatureCanvas.displayName = "SignatureCanvas";
