"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { EmailThreadList } from "@/components/email-thread-view";
import { ImageDropzone } from "@/components/image-dropzone";

type SubAgentConfig = {
  smtpFromEmail?: string;
  smtpFromName?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  smtpRequireTls?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPassword?: string;
  imapSecure?: boolean;
  inboxCheckIntervalSeconds?: number;
};

type SubAgentData = {
  id: number;
  name: string;
  soul: string;
  picturePath: string | null;
  cellNumber: string | null;
  config: SubAgentConfig;
};


function ConfigField({
  label,
  name,
  value,
  type = "text",
  placeholder,
  onChange,
}: {
  label: string;
  name: string;
  value: string | number | boolean | undefined;
  type?: "text" | "number" | "password" | "checkbox";
  placeholder?: string;
  onChange: (name: string, val: string | number | boolean) => void;
}) {
  if (type === "checkbox") {
    return (
      <label className="sub-agent-config-check-label">
        <input
          checked={!!value}
          onChange={(e) => onChange(name, e.target.checked)}
          type="checkbox"
        />
        {label}
      </label>
    );
  }
  return (
    <label className="sub-agent-config-field">
      <span className="sub-agent-config-field-label">{label}</span>
      <input
        className="form-input form-input-sm"
        onChange={(e) =>
          onChange(name, type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)
        }
        placeholder={placeholder}
        type={type}
        value={value === undefined ? "" : String(value)}
      />
    </label>
  );
}

