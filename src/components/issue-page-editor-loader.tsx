"use client";

import dynamic from "next/dynamic";

export const IssuePageEditor = dynamic(
  () =>
    import("@/components/issue-page-editor").then(
      (module) => module.IssuePageEditor,
    ),
  {
    ssr: false,
    loading: () => <div className="empty-state">Loading the issue editor…</div>,
  },
);
