import React, { useRef, useState, useCallback } from "react";
import { projectId, publicAnonKey } from "../../../../utils/supabase/info";
import { Upload, X, ImageIcon, Loader2, Camera, Link2, Check } from "lucide-react";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;

// ─── Types ────────────────────────────────────────────────────────────────────
interface ImageUploadProps {
  /** Current image URL (from Storage) */
  value?: string;
  /** Called with signed URL after successful upload */
  onChange: (url: string) => void;
  /** Storage sub-folder: "warehouse" | "equipment" | "staff" | "misc" */
  folder?: string;
  /** Layout ratio */
  aspect?: "square" | "wide" | "portrait";
  /** Label shown above the widget */
  label?: string;
  /** Placeholder text shown when no image */
  placeholder?: string;
  /** Optional class on the outer wrapper */
  className?: string;
  /** If true the upload widget is read-only */
  disabled?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ImageUpload({
  value,
  onChange,
  folder = "misc",
  aspect = "wide",
  label,
  placeholder = "Нажмите или перетащите фото",
  className = "",
  disabled = false,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [justDone, setJustDone] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  const HEIGHT =
    aspect === "square" ? "h-32" :
    aspect === "portrait" ? "h-48" :
    "h-36";

  async function uploadFile(file: File) {
    if (disabled) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Можно загружать только изображения");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Файл слишком большой (максимум 10 МБ)");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      const res = await fetch(`${API}/upload-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${publicAnonKey}` },
        body: fd,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onChange(data.url);
      setJustDone(true);
      setTimeout(() => setJustDone(false), 2000);
    } catch (e: any) {
      setError(e.message ?? "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  const handleFile = (file: File | null | undefined) => {
    if (file) uploadFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }, [folder]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  function applyUrl() {
    if (urlInput.trim()) { onChange(urlInput.trim()); setUrlInput(""); setShowUrlInput(false); }
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && <label className="text-[11px] font-bold text-slate-500 block">{label}</label>}

      {/* Main Drop Zone */}
      <div
        className={`relative ${HEIGHT} rounded-xl overflow-hidden border-2 transition-all cursor-pointer select-none
          ${dragOver ? "border-blue-400 bg-blue-50 scale-[1.01]" : "border-dashed border-slate-300 hover:border-blue-400 hover:bg-slate-50"}
          ${disabled ? "opacity-60 pointer-events-none" : ""}
        `}
        onClick={() => !uploading && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Image preview */}
        {value && !uploading && (
          <>
            <img
              src={value}
              alt="Preview"
              className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-all flex items-center justify-center opacity-0 hover:opacity-100">
              <div className="flex gap-2">
                <span className="bg-white/90 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow">
                  <Camera size={13} /> Сменить фото
                </span>
              </div>
            </div>
          </>
        )}

        {/* No image / uploading state */}
        {(!value || uploading) && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400">
            {uploading ? (
              <>
                <Loader2 size={24} className="animate-spin text-blue-500" />
                <p className="text-xs font-semibold text-blue-600">Загрузка…</p>
              </>
            ) : justDone ? (
              <>
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <Check size={20} className="text-green-600" />
                </div>
                <p className="text-xs font-semibold text-green-600">Загружено!</p>
              </>
            ) : dragOver ? (
              <>
                <Upload size={24} className="text-blue-500" />
                <p className="text-xs font-semibold text-blue-600">Отпустите для загрузки</p>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                  <ImageIcon size={20} className="text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-slate-500">{placeholder}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">JPG, PNG, WebP — до 10 МБ</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Success indicator when image exists */}
        {value && !uploading && (
          <div className="absolute top-2 left-2">
            {justDone && (
              <span className="bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Check size={9} /> Загружено
              </span>
            )}
          </div>
        )}

        {/* Remove button */}
        {value && !uploading && !disabled && (
          <button
            onClick={e => { e.stopPropagation(); onChange(""); }}
            className="absolute top-2 right-2 bg-black/50 hover:bg-red-600 text-white w-6 h-6 rounded-full flex items-center justify-center transition-all shadow"
            title="Удалить фото"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => handleFile(e.target.files?.[0])}
        disabled={disabled || uploading}
      />

      {/* Action bar */}
      {!disabled && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
          >
            <Upload size={11} /> {value ? "Сменить" : "Загрузить фото"}
          </button>
          <button
            type="button"
            onClick={() => setShowUrlInput(!showUrlInput)}
            className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg transition-all"
          >
            <Link2 size={11} /> URL
          </button>
        </div>
      )}

      {/* URL input fallback */}
      {showUrlInput && (
        <div className="flex gap-2">
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyUrl(); }}}
            placeholder="https://images.unsplash.com/…"
            className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
            autoFocus
          />
          <button onClick={applyUrl}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">
            OK
          </button>
          <button onClick={() => { setShowUrlInput(false); setUrlInput(""); }}
            className="bg-slate-100 text-slate-500 px-2.5 py-1.5 rounded-lg text-xs font-bold">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
          ⚠️ {error}
        </p>
      )}
    </div>
  );
}

// ─── Compact avatar-style upload ─────────────────────────────────────────────
interface AvatarUploadProps {
  value?: string;
  onChange: (url: string) => void;
  folder?: string;
  name?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}

export function AvatarUpload({
  value,
  onChange,
  folder = "staff",
  name = "",
  size = "md",
  disabled = false,
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const SZ = size === "sm" ? "w-12 h-12" : size === "lg" ? "w-20 h-20" : "w-16 h-16";
  const ICON_SZ = size === "sm" ? 14 : size === "lg" ? 22 : 18;

  const initials = name
    .split(" ")
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("");

  async function uploadFile(file: File) {
    if (disabled) return;
    setError(null);
    if (!file.type.startsWith("image/")) { setError("Только изображения"); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Макс. 5 МБ"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      const res = await fetch(`${API}/upload-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${publicAnonKey}` },
        body: fd,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onChange(data.url);
    } catch (e: any) {
      setError(e.message ?? "Ошибка");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`${SZ} rounded-full overflow-hidden relative flex-shrink-0 cursor-pointer group border-2 border-white shadow-md transition-all hover:shadow-lg ${disabled ? "opacity-60 pointer-events-none" : ""}`}
        onClick={() => !uploading && inputRef.current?.click()}
      >
        {value ? (
          <img src={value} className="w-full h-full object-cover" alt={name}
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center">
            <span className="text-white font-black text-lg select-none">{initials || "?"}</span>
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
          {uploading ? (
            <Loader2 size={ICON_SZ} className="text-white animate-spin opacity-100" />
          ) : (
            <Camera size={ICON_SZ} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
        disabled={disabled || uploading}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading || disabled}
        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50"
      >
        {uploading ? "Загрузка…" : value ? "Сменить фото" : "📷 Добавить фото"}
      </button>

      {error && <p className="text-[10px] text-red-500 text-center">{error}</p>}
    </div>
  );
}
