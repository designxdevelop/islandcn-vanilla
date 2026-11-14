// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
// view.tsx without React.

import { defaultClock, type IslandClock } from "./clock";
import { type IslandMetricsOverrides, type IslandMotionOverrides, resolveMetrics, resolveMotion } from "./config";
import { islandContext, type KeylineSetting, resolveKeyline, resolveReducedMotion, subscribeDark, subscribeReduced } from "./context";
import { createIslandSurface, type IslandSurfaceProps } from "./surface";
import type { IslandPresentation, ReducedMotionSetting } from "./types";

export interface IslandViewProps {
  /** What to show. Changing it animates the shape and crossfades the content. */
  presentation: IslandPresentation;
  /**
   * Identity of the content. A new key crossfades; the same key updates in place (a progress
   * value ticking up, say). Defaults to `presentation.kind`.
   */
  contentKey?: string;
  /** Hold the pill down: it squishes slightly. Defaults to false. */
  pressed?: boolean;
  /** "container" (nearest positioned ancestor) or "viewport" (fixed to the window). Defaults to "container". */
  placement?: "container" | "viewport";
  /** Region name for screen readers. Defaults to "Live activity". */
  label?: string;
  /** Text announced politely when it changes. Defaults to none. */
  liveLabel?: string;
  /** Time source. Defaults to the clock of the island made last, or a shared requestAnimationFrame clock. */
  clock?: IslandClock;
  /** Geometry overrides. Defaults to that island's metrics, or the metrics table. */
  metrics?: IslandMetricsOverrides;
  /** Spring overrides. Defaults to that island's motion, or the motion table. */
  motion?: IslandMotionOverrides;
  /** Defaults to that island's setting, or "user". */
  reducedMotion?: ReducedMotionSetting;
  /** Class on the region element. Defaults to none. */
  className?: string;
  /** Style on the region element. Defaults to none. */
  style?: Partial<CSSStyleDeclaration>;
  /**
   * The thin grey band outside the edge that separates the island from a dark page. "auto" draws
   * it when `backdrop` is dark, or in dark mode when no `backdrop` is given. Defaults to "auto".
   */
  keyline?: KeylineSetting;
  /** The page colour behind the island (hex or rgb()), which sets the keyline's strength. Defaults to none. */
  backdrop?: string;
}

export interface IslandView {
  /** The region element. */
  readonly element: HTMLDivElement;
  /** Shows new props, as a render with them did. */
  update(props: IslandViewProps): void;
  destroy(): void;
}

/**
 * One presentation, controlled, without the activity stack. For docs, playgrounds and captures.
 * It draws the same shape and motion as an island but isn't pressable.
 */
export const createIslandView = (container: HTMLElement, initial: IslandViewProps): IslandView => {
  let props = initial;
  // Overrides resolve once per object, as the memo did: a new table each time would retarget every update.
  let metricsFor: { overrides: IslandMetricsOverrides; resolved: ReturnType<typeof resolveMetrics> } | null = null;
  let motionFor: { overrides: IslandMotionOverrides; resolved: ReturnType<typeof resolveMotion> } | null = null;
  const fallbackMetrics = resolveMetrics();
  const fallbackMotion = resolveMotion();

  const surfaceProps = (): IslandSurfaceProps => {
    const context = islandContext.current;
    if (props.metrics && metricsFor?.overrides !== props.metrics) metricsFor = { overrides: props.metrics, resolved: resolveMetrics(props.metrics) };
    if (props.motion && motionFor?.overrides !== props.motion) motionFor = { overrides: props.motion, resolved: resolveMotion(props.motion) };
    const metrics = props.metrics && metricsFor ? metricsFor.resolved : (context?.metrics ?? fallbackMetrics);
    const motion = props.motion && motionFor ? motionFor.resolved : (context?.motion ?? fallbackMotion);
    return {
      presentation: props.presentation,
      contentKey: props.contentKey ?? props.presentation.kind,
      change: null,
      pressed: props.pressed ? "pill" : null,
      pressStyle: "squish",
      activityId: null,
      alerting: false,
      placement: props.placement ?? "container",
      regionLabel: props.label ?? "Live activity",
      liveLabel: props.liveLabel ?? "",
      clock: props.clock ?? context?.clock ?? defaultClock(),
      metrics,
      motion,
      reduced: resolveReducedMotion(props.reducedMotion ?? context?.reducedMotion ?? "user"),
      keyline: resolveKeyline(props.keyline ?? "auto", props.backdrop, metrics),
      recorder: context?.recorder ?? null,
      interaction: null,
      className: props.className,
      style: props.style,
    };
  };

  const surface = createIslandSurface(container, surfaceProps());
  const render = () => surface.update(surfaceProps());
  const unsubscribes = [subscribeReduced(render), subscribeDark(render)];

  return {
    element: surface.element,
    update(next) {
      props = next;
      render();
    },
    destroy() {
      for (const unsubscribe of unsubscribes) unsubscribe();
      surface.destroy();
    },
  };
};
