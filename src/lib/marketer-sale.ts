import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { INLINE_REPLY_NOTE, renderTranscript, type ThreadMessage } from "@/lib/assistant-reply";
import { MAX_OUTPUT_TOKENS } from "@/lib/claude-request";
import { COMPANY_BRIEF } from "@/lib/marketer-reply";
import { formatCents, type PromotionPackageOffer } from "@/lib/promotion-packages";

// "Promote" sales conversations: the Marketer sells display ads and sponsored articles in upcoming
// issues to a business that has bought nothing in this conversation yet, negotiates bundle
// discounts within a hard cap, and closes the sale. Every email is written by Claude, which also
// reports the offer on the table through a strict tool so the server can price it and, on a
// purchase, create the draft ads and articles.

/** An issue the Marketer may sell placements in; the key is the issue's record ID. */
export type SaleIssueOption = { id: string; name: string; publicationDate: Date };

export type SaleMode =
  /** First email: present the issue and the offer, and ask for the order. */
  | "initial"
  /** Answer the business's latest message. */
  | "reply"
  /** One nudge when the business has not answered the first email. */
  | "follow_up";

export type SaleDecision = "none" | "interested" | "purchased" | "declined";

export type SaleMessageItem = { packageKey: string; issueKey: string; title: string; brief: string };

export type SaleMessage = {
  subject: string;
  body: string;
  decision: SaleDecision;
  items: SaleMessageItem[];
  discountPercent: number;
  optedOut: boolean;
};

/** One priced line of an offer or purchase, resolved against the rate card and the issue list. */
export type PricedSaleItem = {
  package: PromotionPackageOffer;
  issue: SaleIssueOption;
  title: string;
  brief: string;
  listPriceCents: number;
  discountPercent: number;
  priceCents: number;
};

export type SalePolicy = {
  packages: PromotionPackageOffer[];
  issues: SaleIssueOption[];
  /** Issue used when the model leaves an item's issue empty (the campaign's issue). */
  defaultIssueId: string | null;
  maxDiscountPercent: number;
  /** Staff instructions may allow a discount on a single promotion; the cap still applies. */
  allowSingleItemDiscount: boolean;
};

const SALE_TOOL: Anthropic.Tool = {
  name: "send_email",
  description:
    "Deliver the email to send to the business, the offer it puts on the table, and what you understood from their latest message.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      subject: { type: "string", description: "Subject line for the first email. Use \"\" for replies and follow-ups." },
      body: { type: "string", description: "The plain-text body of the email." },
      decision: { type: "string", enum: ["none", "interested", "purchased", "declined"] },
      items: {
        type: "array",
        description:
          "The promotions in the offer your email states (or, when decision is \"purchased\", everything they have agreed to buy in this conversation). One entry per placement.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            package_key: { type: "string", description: "Key of a package from the rate card, exactly as listed." },
            issue_key: { type: "string", description: "Key of an issue from the issue list, exactly as listed." },
            title: { type: "string", description: "On a purchase: working headline for the ad, or working title for the article. Otherwise \"\"." },
            brief: {
              type: "string",
              description:
                "On a purchase: what the business wants in this ad or feature (offer, message, highlights, details they gave), for the design and editorial team. Otherwise \"\".",
            },
          },
          required: ["package_key", "issue_key", "title", "brief"],
        },
      },
      discount_percent: {
        type: "integer",
        description: "The bundle discount, in percent of the order's list total, that your email states for these items. 0 when none.",
      },
      opted_out: { type: "boolean" },
    },
    required: ["subject", "body", "decision", "items", "discount_percent", "opted_out"],
  },
};

