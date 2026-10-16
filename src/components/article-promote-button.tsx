"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AgentBadge } from "@/components/agent-badge";
import { useTaskLauncher } from "@/components/use-task-launcher";

export type ArticlePromoteIssueOption = { id: string; label: string; hasRates: boolean; slated: boolean };

const SUGGESTIONS = [
  "Pair the feature with a quarter-page ad",
  "Mention we can adjust the article with their input",
  "Push the multi-issue bundle",
];

/**
 * "Promote" on an article page: a dialog to choose the issue and give the Marketer instructions,
 * then a sales conversation that tries to sign the article's business up for the article as a paid
 * sponsored feature. `disabledReason` disables the button and explains why on hover.
 */
export function ArticlePromoteButton({
  articleId,
  businessName,
  issues,
  maxInstructions,
  disabledReason,
}: {
  articleId: string;
  businessName: string | null;
  issues: ArticlePromoteIssueOption[];
  maxInstructions: number;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const { launch, starting, error } = useTaskLauncher();
  const [open, setOpen] = useState(false);
  const [issueId, setIssueId] = useState(() => (issues.find((item) => item.slated && item.hasRates) ?? issues.find((item) => item.hasRates))?.id ?? "");
  const [instructions, setInstructions] = useState("");
  const issue = issues.find((item) => item.id === issueId) ?? null;

  async function handleStart() {
    if (!issue?.hasRates) return;
    if (await launch(`/api/articles/${articleId}/promote`, { issueId, instructions })) {
      setInstructions("");
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button
        className="button button-primary"
        disabled={Boolean(disabledReason)}
        onClick={() => setOpen(true)}
        title={disabledReason ?? "Sell this article to its business as a paid sponsored feature."}
        type="button"
      >
        Promote
      </button>
      {open ? (
        <div className="enhance-overlay" role="dialog" aria-modal="true" aria-label="Promote the article">
          <div className="enhance-modal">
            <div className="enhance-modal-header">
              <h2>Promote the article</h2>
              <button className="enhance-modal-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="enhance-modal-body">
              <AgentBadge agentSlug="marketer" />
              <p className="muted">
                The Marketer emails {businessName ?? "the business"} on its own, presents this article, and tries to sign them up
                to run it as a paid sponsored feature (and other placements where they fit). Replies are answered automatically;
                on a purchase the article gets the agreed style and price.
              </p>
              {issues.length ? (
                <label className="enhance-label">
                  <span>Issue</span>
                  <select className="promote-select" onChange={(e) => setIssueId(e.target.value)} value={issueId}>
                    <option value="">Choose an upcoming issue…</option>
                    {issues.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}{item.slated ? " — article slated" : ""}{item.hasRates ? "" : " — no promotion rates"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="form-error">
                  No upcoming, unpublished issue includes this article or serves the business&rsquo;s ZIP code.
                </p>
              )}
              {issue && !issue.hasRates ? (
                <p className="form-error">This publication has no promotion rates. Add them under Promotion rates on the publication page.</p>
              ) : null}
              <label className="enhance-label">
                <span>
                  Custom instructions for the Marketer <span className="muted">(optional)</span>
                </span>
                <textarea
                  className="enhance-textarea"
                  maxLength={maxInstructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Anything the Marketer should know or do in this conversation. Individual prices are only discounted if you say so here."
                  rows={4}
                  value={instructions}
                />
                <span className="muted enhance-counter">{instructions.length}/{maxInstructions}</span>
              </label>
              <div className="enhance-chips" aria-label="Quick suggestions">
                {SUGGESTIONS.map((text) => (
                  <button
                    className="enhance-chip"
                    disabled={instructions.length + text.length + 2 > maxInstructions}
                    key={text}
                    onClick={() => setInstructions((prev) => (prev.trim() ? `${prev.trim()}. ${text}` : text))}
                    type="button"
                  >
                    + {text}
                  </button>
                ))}
              </div>

              {error ? <p className="form-error">{error}</p> : null}
            </div>

            <div className="enhance-modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={starting || !issue?.hasRates}
                onClick={() => void handleStart()}
                type="button"
              >
                {starting ? "Starting…" : "Start promotion"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
