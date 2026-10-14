"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TASK_ACTIVITY_EVENT } from "@/lib/task-events";

/** Sidebar link to the Tasks section with a live count of the user's ongoing tasks. */
export function TaskNavLink({ initialActiveCount }: { initialActiveCount: number }) {
  const [activeCount, setActiveCount] = useState(initialActiveCount);

  useEffect(() => {
    function onActivity(event: Event) {
      setActiveCount((event as CustomEvent<number>).detail);
    }
    window.addEventListener(TASK_ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(TASK_ACTIVITY_EVENT, onActivity);
  }, []);

  return (
    <Link className="nav-link-with-badge" href="/tasks">
      <span>Tasks</span>
      {activeCount > 0 ? (
        <span className="nav-badge" title={`${activeCount} ongoing task${activeCount === 1 ? "" : "s"}`}>
          {activeCount}
        </span>
      ) : null}
    </Link>
  );
}