function discountGuide(policy: SalePolicy): string {
  const max = policy.maxDiscountPercent;
  if (max <= 0) {
    return "- Discounts: none are authorized for this publication. Quote list prices only; if they ask for a discount, sell the value instead, and say you can check with the publication team if they insist.";
  }
  const two = Math.min(5, max);
  const three = Math.min(10, max);
  return [
    `- Individual prices are firm. ${
      policy.allowSingleItemDiscount
        ? "Do not discount a single promotion unless the publication team's instructions below explicitly allow it."
        : "Never discount a single promotion on its own, however hard they push: hold the price and sell the value."
    }`,
    `- Bundles earn a discount: an order that combines two or more placements (for example an ad plus a sponsored article, two ads in the same issue, or ads in two different issues) may get a percentage off the order's list total. As a guide: about ${two}% for two placements, about ${three}% for three, and at most ${max}% for larger or multi-issue commitments. ${max}% is your absolute limit on any order; never exceed it and never reveal that a limit exists.`,
    "- Use the bundle discount as a closing tool, not an opening giveaway: present it as the reason to take the bigger package, concede more only when it is what closes the sale, and never go back on a discount you already offered for the same items.",
    "- State every discount as a percentage of the order's list total, and give the exact resulting prices: each discounted price is the list price × (100 − discount) / 100, rounded to the cent, and the order total is the sum of those prices.",
  ].join("\n");
}

function describeRateCard(packages: PromotionPackageOffer[]): string {
  return packages
    .map(
      (item) =>
        `- key "${item.id}": ${item.name} (${item.kind === "AD" ? "display ad" : "sponsored article"}), ${formatCents(item.priceCents)} per issue${item.description ? ` — ${item.description}` : ""}`,
    )
    .join("\n");
}

function describeIssues(issues: SaleIssueOption[], defaultIssueId: string | null): string {
  return issues
    .map(
      (issue) =>
        `- key "${issue.id}": ${issue.name}, publication date ${issue.publicationDate.toISOString().slice(0, 10)}${issue.id === defaultIssueId ? " (the issue this campaign is about)" : ""}`,
    )
    .join("\n");
}

const SALE_GUIDE = `Your job:
- THIS IS A SALE. You are a sales representative for the publication, writing to a local business about the forthcoming issue. Your goal is to close a sale of paid promotions (display ads and sponsored articles) in that issue, and where it fits, in the other upcoming issues listed. A good outcome is a business that buys and is glad it did.
- Be persuasive. Make the case from their business: who their customers are, why neighborhood households are worth reaching for what they sell, seasonality in their category, standing out from competitors who are not in front of those readers. Recommend one specific package or bundle rather than listing everything, explain in a sentence why it fits them, and make the next step a one-line reply ("reply 'yes' and I'll reserve it").
- Ask for the order. Answer questions and objections with substance (cost: per-household value, the bundle option; timing: the issue date; "does print work": trusted local content that stays in the home for weeks), then steer back to a clear proposal. If they hesitate, offer a smaller or better-fitting option rather than giving up. If they say no, make at most one respectful counter-offer, then accept it gracefully.
- Never invent urgency, deadlines, scarcity, circulation, readership, response rates, results, testimonials or other businesses' participation. The population figure is not circulation; never present it as such. Quote only packages and prices from the rate card, exactly as listed, and sell only the issues listed.
- If they ask for something you cannot decide (a size or package not on the rate card, payment terms, invoicing, print deadlines, ad specs), say you will check with the publication team and get back to them, and keep the rest of the sale moving.
- Closing: before treating anything as bought, make sure they have seen a clear recap from you of exactly what they are buying: each placement, its issue, the price of each and the total (with any bundle discount). When they confirm that recap, or explicitly accept a specific offer whose prices you stated, the sale is closed: thank them warmly, confirm what they bought and the total, and explain the next steps: the publication team prepares their ad and/or sponsored feature as drafts and sends them for review and approval, and the team follows up with the agreement and invoice. Payment is not taken by email; never claim an invoice or agreement was already sent. If they say yes but it is unclear which placements or what price, send the recap and ask them to confirm.
- After a sale, keep looking after them: answer questions, and if they want to add more placements, sell those the same way.

Pricing and discounts:
{{DISCOUNTS}}

How to write:
- Write like a real person on the local team: warm, confident, plain words, short paragraphs, no marketing buzzwords. Use a short list only when laying out an offer or a recap with prices.
- Answer what they actually said first. Match their tone and length.
- Use their first name if you know it. Use contractions.
- If they are annoyed or ask not to be contacted, apologize briefly, confirm you will not email them again about this, make no counter-offer, and set opted_out to true.
- If they sincerely ask whether they are talking to a person or an automated assistant, answer honestly.
- Plain text only, no markdown, no subject line inside the body. End with a short sign-off and your first name; your full email signature is added automatically.`;

