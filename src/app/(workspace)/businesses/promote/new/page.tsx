import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { AgentBadge } from "@/components/agent-badge";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MAX_PROMOTION_INSTRUCTIONS } from "@/lib/promotion-deals";
import { DEFAULT_MAX_DISCOUNT_PERCENT, getPromotionSettings } from "@/lib/promotion-packages";
import { promotableIssueWhere } from "@/lib/promotion-sales";
import { PromoteForm, type PromoteIssueOption } from "./promote-form";

export default async function NewPromotionPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) redirect("/businesses");

  // Opened from a business page: only issues of publications serving its ZIP code, business preselected.
  const { business: businessParam } = await searchParams;
  const business =
    businessParam && /^[1-9]\d*$/.test(businessParam)
      ? await prisma.business.findUnique({
          where: { id: Number(businessParam) },
          select: { id: true, name: true, postalCode: true },
        })
      : null;

  const [issues, marketer] = await Promise.all([
    prisma.issue.findMany({
      where: {
        ...promotableIssueWhere(),
        ...(business ? { publication: { zipCodes: { some: { code: business.postalCode ?? "" } } } } : {}),
      },
      orderBy: [{ publicationDate: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        publicationDate: true,
        publication: {
          select: { name: true, _count: { select: { zipCodes: true, promotionPackages: true } } },
        },
      },
    }),
    prisma.agent.findUnique({ where: { slug: "marketer" }, select: { enabled: true, settings: true } }),
  ]);

  const options: PromoteIssueOption[] = issues.map((issue) => ({
    id: issue.id,
    label: `${issue.publication.name} · ${issue.name} · ${issue.publicationDate.toISOString().slice(0, 10)}`,
    zipCount: issue.publication._count.zipCodes,
    hasRates: issue.publication._count.promotionPackages > 0,
  }));
  const maxDiscount = marketer ? getPromotionSettings(marketer.settings).maxDiscountPercent : DEFAULT_MAX_DISCOUNT_PERCENT;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow"><Link href={business ? `/businesses/${business.id}` : "/businesses"}>← {business ? business.name : "Businesses"}</Link></p>
          <h1>Promote an issue</h1>
          <p className="muted">
            Choose an issue, then the businesses in its publication&rsquo;s ZIP codes. The Marketer emails each one to sell
            ads and sponsored articles, negotiates, and creates the purchased drafts.
          </p>
        </div>
        <AgentBadge agentSlug="marketer" />
      </div>
      {!marketer?.enabled ? (
        <p className="form-error">The Marketer agent is disabled. Enable it in the Agents section to promote issues.</p>
      ) : null}
      <PromoteForm
        issues={options}
        maxDiscountPercent={maxDiscount}
        maxInstructions={MAX_PROMOTION_INSTRUCTIONS}
        preselectedBusinessId={business?.id ?? null}
      />
    </>
  );
}
