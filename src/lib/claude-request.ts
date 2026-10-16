import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Output token ceiling for every Claude call. Calls are streamed, so a high ceiling cannot hit the
 * SDK's non-streaming timeout guard; you pay only for tokens actually generated, and thinking
 * counts toward this limit. 64K is within the output limit of every model the app may be
 * configured with (current models allow 128K; Sonnet 4.5 and Haiku 4.5 allow 64K).
 */
export const MAX_OUTPUT_TOKENS = 64_000;

type Effort = NonNullable<Anthropic.OutputConfig["effort"]>;

/**
 * Effort controls how much the model thinks (and so most of the cost and latency). Only some
 * models accept it — older ones such as Sonnet 4.5 and Haiku 4.5 reject the parameter — so it is
 * sent only when the configured model supports it. Returns the `output_config` fields to spread.
 */
export function effortFor(model: string, effort: Effort): { effort?: Effort } {
  return supportsEffort(model) ? { effort } : {};
}

function supportsEffort(model: string): boolean {
  const match = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(model);
  if (!match) return false;
  const [, family, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = minorText && minorText.length <= 2 ? Number(minorText) : 0;
  if (major >= 5 || family === "fable" || family === "mythos") return true;
  if (major === 4 && minor >= 6) return true;
  // Opus 4.5 introduced effort; Sonnet 4.5 and Haiku 4.5 reject it
  return family === "opus" && major === 4 && minor === 5;
}