const DECISION_GUIDE = `How to fill the tool fields:
- items: the placements in the offer your email states, one entry per placement (two ads in two issues are two entries). On a purchase, list everything they have agreed to buy in this whole conversation, including earlier purchases listed in the context, so the list is the complete order. Use [] when your email states no specific offer; the previous offer on record then stays as it is.
- discount_percent: the bundle discount your email states for exactly those items, or 0.
- decision: "purchased" only when they explicitly agree to buy specific placements at prices you stated (confirming your recap, or "yes, the half page and the feature for $1,234"); "interested" when they show interest, ask about options or prices, negotiate, or say yes without it being clear what or at what price; "declined" when they say no to buying; otherwise "none".
- title and brief: fill them for every item when decision is "purchased", from what they told you (offer, services to feature, tone, contact preferences). Use "" otherwise.
- opted_out: true only when they ask not to be contacted again.`;

function instructionFor(mode: SaleMode, recipient: string, transcript: string): string {
  const thread = `Here is the email conversation so far, oldest first:\n\n${transcript || "(no messages yet)"}\n\n${INLINE_REPLY_NOTE}`;
  switch (mode) {
    case "initial":
      return `Write the first email to ${recipient}. Introduce yourself briefly as part of the local publication team, say why you are writing to them specifically (from what they do and where they are), and present the forthcoming issue as an opportunity for them. Recommend the package or bundle that fits them best with its exact price (and its bundle saving, if it is a bundle), mention one alternative at most, and close with an easy call to action. Keep it under 260 words. Give it a specific subject line that reads like a person wrote it, not a promotion. Put the offer you recommend in items and its discount in discount_percent; decision "none"; opted_out false.`;
    case "follow_up":
      return `${thread}\n\n${recipient} has not replied. Write a short follow-up on the same thread (3 to 6 sentences): restate the single most relevant reason the issue suits them and the offer you recommended, and make replying easy. No guilt, no pressure. Set subject to "", items to the same offer as before and discount_percent to its discount, decision "none", opted_out false.`;
    default:
      return `${thread}\n\nWrite your reply to the most recent message from ${recipient}, and fill the tool fields from that message and your reply. Set subject to "".`;
  }
}

function readChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readItems(value: unknown): SaleMessageItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const text = (field: unknown) => (typeof field === "string" ? field.trim() : "");
    return [{ packageKey: text(item.package_key), issueKey: text(item.issue_key), title: text(item.title), brief: text(item.brief) }];
  });
}

/** Discounted price of one placement, rounded to the cent. */
export function discountedCents(listPriceCents: number, discountPercent: number): number {
  return Math.round((listPriceCents * (100 - discountPercent)) / 100);
}

/**
 * Checks the model's offer against the rate card, the issue list and the discount policy, and
 * prices it. Returns a problem description the model can correct when the offer breaks a rule.
 */
