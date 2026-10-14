export async function register() {
  // Only start the background scheduler in the Node.js runtime, not the Edge runtime
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startInboxPolling } = await import("@/lib/inbox-scheduler");
    startInboxPolling();
  }
}
