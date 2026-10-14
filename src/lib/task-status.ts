// Display helpers for Task statuses, shared by server pages and client components.

export type TaskStatusValue = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED";

export const TASK_STATUS_LABELS: Record<TaskStatusValue, string> = {
  PENDING: "Queued",
  RUNNING: "Ongoing",
  SUCCEEDED: "Success",
  FAILED: "Error",
  STOPPED: "Stopped",
};

export function isTaskActive(status: TaskStatusValue) {
  return status === "PENDING" || status === "RUNNING";
}

export function formatTaskDuration(start: Date | string, end: Date | string | null): string {
  const seconds = Math.max(
    0,
    Math.round(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
