import Anthropic from "@anthropic-ai/sdk";
const src = (await import("node:fs")).readFileSync("src/lib/assistant-reply.ts", "utf8").replace('import "server-only";', "");
(await import("node:fs")).writeFileSync("scripts-tmp-ar.ts", src);
const { generateAssistantReply } = await import("./scripts-tmp-ar.ts");
const now = new Date();
const r = await generateAssistantReply({
  agent: { name: "Sophie Bennett", soul: "Warm, practical community liaison." },
  recipientName: "Tia's Waterfront",
  messages: [
    { direction: "OUTBOUND", bodyText: "Hello,\n\nWe've listed Tia's Waterfront in our local directory for MetroWest Living. Claim it here: http://localhost:3000/register?claim=x", sentAt: now, receivedAt: null, createdAt: now },
    { direction: "INBOUND", bodyText: "Is this going to cost me money?", sentAt: null, receivedAt: now, createdAt: now },
  ],
  context: ["Their personal claim link: http://localhost:3000/register?claim=x", "They have not claimed the listing yet."],
});
console.log(r);