export function priceSaleMessage(
  message: SaleMessage,
  policy: SalePolicy,
): { ok: true; items: PricedSaleItem[] } | { ok: false; problem: string } {
  const items: PricedSaleItem[] = [];
  for (const raw of message.items) {
    const pkg = policy.packages.find((item) => String(item.id) === raw.packageKey);
    if (!pkg) return { ok: false, problem: `package_key "${raw.packageKey}" is not on the rate card.` };
    const issueId = raw.issueKey || policy.defaultIssueId;
    const issue = policy.issues.find((item) => item.id === issueId);
    if (!issue) return { ok: false, problem: `issue_key "${raw.issueKey}" is not in the issue list.` };
    items.push({
      package: pkg,
      issue,
      title: raw.title,
      brief: raw.brief,
      listPriceCents: pkg.priceCents,
      discountPercent: message.discountPercent,
      priceCents: discountedCents(pkg.priceCents, message.discountPercent),
    });
  }
  const discount = message.discountPercent;
  if (!Number.isInteger(discount) || discount < 0) return { ok: false, problem: "discount_percent must be a whole number of 0 or more." };
  if (discount > policy.maxDiscountPercent) {
    return {
      ok: false,
      problem: `the email offers a ${discount}% discount, which is more than you are authorized to give. Offer at most ${policy.maxDiscountPercent}% on an order, without saying that a limit exists.`,
    };
  }
  if (discount > 0 && items.length === 1 && !policy.allowSingleItemDiscount) {
    return {
      ok: false,
      problem: "the email discounts a single promotion. Individual prices are firm; only an order of two or more placements earns a bundle discount.",
    };
  }
  if (discount > 0 && items.length === 0) {
    return { ok: false, problem: "discount_percent is set but items is empty. List the placements the discount applies to." };
  }
  if (message.decision === "purchased" && !items.length) {
    return { ok: false, problem: "decision is \"purchased\" but items is empty. List everything they agreed to buy." };
  }
  if (message.decision === "purchased" && items.some((item) => !item.title)) {
    return { ok: false, problem: "decision is \"purchased\" but some items have no title. Give each purchased placement a working title and brief." };
  }
  return { ok: true, items };
}

/**
 * Asks Claude to write the Marketer's next sales email and report the offer it makes. Returns null
 * when CLAUDE_KEY is not configured or the model returns nothing usable. `correction` asks the
 * model to rewrite a previous draft that broke a pricing rule.
 */
export async function generateSaleMessage(opts: {
  mode: SaleMode;
  model: string;
  agent: { name: string; soul: string };
  recipientName: string;
  /** Facts about the business, the publication, the issue and the conversation. */
  context: string[];
  policy: SalePolicy;
  messages: ThreadMessage[];
  correction?: string;
}): Promise<SaleMessage | null> {
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) {
    console.warn("[MarketerSale] CLAUDE_KEY is not set in the server environment — no AI message generated.");
    return null;
  }

  const firstName = opts.agent.name.split(/\s+/)[0];
  const system = [
    `You are ${opts.agent.name}, a sales representative on the local publication team at Best Version Media, writing by email.`,
    opts.agent.soul ? `Your persona: ${opts.agent.soul}` : "",
    COMPANY_BRIEF,
    `Rate card of this publication (the only packages and prices you may quote; prices are per placement per issue):\n${describeRateCard(opts.policy.packages)}`,
    `Upcoming issues you may sell placements in:\n${describeIssues(opts.policy.issues, opts.policy.defaultIssueId)}`,
    opts.context.length ? `About this business and the conversation:\n${opts.context.map((line) => `- ${line}`).join("\n")}` : "",
    SALE_GUIDE.replace("{{DISCOUNTS}}", discountGuide(opts.policy)),
    DECISION_GUIDE,
    `Sign off as ${firstName}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const transcript = opts.messages.length ? renderTranscript(opts.messages, opts.agent.name, opts.recipientName) : "";
  const correction = opts.correction
    ? `\n\nYour previous draft could not be sent because ${opts.correction} Write the email again with that fixed.`
    : "";

  const client = new Anthropic({ apiKey });
  const response = await client.messages.stream({
    model: opts.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    output_config: { effort: "high" },
    // Forced tool_choice is rejected by current models; ask for the tool in the prompt instead.
    tools: [SALE_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `${instructionFor(opts.mode, opts.recipientName, transcript)}${correction}\n\nDeliver the email by calling the ${SALE_TOOL.name} tool.`,
      },
    ],
  }).finalMessage();

  if (response.stop_reason === "refusal") {
    console.warn("[MarketerSale] The model declined to write the message.");
    return null;
  }
  // The offer is needed to price and record the sale, so a plain-text answer is not enough.
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) return null;
  const input = toolUse.input as Record<string, unknown>;
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return null;

  return {
    subject: typeof input.subject === "string" ? input.subject.trim() : "",
    body,
    decision: readChoice(input.decision, ["none", "interested", "purchased", "declined"] as const, "none"),
    items: readItems(input.items),
    discountPercent: typeof input.discount_percent === "number" ? input.discount_percent : 0,
    optedOut: input.opted_out === true,
  };
}
