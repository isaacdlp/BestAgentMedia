import "server-only";
import { launchAgentTask, step } from "@/lib/agent-task-runner";
import { draftContributorEmail } from "@/lib/contributor-email";
import { prisma } from "@/lib/db";

const maxPriorSubmissions = 10;

/**
 * Called after a new ContentSubmission is created. Launches an Assistant Task in which Claude
 * writes a personal invitation email to the submitter, using the new submission and the sender's
 * earlier submissions (matched by email address). The draft is queued for review — nothing is
 * sent. Swallows all errors so the caller's response is never affected.
 */
export async function triggerSubmissionInvite(submissionId: string): Promise<void> {
  try {
    const agent = await prisma.agent.findUnique({
      where: { slug: "assistant" },
      select: { id: true, enabled: true, settings: true },
    });
    if (!agent?.enabled) return;

    const settings = (agent.settings as Record<string, unknown>) ?? {};
    const inviteSettings = (settings.submissionInvite as Record<string, unknown> | undefined) ?? {};
    if (inviteSettings.enabled === false) return;

    const submission = await prisma.contentSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        title: true,
        body: true,
        storyType: true,
        submitterName: true,
        submitterEmail: true,
        submittedByUserId: true,
        publication: { select: { name: true } },
        business: { select: { name: true } },
        _count: { select: { images: true } },
      },
    });
    const submitterEmail = submission?.submitterEmail;
    if (!submission || !submitterEmail) return;

    const [priorSubmissions, existingAccount] = await Promise.all([
      prisma.contentSubmission.findMany({
        where: { id: { not: submission.id }, submitterEmail: { equals: submitterEmail, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        take: maxPriorSubmissions,
        select: {
          title: true,
          body: true,
          storyType: true,
          status: true,
          createdAt: true,
          publication: { select: { name: true } },
          article: { select: { status: true } },
        },
      }),
      submission.submittedByUserId
        ? Promise.resolve(true)
        : prisma.user
            .findFirst({ where: { email: { equals: submitterEmail, mode: "insensitive" } }, select: { id: true } })
            .then(Boolean),
    ]);

    const registrationUrl = typeof settings.registrationUrl === "string" ? settings.registrationUrl.trim() : "";
    const inviteToRegister = !existingAccount && registrationUrl !== "";
    const model = typeof inviteSettings.model === "string" ? inviteSettings.model : "claude-haiku-5-5";
    const guidance = typeof inviteSettings.instructions === "string" ? inviteSettings.instructions.trim() : "";

    await launchAgentTask({
      agentId: agent.id,
      label: `Submission invite — ${submission.submitterName ?? submitterEmail} · ${submission.publication.name}`,
      subject: { type: "submission", id: submission.id },
      steps: [
        step("info", `Trigger: new submission "${submission.title}" (id: ${submission.id})`),
        step("info", `Recipient: ${submitterEmail} (${submission.submitterName ?? "unknown"})`),
        step("info", `Publication: ${submission.publication.name}`),
        step(
          "info",
          priorSubmissions.length
            ? `Returning contributor: ${priorSubmissions.length} earlier submission(s) from this sender shared with the Assistant`
            : "First submission from this sender",
        ),
        step(
          "info",
          existingAccount
            ? "Sender already has an account — no registration link"
            : inviteToRegister
              ? "Sender has no account — inviting them to register"
              : "No registrationUrl configured — the email will not include a registration link",
        ),
      ],
      work: async ({ log }) => {
        const apiKey = process.env.CLAUDE_KEY;
        if (!apiKey) {
          throw new Error("Invitation drafting is not configured (missing CLAUDE_KEY) — no email was drafted.");
        }

        const history = priorSubmissions
          .map((prior) => {
            const outcome = prior.article
              ? `became an article (${prior.article.status.toLowerCase()})`
              : `status: ${prior.status.toLowerCase().replace(/_/g, " ")}`;
            const excerpt = prior.body.replace(/\s+/g, " ").slice(0, 300);
            const date = prior.createdAt.toISOString().slice(0, 10);
            return `- "${prior.title}" (${prior.storyType ?? "story"}, ${prior.publication.name}, ${date}, ${outcome}): ${excerpt}${prior.body.length > 300 ? "…" : ""}`;
          })
          .join("\n");
        const accountGuidance = existingAccount
          ? "They already have an account with us, so do not invite them to register; they can sign in to follow their submissions."
          : inviteToRegister
            ? `Invite them to create a free account to follow their submission's progress and hear from the editorial team. Include this link on its own line, exactly: ${registrationUrl}`
            : "Do not mention creating an account or include any links.";

        log("info", `Calling ${model} to write the invitation email`);
        const draft = await draftContributorEmail({
          apiKey,
          model,
          requiredLink: inviteToRegister ? registrationUrl : undefined,
          prompt: `Write a short thank-you email to ${submission.submitterName ?? "a resident"}, who just submitted a community story to ${submission.publication.name}.

Their new submission:
Title: ${submission.title}
Story type: ${submission.storyType ?? "unspecified"}${submission.business ? `\nAbout the local business: ${submission.business.name}` : ""}
Photos attached: ${submission._count.images}
Story:
${submission.body}

${history ? `Their earlier submissions to our publications (most recent first; internal records):\n${history}` : "This is the first story they have sent us."}

${accountGuidance}
${guidance ? `\nGuidance from the editorial team for these emails (follow it):\n${guidance}\n` : ""}
Guidance:
- Show you actually read the story: mention something specific from it.
- If they have sent stories before, welcome them back and refer naturally to their earlier contributions (for example by topic), and thank them for being a regular voice in the community. Never mention internal statuses, declined stories or review outcomes; you may say a story was published only if it became a published article.
- Explain briefly that the editorial team reviews every story and may get in touch if they need anything. Do not promise publication or a date.
- Warm, natural and brief (under 170 words), like a real person from the local publication team. No form-letter phrases.
- Plain text. Sign off with a short closing; the sender's name and signature are added automatically.`,
        });
        if (draft.revisedForLink) log("info", "First draft omitted the registration link — the model revised it");
        log("success", "Invitation drafted — queued for review, not sent yet");

        return {
          trigger: "submission",
          referenceId: submission.id,
          referenceTitle: submission.title,
          emailTo: submitterEmail,
          emailSubject: draft.subject,
          bodyPreview: draft.body,
          priorSubmissionCount: priorSubmissions.length,
          existingAccount,
          status: "draft",
        };
      },
    });
  } catch (err) {
    // Must not surface errors to the caller — this is a background side-effect
    console.error("[AssistantAgent] triggerSubmissionInvite failed for submission", submissionId, err);
  }
}