export default function SubAgentDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agentId = Number(params.id);
  const subAgentId = Number(params.subId);

  const [data, setData] = useState<SubAgentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [soul, setSoul] = useState("");
  const [cellNumber, setCellNumber] = useState("");
  const [config, setConfig] = useState<SubAgentConfig>({});
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [picError, setPicError] = useState("");
  const [picPreview, setPicPreview] = useState<string | null>(null);

  const [checkingInbox, setCheckingInbox] = useState(false);
  const [inboxResult, setInboxResult] = useState<string | null>(null);
  const [autoPollActive, setAutoPollActive] = useState(false);

  const load = useCallback(async () => {
    try {
      const agentRes = await fetch(`/api/agents/${agentId}/sub-agents/${subAgentId}`);
      const agentData = (await agentRes.json()) as SubAgentData | { error: string };
      if (!agentRes.ok) throw new Error("error" in agentData ? agentData.error : "Not found.");
      const sa = agentData as SubAgentData;
      setData(sa);
      setName(sa.name);
      setSoul(sa.soul);
      setCellNumber(sa.cellNumber ?? "");
      setConfig((sa.config as SubAgentConfig) ?? {});
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [agentId, subAgentId]);

  useEffect(() => { void load(); }, [load]);

  // Auto-poll inbox on configured interval
  useEffect(() => {
    const intervalSecs = typeof config.inboxCheckIntervalSeconds === "number"
      ? config.inboxCheckIntervalSeconds
      : 15;
    if (!intervalSecs || intervalSecs < 5) return;
    if (!config.imapHost) return; // only poll if IMAP is configured
    setAutoPollActive(true);
    const timer = window.setInterval(async () => {
      try {
        await fetch(`/api/agents/${agentId}/sub-agents/${subAgentId}/check-inbox`, { method: "POST" });
      } catch { /* silent — visible in UI only on manual check */ }
    }, intervalSecs * 1000);
    return () => { setAutoPollActive(false); window.clearInterval(timer); };
  }, [config.inboxCheckIntervalSeconds, config.imapHost, agentId, subAgentId]);

  function updateConfig(field: string, val: string | number | boolean) {
    setConfig((prev) => ({ ...prev, [field]: val === "" ? undefined : val }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveOk(false);
    setSaveError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/sub-agents/${subAgentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          soul,
          cellNumber: cellNumber || null,
          config,
        }),
      });
      const result = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(result.error ?? "Save failed.");
      setSaveOk(true);
      void load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handlePictureFiles(files: File[]) {
    const f = files[0] ?? null;
    setPictureFile(f);
    setPicPreview(f ? URL.createObjectURL(f) : null);
  }

  async function handleUploadPicture() {
    if (!pictureFile) return;
    setUploadingPic(true);
    setPicError("");
    try {
      const fd = new FormData();
      fd.append("picture", pictureFile);
      const res = await fetch(`/api/agents/${agentId}/sub-agents/${subAgentId}/picture`, {
        method: "POST",
        body: fd,
      });
      const result = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(result.error ?? "Upload failed.");
      setPictureFile(null);
      setPicPreview(null);
      void load();
    } catch (err) {
      setPicError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingPic(false);
    }
  }

  async function handleCheckInbox() {
    setCheckingInbox(true);
    setInboxResult(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/sub-agents/${subAgentId}/check-inbox`, { method: "POST" });
      const result = (await res.json()) as { processed?: number; errors?: string[]; error?: string };
      if (!res.ok) throw new Error(result.error ?? "Check failed.");
      const msg = `Processed ${result.processed ?? 0} new message(s).${result.errors?.length ? ` Errors: ${result.errors.join("; ")}` : ""}`;
      setInboxResult(msg);
      void load();
    } catch (err) {
      setInboxResult(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setCheckingInbox(false);
    }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return null;

  const hasPicture = !!(picPreview ?? data.picturePath);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <Link href={`/agents/${agentId}`}>← Agent</Link> / Sub Agents
          </p>
          <h1>{data.name}</h1>
        </div>
        <Link className="button button-secondary" href={`/tasks?agent=${agentId}&subAgent=${subAgentId}`}>
          Tasks
        </Link>
      </div>

      <form onSubmit={(e) => void handleSave(e)}>
        {saveOk ? <p className="form-success">Saved.</p> : null}
        {saveError ? <p className="form-error">{saveError}</p> : null}

        <div className="sub-agent-detail-grid">
          {/* Identity panel */}
          <section className="panel">
            <div className="panel-heading"><h2>Identity</h2></div>

            {/* Picture */}
            <div className="sub-agent-picture-section">
              {hasPicture ? (
                <img
                  alt={data.name}
                  className="sub-agent-avatar-lg"
                  src={picPreview ?? `/api/agents/${agentId}/sub-agents/${subAgentId}/picture`}
                />
              ) : (
                <div className="sub-agent-avatar-lg sub-agent-avatar-placeholder-lg">
                  {data.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="sub-agent-picture-controls">
                <ImageDropzone compact files={pictureFile ? [pictureFile] : []} multiple={false} onChange={handlePictureFiles} />
                {picError ? <p className="form-error">{picError}</p> : null}
                {pictureFile ? (
                  <button
                    className="button button-secondary button-small"
                    disabled={uploadingPic}
                    onClick={() => void handleUploadPicture()}
                    type="button"
                  >
                    {uploadingPic ? "Uploading…" : "Upload picture"}
                  </button>
                ) : null}
              </div>
            </div>

            <label className="sub-agent-config-field">
              <span className="sub-agent-config-field-label">Name</span>
              <input
                className="form-input form-input-sm"
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                required
                type="text"
                value={name}
              />
            </label>

            <div className="sub-agent-config-group" style={{ marginTop: 16 }}>
              <h3 className="sub-agent-config-group-title">Personality</h3>
              <textarea
                className="form-input sub-agent-soul-input"
                maxLength={10000}
                onChange={(e) => setSoul(e.target.value)}
                required
                rows={8}
                value={soul}
              />
            </div>
          </section>

          {/* Email config panel */}
          <section className="panel">
            <div className="panel-heading"><h2>Channels</h2></div>

            <div className="sub-agent-config-group">
              <h3 className="sub-agent-config-group-title">SMTP (Outgoing)</h3>
              <ConfigField label="From email" name="smtpFromEmail" onChange={updateConfig} placeholder="alice@example.com" value={config.smtpFromEmail} />
              <ConfigField label="From name" name="smtpFromName" onChange={updateConfig} placeholder="Alice" value={config.smtpFromName} />
              <ConfigField label="Host" name="smtpHost" onChange={updateConfig} placeholder="smtp.gmail.com" value={config.smtpHost} />
              <ConfigField label="Port" name="smtpPort" onChange={updateConfig} placeholder="587" type="number" value={config.smtpPort} />
              <ConfigField label="Username" name="smtpUser" onChange={updateConfig} placeholder="alice@example.com" value={config.smtpUser} />
              <ConfigField label="Password" name="smtpPassword" onChange={updateConfig} placeholder="app password" type="password" value={config.smtpPassword} />
              <ConfigField label="SSL/TLS" name="smtpSecure" onChange={updateConfig} type="checkbox" value={config.smtpSecure} />
              <ConfigField label="Require TLS upgrade" name="smtpRequireTls" onChange={updateConfig} type="checkbox" value={config.smtpRequireTls} />
            </div>

            <div className="sub-agent-config-group">
              <h3 className="sub-agent-config-group-title">IMAP (Incoming)</h3>
              <ConfigField label="Host" name="imapHost" onChange={updateConfig} placeholder="imap.gmail.com" value={config.imapHost} />
              <ConfigField label="Port" name="imapPort" onChange={updateConfig} placeholder="993" type="number" value={config.imapPort} />
              <ConfigField label="Username" name="imapUser" onChange={updateConfig} placeholder="alice@example.com" value={config.imapUser} />
              <ConfigField label="Password" name="imapPassword" onChange={updateConfig} placeholder="app password" type="password" value={config.imapPassword} />
              <ConfigField label="SSL/TLS" name="imapSecure" onChange={updateConfig} type="checkbox" value={config.imapSecure} />
            </div>

            <div className="sub-agent-config-group">
              <h3 className="sub-agent-config-group-title">Phone</h3>
              <ConfigField label="Cell number" name="cellNumber" onChange={(_, val) => setCellNumber(String(val))} placeholder="+1 555 000 0000" value={cellNumber} />
            </div>

            <div className="sub-agent-config-group">
              <h3 className="sub-agent-config-group-title">Automation</h3>
              <ConfigField
                label="Inbox check interval (seconds)"
                name="inboxCheckIntervalSeconds"
                onChange={updateConfig}
                placeholder="15"
                type="number"
                value={config.inboxCheckIntervalSeconds}
              />
              {autoPollActive ? (
                <div className="inbox-autopoll-status">
                  <span className="inbox-autopoll-dot inbox-autopoll-dot-active" />
                  Auto-polling inbox every {config.inboxCheckIntervalSeconds ?? 15}s
                </div>
              ) : config.imapHost ? (
                <div className="inbox-autopoll-status">
                  <span className="inbox-autopoll-dot" />
                  Auto-poll paused — save to apply interval
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div className="sub-agent-config-actions" style={{ marginTop: 4 }}>
          <button className="button button-primary" disabled={saving} type="submit">
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            className="button button-secondary"
            disabled={checkingInbox}
            onClick={() => void handleCheckInbox()}
            type="button"
          >
            {checkingInbox ? "Checking…" : "Check inbox"}
          </button>
        </div>
        {inboxResult ? (
          <p className={`sub-agent-inbox-result ${inboxResult.startsWith("Error") ? "form-error" : "form-success"}`}>
            {inboxResult}
          </p>
        ) : null}
      </form>

      {/* Email threads */}
      <section className="panel sub-agent-threads-panel">
        <div className="panel-heading">
          <h2>Email Conversations</h2>
        </div>
        <EmailThreadList initialThreadId={searchParams.get("thread")} subAgentId={subAgentId} />
      </section>
    </>
  );
}
