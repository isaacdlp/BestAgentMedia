import "server-only";
import { getSubAgentConfig } from "@/lib/sub-agent-email";
import { pollSubAgentInbox } from "@/lib/imap-poller";
import { prisma } from "@/lib/db";

const POLL_INTERVAL_MS = 60_000;

let started = false;

export function startInboxPolling(): void {
  if (started) return;
  started = true;

  async function poll(): Promise<void> {
    try {
      const subAgents = await prisma.subAgent.findMany({
        select: { id: true, name: true, config: true },
      });

      for (const subAgent of subAgents) {
        const config = getSubAgentConfig(subAgent.config);
        if (!config.imapHost || !config.imapUser || !config.imapPassword) continue;
        try {
          const result = await pollSubAgentInbox(subAgent.id);
          if (result.processed > 0 || result.errors.length > 0) {
            console.log(
              `[InboxScheduler] ${subAgent.name} (id=${subAgent.id}): ` +
              `${result.processed} processed, ${result.errors.length} error(s)`,
            );
            if (result.errors.length > 0) {
              result.errors.forEach((e) => console.error(`[InboxScheduler] error:`, e));
            }
          }
        } catch (err) {
          console.error(`[InboxScheduler] poll failed for sub-agent ${subAgent.name}:`, err);
        }
      }
    } catch (err) {
      console.error("[InboxScheduler] failed to fetch sub-agents:", err);
    }

    setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }

  // Delay first poll slightly to let the server finish starting up
  setTimeout(() => void poll(), 5_000);
  console.log(`[InboxScheduler] Background inbox polling started (interval: ${POLL_INTERVAL_MS / 1000}s)`);
}
