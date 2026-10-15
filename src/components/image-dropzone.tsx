"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const TYPE_LABELS: Record<string, string> = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

export function formatDropzoneSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The standard image upload area: a drop zone with click-to-browse, validation and a list of the
 * chosen files. It is controlled through `files`/`onChange`. Pass `name` to also submit the files
 * with a native form (the hidden input is kept in sync).
 */
export function ImageDropzone({
  files,
  onChange,
  multiple = true,
  accept = DEFAULT_ACCEPT,
  maxFileBytes = 10 * 1024 * 1024,
  maxFiles,
  name,
  disabled = false,
  compact = false,
  showList = true,
  title,
  hint,
  onError,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: string[];
  maxFileBytes?: number;
  /** Maximum number of files this dropzone may hold (counting `files`). */
  maxFiles?: number;
  name?: string;
  disabled?: boolean;
  compact?: boolean;
  /** Hide the built-in file list when the parent renders the chosen files itself. */
  showList?: boolean;
  title?: string;
  hint?: string;
  onError?: (message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);

  function setError(message: string | null) {
    setErrorState(message);
    onError?.(message);
  }

  // Keep the native input in sync so a plain <form> submit/FormData includes the files.
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !name) return;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
  }, [files, name]);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    if (incoming.some((file) => !accept.includes(file.type))) {
      setError(`Upload ${accept.map((type) => TYPE_LABELS[type] ?? type).join(", ")} images only.`);
      return;
    }
    if (incoming.some((file) => file.size > maxFileBytes)) {
      setError(`Each image must be ${formatDropzoneSize(maxFileBytes)} or smaller.`);
      return;
    }
    if (!multiple) {
      setError(null);
      onChange([incoming[0]]);
      return;
    }
    if (maxFiles !== undefined && files.length + incoming.length > maxFiles) {
      setError(`Choose no more than ${maxFiles} image${maxFiles === 1 ? "" : "s"}.`);
      return;
    }
    setError(null);
    onChange([...files, ...incoming]);
  }

  function open() {
    if (!disabled) inputRef.current?.click();
  }

  const formats = accept.map((type) => TYPE_LABELS[type] ?? type).join(", ");
  const defaultHint = `${formats} · max ${formatDropzoneSize(maxFileBytes)} each${
    multiple && maxFiles !== undefined ? ` · up to ${maxFiles}` : ""
  }`;

  return (
    <div className={`dropzone${compact ? " dropzone-compact" : ""}`}>
      <div
        aria-disabled={disabled}
        className={`dropzone-area${dragging ? " dropzone-area-active" : ""}${disabled ? " dropzone-area-disabled" : ""}`}
        onClick={open}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) addFiles(event.dataTransfer.files);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
      >
        <span aria-hidden="true" className="dropzone-icon">↑</span>
        <strong>{title ?? (multiple ? "Drop images here or click to browse" : "Drop an image here or click to browse")}</strong>
        <span className="muted">{hint ?? defaultHint}</span>
        <input
          accept={accept.join(",")}
          hidden
          multiple={multiple}
          name={name}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            // Without a name the input is only a picker; reset so the same file can be re-chosen.
            if (!name) event.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />
      </div>

      {showList && files.length ? (
        <ul className="dropzone-files">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`}>
              <span className="dropzone-file-name">{file.name}</span>
              <span className="muted">{formatDropzoneSize(file.size)}</span>
              <button
                aria-label={`Remove ${file.name}`}
                className="dropzone-file-remove"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                type="button"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="dropzone-error" role="alert">{error}</p> : null}
    </div>
  );
}
