import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { toggleAgent, updateAgentSettings } from "@/app/actions/agents";
import Link from "next/link";
import { AgentIdentityPanel } from "@/components/agent-identity-panel";
import type { SubAgentSummary } from "@/components/sub-agent-list";
import { SubAgentList } from "@/components/sub-agent-list";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  DEFAULT_MAX_DISCOUNT_PERCENT,
  DEFAULT_PROMOTION_FOLLOW_UP_DAYS,
  DEFAULT_PROMOTION_MODEL,
} from "@/lib/promotion-packages";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) redirect("/dashboard");

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();

  const agent = await prisma.agent.findUnique({
    where: { id: Number(id) },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      enabled: true,
      settings: true,
      personaName: true,
      picturePath: true,
      updatedAt: true,
    },
  });
  if (!agent) notFound();
  const hasSubAgents = agent.slug === "assistant" || agent.slug === "marketer";

  const [{ sas: subAgents, saTotal: subAgentTotal }] = await Promise.all([
    agent.slug === "assistant" || agent.slug === "marketer"
      ? Promise.all([
          prisma.subAgent.findMany({
            where: { agentId: agent.id },
            orderBy: { createdAt: "asc" },
            take: 50,
            select: {
              id: true,
              name: true,
              soul: true,
              picturePath: true,
              cellNumber: true,
              config: true,
              createdAt: true,
              updatedAt: true,
              _count: { select: { emailThreads: true } },
            },
          }),
          prisma.subAgent.count({ where: { agentId: agent.id } }),
        ]).then(([sas, saTotal]) => ({ sas, saTotal }))
      : Promise.resolve({ sas: [], saTotal: 0 }),
  ]);

  const settingsJson = JSON.stringify(agent.settings, null, 2);
  const serializedSubAgents = JSON.parse(JSON.stringify(subAgents)) as SubAgentSummary[];

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">AGENTS</p>
          <h1>{agent.personaName ? `${agent.personaName} · ${agent.name}` : agent.name}</h1>
          <p className="muted">{agent.description}</p>
        </div>
        <div className="page-heading-actions">
          <span className={`role-pill ${agent.enabled ? "" : "role-pill-muted"}`}>
            {agent.enabled ? "Enabled" : "Disabled"}
          </span>
          <Link className="button button-secondary" href={`/tasks?agent=${agent.id}`}>
            Tasks
          </Link>
        </div>
      </div>

      <div className="agent-detail-grid">
        {/* Name and picture (agents without sub-agents) */}
        {!hasSubAgents ? (
          <AgentIdentityPanel
            agentId={agent.id}
            agentName={agent.name}
            personaName={agent.personaName}
            picturePath={agent.picturePath}
          />
        ) : null}

        {/* Enable / disable toggle */}
        <section className="panel agent-control-panel">
          <div className="panel-heading">
            <h2>Status</h2>
          </div>
          <p className="agent-control-desc">
            {agent.enabled
              ? "This agent is active and will process requests when triggered."
              : "This agent is disabled. Triggers will be skipped until it is re-enabled."}
          </p>
          <form action={toggleAgent}>
            <input name="id" type="hidden" value={agent.id} />
            <input name="enabled" type="hidden" value={agent.enabled ? "false" : "true"} />
            <button
              className={`button ${agent.enabled ? "button-secondary" : "button-primary"}`}
              type="submit"
            >
              {agent.enabled ? "Disable agent" : "Enable agent"}
            </button>
          </form>
        </section>

        {/* Settings editor */}
        <section className="panel agent-settings-panel">
          <details className="agent-settings-details">
            <summary className="panel-heading agent-settings-summary">
              <h2>Settings</h2>
            </summary>
          <p className="muted agent-settings-hint">
            Settings are stored as JSON. Changes take effect on the next task.
          </p>
          <form action={updateAgentSettings} className="agent-settings-form">
            <input name="id" type="hidden" value={agent.id} />
            <label className="agent-settings-label">
              <span>Configuration JSON</span>
              <textarea
                className="agent-settings-textarea"
                defaultValue={settingsJson}
                name="settings"
                rows={10}
                spellCheck={false}
              />
            </label>
            <button className="button button-primary" type="submit">Save settings</button>
          </form>
          {agent.slug === "creative" ? (
            <div className="agent-settings-reference">
              <p className="muted"><strong>Creative settings reference:</strong></p>
              <ul className="agent-settings-ref-list">
                <li><code>model</code> — Model ID for image generation (default: <code>gemini-3-pro-image</code>)</li>
                <li><code>genericInstructions</code> — Base enhancement instructions applied to every image. Omit to use the built-in default.</li>
              </ul>
              <p className="muted agent-settings-note">Requires an image-generation API key in the environment. Trigger &ldquo;Enhance&rdquo; from any image detail page. Results are queued for review — no original is modified until you choose &ldquo;Overwrite original&rdquo; or &ldquo;Keep as new&rdquo;.</p>
            </div>
          ) : agent.slug === "designer" ? (
            <div className="agent-settings-reference">
              <p className="muted"><strong>Designer settings reference:</strong></p>
              <ul className="agent-settings-ref-list">
                <li><code>model</code> — Claude model ID (default: <code>claude-opus-4-8</code>)</li>
                <li><code>maxOutputTokens</code> — Maximum output tokens (default: <code>12000</code>)</li>
              </ul>
            </div>
          ) : agent.slug === "editor" ? (
            <div className="agent-settings-reference">
              <p className="muted"><strong>Editor settings reference:</strong></p>
              <ul className="agent-settings-ref-list">
                <li><code>model</code> — Claude model ID (default: <code>claude-sonnet-4-5</code>)</li>
                <li><code>maxOutputTokens</code> — Maximum output tokens (default: <code>4000</code>)</li>
              </ul>
              <p className="muted agent-settings-note">Trigger a review from any submission or article detail page using the &ldquo;Review&rdquo; button.</p>
            </div>
          ) : agent.slug === "assistant" ? (
            <div className="agent-settings-reference">
              <p className="muted"><strong>Assistant settings reference:</strong></p>
              <ul className="agent-settings-ref-list">
                <li><code>registrationUrl</code> — URL sent in invite emails for users to register</li>
                <li><code>submissionInvite.enabled</code> — Queue drafts for new submissions (default: <code>true</code>)</li>
                <li><code>submissionInvite.subject</code> — Subject line. Supports: <code>{"{submitterName}"}</code>, <code>{"{publicationName}"}</code>, <code>{"{submissionTitle}"}</code></li>
                <li><code>submissionInvite.body</code> — Email body. Same variables plus <code>{"{registrationUrl}"}</code></li>
                <li><code>businessInvite.enabled</code> — Queue drafts for new businesses (default: <code>true</code>)</li>
                <li><code>businessInvite.subject</code> — Subject line. Supports: <code>{"{businessName}"}</code>, <code>{"{publicationName}"}</code></li>
                <li><code>businessInvite.body</code> — Email body. Same variables plus <code>{"{registrationUrl}"}</code></li>
              </ul>
              <p className="muted agent-settings-note">Email sending is not yet implemented. Drafts are queued here for review.</p>
            </div>
          ) : agent.slug === "marketer" ? (
            <div className="agent-settings-reference">
              <p className="muted"><strong>Marketer settings reference:</strong></p>
              <ul className="agent-settings-ref-list">
                <li><code>advertisingUrl</code> — Ad-submission page the Marketer points interested businesses to</li>
                <li><code>sponsoredArticle.enabled</code> — Allow sponsored article pitches (default: <code>true</code>)</li>
                <li><code>advertisement.enabled</code> — Allow advertisement pitches (default: <code>true</code>)</li>
              </ul>
              <p className="muted agent-settings-note">Pitches are written by Claude (<code>promotion.model</code>) for each business from its details and the publication&rsquo;s rates, and kept as drafts on the task until sent. Replies on Marketer threads are answered automatically by the same model. Configure sub agents below to enable email sending.</p>
              <p className="muted"><strong>Advertiser review &amp; promotion (&ldquo;Submit for Review&rdquo; on ads and articles):</strong></p>
              <ul className="agent-settings-ref-list">
                <li><code>promotion.model</code> — Claude model ID for the emails and replies (default: <code>{DEFAULT_PROMOTION_MODEL}</code>)</li>
                <li><code>promotion.followUpDays</code> — Days without a reply before one follow-up is sent; <code>0</code> disables it (default: <code>{DEFAULT_PROMOTION_FOLLOW_UP_DAYS}</code>)</li>
                <li><code>advertisingUrl</code> — Also given to advertisers who want to submit new ad materials</li>
              </ul>
              <p className="muted"><strong>Promote (sales campaigns from the Businesses page):</strong></p>
              <ul className="agent-settings-ref-list">
                <li><code>promotion.maxDiscountPercent</code> — Largest bundle discount the Marketer may give on an order, in percent; <code>0</code> disables discounts (default: <code>{DEFAULT_MAX_DISCOUNT_PERCENT}</code>, capped at 50)</li>
              </ul>
              <p className="muted agent-settings-note">The Marketer sells the issue&rsquo;s ads and sponsored articles (and placements in the publication&rsquo;s other upcoming issues) using the same model and follow-up timing. Individual prices stay firm unless the campaign&rsquo;s custom instructions allow a discount; bundles of two or more placements may be discounted up to the cap, which the server enforces. When the business agrees to buy, the purchased placements are created as draft ads and articles at the agreed prices.</p>
              <p className="muted agent-settings-note">Prices come from each publication&rsquo;s <strong>Promotion rates</strong> (on the publication page); a publication without rates gets no price quotes. The first sub agent with SMTP configured handles new advertisers (a business keeps the sub agent it already talks to). Replies are read from its IMAP inbox and answered automatically. A sign-up is a written confirmation by email; no payment is collected.</p>
            </div>
          ) : null}
          </details>
        </section>
      </div>

      {/* Sub agents (assistant and marketer) */}
      {agent.slug === "assistant" || agent.slug === "marketer" ? (
        <SubAgentList agentId={agent.id} initialSubAgents={serializedSubAgents} initialTotal={subAgentTotal} />
      ) : null}
    </>
  );
}
