// Browser events that connect task launchers with the TaskNotifier in the workspace layout.

export type LaunchedTask = { id: number; name: string };

export const TASK_STARTED_EVENT = "bam:task-started";
export const TASK_FINISHED_EVENT = "bam:task-finished";
export const TASK_ACTIVITY_EVENT = "bam:task-activity";

/** Call after a launch API returns: shows a "started" toast and speeds up completion polling. */
export function announceTaskStarted(tasks: LaunchedTask | LaunchedTask[]) {
  const list = Array.isArray(tasks) ? tasks : [tasks];
  if (!list.length) return;
  window.dispatchEvent(new CustomEvent<LaunchedTask[]>(TASK_STARTED_EVENT, { detail: list }));
}
