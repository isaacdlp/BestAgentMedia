"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TASK_FINISHED_EVENT } from "@/lib/task-events";

/**
 * Keeps a server-rendered task view current: refreshes when the notifier reports finished
 * tasks, and periodically while `active` (the view shows work that is still progressing).
 */
export function TaskAutoRefresh({ active, intervalMs = 3_000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    function onFinished() {
      router.refresh();
    }
    window.addEventListener(TASK_FINISHED_EVENT, onFinished);
    return () => window.removeEventListener(TASK_FINISHED_EVENT, onFinished);
  }, [router]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, router]);

  return null;
}
