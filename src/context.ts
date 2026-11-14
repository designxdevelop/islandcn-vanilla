// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
// context.ts without React: the context is one shared box, and the hooks are plain reads with a
// separate subscribe.

import type { IslandClock } from "./clock";
import { type IslandMetrics, type KeylineFadePoint, keylineFade } from "./metrics";
import type { IslandMotion } from "./motion";
import type { FrameRecorder } from "./perf";
import type { IslandStore } from "./store";
import type { ReducedMotionSetting } from "./types";

export interface IslandContextValue {
  store: IslandStore;
  clock: IslandClock;
  metrics: IslandMetrics;
  motion: IslandMotion;
  reducedMotion: ReducedMotionSetting;
  /** Records frame timings when devtools are on. */
  recorder: FrameRecorder | null;
}

/**
 * What React's context carried to `IslandView` and the primitives: the island made last by
 * `createIsland`, or null. A page with several islands passes each view and primitive its own
 * clock instead.
 */
export const islandContext: { current: IslandContextValue | null } = { current: null };

const reducedQuery = "(prefers-reduced-motion: reduce)";
const darkQuery = "(prefers-color-scheme: dark)";

const hasMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

const subscribeMedia = (query: string) => (onChange: () => void) => {
  if (!hasMedia()) return () => undefined;
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/** Calls `onChange` when the system's reduced-motion setting changes. Returns the unsubscribe. */
export const subscribeReduced = subscribeMedia(reducedQuery);

/** Calls `onChange` when the system's colour scheme changes. Returns the unsubscribe. */
export const subscribeDark = subscribeMedia(darkQuery);

const readReduced = () => hasMedia() && window.matchMedia(reducedQuery).matches;

const readDark = () => hasMedia() && window.matchMedia(darkQuery).matches;

/** Whether to swap springs for short crossfades. "user" follows the system setting. */
export const resolveReducedMotion = (setting: ReducedMotionSetting): boolean => {
  if (setting === "always") return true;
  if (setting === "never") return false;
  return readReduced();
};

/** Keyline: "auto" draws it on dark pages, "on" always, "off" never. */
export type KeylineSetting = "auto" | "on" | "off";

/**
 * Gamma-encoded Rec. 709 luma (0 to 1) of a CSS colour in hex or rgb() form, the scale the
 * simulator's keyline was measured on. Null for anything else (named colours, gradients).
 */
export const colourLuma = (colour: string): number | null => {
  const value = colour.trim().toLowerCase();
  let rgb: [number, number, number] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(value);
  if (hex?.[1]) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d) : (hex[1].match(/../g) ?? []);
    const [r, g, b] = digits.map((d) => Number.parseInt(d, 16));
    if (r !== undefined && g !== undefined && b !== undefined) rgb = [r, g, b];
  }
  const fn = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(value);
  if (fn) rgb = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  if (!rgb) return null;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
};

/**
 * Keyline alpha over a page of this luma, from the simulator's table: full up to `fullUntil`, then
 * log-linear between the measured points in `keylineFade`, then straight down to none at `noneFrom`.
 */
export const keylineAlphaFor = (luma: number, metrics: IslandMetrics): number => {
  const k = metrics.keyline;
  // A luma that isn't a number says nothing about the page: draw no band rather than a NaN shadow.
  if (Number.isNaN(luma)) return 0;
  if (luma >= k.noneFrom) return 0;
  if (luma <= k.fullUntil) return k.alpha;
  let from: KeylineFadePoint = { luma: k.fullUntil, share: 1 };
  for (const point of keylineFade) {
    // With `fullUntil` or `noneFrom` overridden past a point, that point would bend the fade backwards.
    if (point.luma <= from.luma || point.luma >= k.noneFrom) continue;
    if (luma <= point.luma) {
      const t = (luma - from.luma) / (point.luma - from.luma);
      return k.alpha * from.share * (point.share / from.share) ** t;
    }
    from = point;
  }
  // Log space never reaches zero, so the last stretch to `noneFrom` is a straight line.
  return k.alpha * from.share * (1 - (luma - from.luma) / (k.noneFrom - from.luma));
};

/**
 * Resolved keyline alpha. With a `backdrop` colour the strength follows the page's luma; without
 * one, "auto" assumes a near-black page in dark mode and draws nothing in light mode.
 */
export const resolveKeyline = (setting: KeylineSetting, backdrop: string | undefined, metrics: IslandMetrics): number => {
  if (setting === "off") return 0;
  const luma = backdrop === undefined ? null : colourLuma(backdrop);
  if (luma !== null) return keylineAlphaFor(luma, metrics);
  if (setting === "on" || readDark()) return metrics.keyline.alpha;
  return 0;
};
