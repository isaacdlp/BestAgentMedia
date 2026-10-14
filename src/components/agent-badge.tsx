"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DirectoryAgent = {
  id: number;
  slug: string;
  role: string;
  name: string;
  pictureUrl: string | null;
  subAgents: { id: number; name: string; pictureUrl: string | null }[];
};

let directoryPromise: Promise<DirectoryAgent[]> | null = null;

function loadDirectory() {
  directoryPromise ??= fetch("/api/agents/directory")
    .then(async (res) => {
      if (!res.ok) throw new Error("Agents could not be loaded.");
      return ((await res.json()) as { agents: DirectoryAgent[] }).agents;
    })
    .catch((err) => {
      directoryPromise = null;
      throw err;
    });
  return directoryPromise;
}

/**
 * The agent (or sub-agent) that will run a task: its picture and name. Clicking it opens the
 * task list filtered to that agent. Shown on every task creation screen.
 */
export function AgentBadge({ agentSlug, subAgentId }: { agentSlug: string; subAgentId?: number }) {
  const [agents, setAgents] = useState<DirectoryAgent[] | null>(null);

  useEffect(() => {
    let active = true;
    loadDirectory()
      .then((list) => {
        if (active) setAgents(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const agent = agents?.find((item) => item.slug === agentSlug);
  if (!agent) return null;
  const sub = subAgentId ? agent.subAgents.find((item) => item.id === subAgentId) : undefined;

  const name = sub?.name ?? agent.name;
  const pictureUrl = sub ? sub.pictureUrl : agent.pictureUrl;
  const href = sub ? `/tasks?agent=${agent.id}&subAgent=${sub.id}` : `/tasks?agent=${agent.id}`;
  const subtitle = sub ? `${agent.role} agent` : name === agent.role ? "Agent" : `${agent.role} agent`;

  return (
    <Link className="agent-badge" href={href} title={`See tasks run by ${name}`}>
      {pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="agent-badge-picture" src={pictureUrl} />
      ) : (
        <span aria-hidden="true" className="agent-badge-picture agent-badge-placeholder">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="agent-badge-text">
        <span className="agent-badge-name">{name}</span>
        <span className="agent-badge-role muted">{subtitle}</span>
      </span>
    </Link>
  );
}
