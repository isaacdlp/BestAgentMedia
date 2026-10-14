"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  userId: string;
  name: string;
  picturePath: string | null;
};

export function UserPictureUpload({ userId, name, picturePath }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("picture", file);
      const res = await fetch(`/api/users/${userId}/picture`, { method: "POST", body: fd });
      const result = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(result.error ?? "Upload failed.");
      setFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const src =
    preview ?? (picturePath ? `/api/users/${userId}/picture?v=${encodeURIComponent(picturePath)}` : null);

  return (
    <div className="sub-agent-picture-section">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={name} className="sub-agent-avatar-lg" src={src} />
      ) : (
        <div className="sub-agent-avatar-lg sub-agent-avatar-placeholder-lg">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="sub-agent-picture-controls">
        <input accept="image/jpeg,image/png,image/webp" onChange={handleChange} ref={fileRef} type="file" />
        {error ? <p className="form-error">{error}</p> : null}
        {file ? (
          <button
            className="button button-secondary button-small"
            disabled={uploading}
            onClick={() => void handleUpload()}
            type="button"
          >
            {uploading ? "Uploading…" : "Upload picture"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
