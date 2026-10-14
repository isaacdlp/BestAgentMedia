import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { toggleAgent, updateAgentSettings } from "@/app/actions/agents";
import type { AgentTaskSummary } from "@/components/agent-task-list";
import { AgentTaskList } from "@/components/agent-task-list";
import type { SubAgentSummary } from "@/components/sub-agent-list";
import { SubAgentList } from "@/components/sub-agent-list";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
      updatedAt: true,
    },
  });
  if (!agent) notFound();

  const [{ tasks, taskTotal }, { sas: subAgents, saTotal: subAgentTotal }] = await Promise.all([
    Promise.all([
      prisma.agentTask.findMany({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          label: true,
          steps: true,
          result: true,
          error: true,
          issueId: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          triggeredBy: { select: { name: true, surname: true } },
        },
      }),
      prisma.agentTask.count({ where: { agentId: agent.id } }),
    ]).then(([tasks, taskTotal]) => ({ tasks, taskTotal })),
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
  const serializedTasks = JSON.parse(JSON.stringify(tasks)) as AgentTaskSummary[];
  const initialTaskTotal = taskTotal;
  const serializedSubAgents = JSON.parse(JSON.stringify(subAgents)) as SubAgentSummary[];

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">AGENTS</p>
          <h1>{agent.name}</h1>
          <p className="muted">{agent.description}</p>
        </div>
        <span className={`role-pill ${agent.enabled ? "" : "role-pill-muted"}`}>
          {agent.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      <div className="agent-detail-grid">
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
                <li><code>advertisingUrl</code> — URL included in pitch emails linking to your ad submission page</li>
                <li><code>sponsoredArticle.enabled</code> — Allow sponsored article pitches (default: <code>true</code>)</li>
                <li><code>sponsoredArticle.subject</code> — Subject line. Supports: <code>{"{businessName}"}</code>, <code>{"{publicationName}"}</code></li>
                <li><code>sponsoredArticle.body</code> — Email body. Same variables plus <code>{"{agentName}"}</code>, <code>{"{advertisingUrl}"}</code></li>
                <li><code>advertisement.enabled</code> — Allow advertisement pitches (default: <code>true</code>)</li>
                <li><code>advertisement.subject</code> — Subject line. Same variables as above</li>
                <li><code>advertisement.body</code> — Email body. Same variables as above</li>
              </ul>
              <p className="muted agent-settings-note">Pitches are drafted from the business detail page. Configure sub agents below to enable email sending.</p>
            </div>
          ) : null}
          </details>
        </section>
      </div>

      {/* Sub agents (assistant and marketer) */}
      {agent.slug === "assistant" || agent.slug === "marketer" ? (
        <SubAgentList agentId={agent.id} initialSubAgents={serializedSubAgents} initialTotal={subAgentTotal} />
      ) : null}

      {/* Task list */}
      <AgentTaskList
        agentId={agent.id}
        initialTasks={serializedTasks}
        initialTotal={initialTaskTotal}
        subAgents={serializedSubAgents.map((sa) => ({ id: sa.id, name: sa.name }))}
        emptyMessage={
          agent.slug === "creative"
            ? "No enhancements yet. Open any image detail page and use the \"Enhance\" button to start one."
            : agent.slug === "designer"
              ? "No tasks yet. Use \"Generate Layout\" on an issue to start one."
              : agent.slug === "assistant"
                ? "No drafts yet. Submit a story or add a business to trigger the first invite draft."
                : agent.slug === "editor"
                  ? "No reviews yet. Use the \"Review\" button on a submission or article to start one."
                  : agent.slug === "marketer"
                    ? "No pitches yet. Use the \"Pitch\" button on a business detail page to draft one."
                    : undefined
        }
      />
    </>
  );
}
