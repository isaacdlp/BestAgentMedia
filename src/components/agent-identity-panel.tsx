"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateAgentPersonaName } from "@/app/actions/agents";

type Props = {
  agentId: number;
  agentName: string;
  personaName: string | null;
  picturePath: string | null;
};

/** Name and picture for agents that have no sub-agents (Designer, Creative, Copywriter). */
export function AgentIdentityPanel({ agentId, agentName, personaName, picturePath }: Props) {
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
      const res = await fetch(`/api/agents/${agentId}/picture`, { method: "POST", body: fd });
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

  const src = preview ?? (picturePath ? `/api/agents/${agentId}/picture?v=${encodeURIComponent(picturePath)}` : null);
  const initial = (personaName || agentName).charAt(0).toUpperCase();

  return (
    <section className="panel agent-control-panel">
      <div className="panel-heading">
        <h2>Identity</h2>
      </div>

      <div className="sub-agent-picture-section">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={personaName || agentName} className="sub-agent-avatar-lg" src={src} />
        ) : (
          <div className="sub-agent-avatar-lg sub-agent-avatar-placeholder-lg">{initial}</div>
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
              {uploading ? "Uploading…" : "Upload"}
            </button>
          ) : null}
        </div>
      </div>

      <form action={updateAgentPersonaName}>
        <input name="id" type="hidden" value={agentId} />
        <label className="sub-agent-config-field">
          <span className="sub-agent-config-field-label">Name</span>
          <input
            className="form-input form-input-sm"
            defaultValue={personaName ?? ""}
            maxLength={100}
            name="personaName"
            placeholder={agentName}
            type="text"
          />
        </label>
        <button className="button button-primary button-small" style={{ marginTop: 12 }} type="submit">
          Save
        </button>
      </form>
    </section>
  );
}
