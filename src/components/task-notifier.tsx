"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TASK_ACTIVITY_EVENT,
  TASK_FINISHED_EVENT,
  TASK_STARTED_EVENT,
  type LaunchedTask,
} from "@/lib/task-events";

type FinishedTask = { id: number; name: string; status: string; agentName: string | null };
type NotificationsResponse = { finished: FinishedTask[]; activeCount: number; recentActive: boolean };

type Toast = {
  key: string;
  taskId: number;
  kind: "started" | "success" | "error" | "stopped";
  title: string;
  name: string;
  href: string;
};

const FAST_POLL_MS = 4_000;
const SLOW_POLL_MS = 20_000;
const HIDDEN_POLL_MS = 60_000;
const FAST_AFTER_LAUNCH_MS = 5 * 60_000;
const MAX_TOASTS = 5;
const AUTO_DISMISS_MS: Record<Toast["kind"], number | null> = {
  // Notifications stay until the user dismisses them with the close button.
  started: null,
  success: null,
  stopped: null,
  error: null,
};

function toastForFinished(task: FinishedTask): Toast {
  const kind = task.status === "SUCCEEDED" ? "success" : task.status === "FAILED" ? "error" : "stopped";
  const who = task.agentName ? `${task.agentName} task` : "Task";
  const title =
    kind === "success" ? `${who} completed` : kind === "error" ? `${who} failed` : `${who} stopped`;
  return { key: `finished-${task.id}`, taskId: task.id, kind, title, name: task.name, href: `/tasks/${task.id}` };
}

/**
 * Workspace-wide task notifications: shows a toast when the user launches a task, polls for
 * the user's finished tasks, and shows a notification for each one. Clicking a toast opens
 * the task page.
 */
export function TaskNotifier() {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fastUntil = useRef(0);
  const recentActive = useRef(false);
  const pollTimer = useRef<number | null>(null);
  const dismissTimers = useRef(new Map<string, number>());

  const dismiss = useCallback((key: string) => {
    const timer = dismissTimers.current.get(key);
    if (timer) window.clearTimeout(timer);
    dismissTimers.current.delete(key);
    setToasts((current) => current.filter((toast) => toast.key !== key));
  }, []);

  const show = useCallback(
    (incoming: Toast[]) => {
      if (!incoming.length) return;
      setToasts((current) => {
        const keys = new Set(incoming.map((toast) => toast.key));
        // A finished notification replaces the "started" toast for the same task.
        const finishedIds = new Set(incoming.filter((t) => t.kind !== "started").map((t) => t.taskId));
        const kept = current.filter(
          (toast) => !keys.has(toast.key) && !(toast.kind === "started" && finishedIds.has(toast.taskId)),
        );
        return [...kept, ...incoming].slice(-MAX_TOASTS);
      });
      for (const toast of incoming) {
        const delay = AUTO_DISMISS_MS[toast.kind];
        if (delay === null) continue;
        const existing = dismissTimers.current.get(toast.key);
        if (existing) window.clearTimeout(existing);
        dismissTimers.current.set(toast.key, window.setTimeout(() => dismiss(toast.key), delay));
      }
    },
    [dismiss],
  );

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as NotificationsResponse;
      recentActive.current = data.recentActive;
      window.dispatchEvent(new CustomEvent<number>(TASK_ACTIVITY_EVENT, { detail: data.activeCount }));
      if (data.finished.length) {
        show(data.finished.map(toastForFinished));
        window.dispatchEvent(new CustomEvent<FinishedTask[]>(TASK_FINISHED_EVENT, { detail: data.finished }));
      }
    } catch {
      // Network hiccup: try again on the next poll.
    }
  }, [show]);

  const schedule = useCallback(
    (delay?: number) => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      const next =
        delay ??
        (document.hidden
          ? HIDDEN_POLL_MS
          : recentActive.current || Date.now() < fastUntil.current
            ? FAST_POLL_MS
            : SLOW_POLL_MS);
      pollTimer.current = window.setTimeout(async () => {
        await poll();
        schedule();
      }, next);
    },
    [poll],
  );

  useEffect(() => {
    schedule(500);

    function onStarted(event: Event) {
      const tasks = (event as CustomEvent<LaunchedTask[]>).detail ?? [];
      fastUntil.current = Date.now() + FAST_AFTER_LAUNCH_MS;
      show(
        tasks.length > 1
          ? [{
              key: `started-${tasks[0].id}-${tasks.length}`,
              taskId: tasks[0].id,
              kind: "started",
              title: `${tasks.length} tasks started`,
              name: "You'll be notified as each one finishes.",
              href: "/tasks",
            }]
          : tasks.map((task) => ({
              key: `started-${task.id}`,
              taskId: task.id,
              kind: "started" as const,
              title: "Task started",
              name: task.name,
              href: `/tasks/${task.id}`,
            })),
      );
      // Some tasks (for example template-based drafts) finish almost immediately.
      schedule(1_500);
    }
    function onVisibility() {
      if (!document.hidden) schedule(300);
    }

    const timers = dismissTimers.current;
    window.addEventListener(TASK_STARTED_EVENT, onStarted);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener(TASK_STARTED_EVENT, onStarted);
      document.removeEventListener("visibilitychange", onVisibility);
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [schedule, show]);

  if (!toasts.length) return null;

  return (
    <div aria-live="polite" className="task-toasts" role="status">
      {toasts.map((toast) => (
        <div className={`task-toast task-toast-${toast.kind}`} key={toast.key}>
          <button
            className="task-toast-body"
            onClick={() => {
              dismiss(toast.key);
              router.push(toast.href);
            }}
            type="button"
          >
            <span aria-hidden="true" className="task-toast-icon">
              {toast.kind === "started" ? "⟳" : toast.kind === "success" ? "✓" : toast.kind === "error" ? "!" : "■"}
            </span>
            <span className="task-toast-text">
              <strong>{toast.title}</strong>
              <span>{toast.name}</span>
            </span>
            <span className="task-toast-open">View</span>
          </button>
          <button
            aria-label="Dismiss notification"
            className="task-toast-close"
            onClick={() => dismiss(toast.key)}
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
