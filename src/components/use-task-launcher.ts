"use client";

import { useCallback, useState } from "react";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";

/**
 * Calls a task launch endpoint (which responds immediately with `{ task }` or `{ tasks }`) and
 * announces the started task(s). `starting` only covers the launch request, not the work.
 */
export function useTaskLauncher() {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const launch = useCallback(async (url: string, body?: unknown): Promise<boolean> => {
    setStarting(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      // A crashed route can answer with an empty or non-JSON body; don't let that mask the status.
      const text = await response.text();
      let result: { task?: LaunchedTask; tasks?: LaunchedTask[]; error?: string } = {};
      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        // keep the empty result
      }
      if (!response.ok) {
        throw new Error(result.error ?? `The task could not be started (server responded ${response.status}).`);
      }
      announceTaskStarted(result.tasks ?? (result.task ? [result.task] : []));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "The task could not be started.");
      return false;
    } finally {
      setStarting(false);
    }
  }, []);

  return { launch, starting, error };
}
