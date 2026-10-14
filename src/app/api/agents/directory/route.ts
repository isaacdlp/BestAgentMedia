import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Public identity (name and picture) of every agent and sub-agent, for the agent badge shown on
 * task creation screens. Contains no configuration or credentials, so any signed-in user may read it.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const agents = await prisma.agent.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      personaName: true,
      picturePath: true,
      subAgents: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, picturePath: true },
      },
    },
  });

  return NextResponse.json({
    agents: agents.map((agent) => ({
      id: agent.id,
      slug: agent.slug,
      role: agent.name,
      name: agent.personaName || agent.name,
      pictureUrl: agent.picturePath
        ? `/api/agents/${agent.id}/picture?v=${encodeURIComponent(agent.picturePath)}`
        : null,
      subAgents: agent.subAgents.map((sub) => ({
        id: sub.id,
        name: sub.name,
        pictureUrl: sub.picturePath
          ? `/api/agents/${agent.id}/sub-agents/${sub.id}/picture?v=${encodeURIComponent(sub.picturePath)}`
          : null,
      })),
    })),
  });
}
