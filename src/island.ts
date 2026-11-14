// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
// provider.tsx, island-root.tsx and use-island.ts without React: `createIsland` owns the activity
// stack and the clock, as <IslandProvider> does, and draws it, as <Island /> does. What it
// returns is the API `useIsland()` gave.

import { createFrameClock, type IslandClock } from "./clock";
import { type IslandMetricsOverrides, type IslandMotionOverrides, resolveMetrics, resolveMotion } from "./config";
import { islandContext, type IslandContextValue, type KeylineSetting, resolveKeyline, resolveReducedMotion, subscribeDark, subscribeReduced } from "./context";
import { createDevtools, type DevtoolsOptions } from "./devtools";
import { createFrameRecorder } from "./perf";
import { createIslandStore, deriveScene, type PressTarget } from "./store";
import { createIslandSurface, type IslandSurfaceProps, type SurfaceInteraction } from "./surface";
import type { IslandApi, ReducedMotionSetting } from "./types";

/** What can change after the island is made (`Island.configure`). */
export interface IslandSettings {
  /** Geometry overrides on top of the metrics table. Defaults to none. */
  metrics?: IslandMetricsOverrides;
  /** Spring and timing overrides on top of the motion table. Defaults to none. */
  motion?: IslandMotionOverrides;
  /** "user" follows prefers-reduced-motion, "always" and "never" force it. Defaults to "user". */
  reducedMotion?: ReducedMotionSetting;
  /**
   * "container" draws at the top centre of the nearest positioned ancestor (a phone frame);
   * "viewport" pins it to the top centre of the window. Defaults to "container".
   */
  placement?: "container" | "viewport";
  /** Name of the island region for screen readers. Defaults to "Live activities". */
  label?: string;
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

export interface IslandOptions extends IslandSettings {
  /** The element the island is put in. Defaults to `document.body`. */
  container?: HTMLElement;
  /**
   * Where island time comes from. Read once. Defaults to a requestAnimationFrame clock (pausable
   * when `devtools` is on).
   */
  clock?: IslandClock;
  /**
   * Installs `window.__islandcn` (pause, step, seek, play) for frame-exact captures. Pass
   * `{ sequences }` to register named sequences. Defaults to false; leave it off in production.
   */
  devtools?: boolean | DevtoolsOptions;
}

/** A running island: the activity API, plus what the React hooks gave. */
export interface Island extends IslandApi {
  /** The region element. */
  readonly element: HTMLDivElement;
  readonly clock: IslandClock;
  /** Whether the island runs reduced motion: its setting resolved against the system's. */
  readonly reducedMotion: boolean;
  /** Calls `listener` when the activities or the presentation change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Changes settings in place, as new props on the provider or the island did. */
  configure(settings: IslandSettings): void;
  /** Removes the island and everything it listens to. */
  destroy(): void;
}

/** Makes an island, puts it in the page, and returns the API that starts, updates and ends activities. */
export const createIsland = (options: IslandOptions = {}): Island => {
  const { container = document.body, clock: givenClock, devtools = false, ...initial } = options;
  let settings: IslandSettings = initial;
  let metrics = resolveMetrics(settings.metrics);
  let motion = resolveMotion(settings.motion);

  const ownClock = createFrameClock();
  const clock = givenClock ?? ownClock;
  const recorder = devtools ? createFrameRecorder() : null;
  // The store reads motion lazily, so motion overrides can change without rebuilding the stack.
  const store = createIslandStore({ clock, motion: () => motion });

  const context: IslandContextValue = { store, clock, metrics, motion, reducedMotion: settings.reducedMotion ?? "user", recorder };
  islandContext.current = context;

  const devtoolsOptions = typeof devtools === "object" ? devtools : devtools ? {} : null;
  // Devtools need a clock they can pause; an injected clock is the caller's to drive.
  const tools =
    devtoolsOptions !== null && !givenClock && typeof window !== "undefined"
      ? createDevtools({
          clock: ownClock,
          store,
          recorder: recorder ?? createFrameRecorder(),
          sequences: devtoolsOptions.sequences ?? {},
          // A change to the store draws at once here, so there is nothing to flush.
          flush: (run) => run(),
        })
      : null;
  if (tools) window.__islandcn = tools;

  /** Whether the outside-press and Escape listeners are on: only while expanded. */
  let listening = false;
  let rootElement: HTMLDivElement | null = null;

  // A press outside the island, or Escape, collapses an expanded island.
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && rootElement?.contains(target)) return;
    store.api.collapse();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const focusInside = rootElement?.contains(document.activeElement) ?? false;
    store.api.collapse();
    if (focusInside) rootElement?.querySelector<HTMLButtonElement>('[data-islandcn-hit="pill"]')?.focus();
  };
  const listen = (expanded: boolean) => {
    if (expanded === listening) return;
    listening = expanded;
    if (expanded) {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown);
    } else {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    }
  };

  /** What <Island /> rendered for the store's snapshot. */
  const propsNow = (): IslandSurfaceProps => {
    const snapshot = store.getSnapshot();
    const scene = deriveScene(snapshot);
    const expanded = scene.presentation.kind === "expanded";
    // With no activity the pill still swells under a press (idletap-t1), but it is not a control.
    const primaryLabel = scene.primary?.label ?? null;
    const interaction: SurfaceInteraction = {
      pillLabel:
        primaryLabel === null ? null : expanded ? `${primaryLabel}, expanded. Press Escape to collapse.` : `${primaryLabel}. Press to expand.`,
      bubbleLabel: scene.detached ? `${scene.detached.label}. Press to expand.` : null,
      expanded,
      onPressStart: (target: PressTarget, event) => {
        if (event.button !== 0) return;
        store.press(target);
      },
      onPressEnd: () => store.release(),
      onPressCancel: () => store.release({ cancel: true }),
      onActivate: (target: PressTarget) => {
        if (expanded) {
          store.api.collapse();
          return;
        }
        const activity = target === "bubble" ? scene.detached : scene.primary;
        if (activity) store.api.expand(activity.id);
      },
    };
    return {
      presentation: scene.presentation,
      contentKey: scene.contentKey,
      change: { id: snapshot.changeId, at: snapshot.changedAt, instant: snapshot.instant },
      pressed: snapshot.pressed,
      joining: snapshot.joining,
      pressStyle: "swell",
      activityId: scene.primary?.id ?? null,
      alerting: snapshot.expanded?.reason === "alert",
      handingOff: snapshot.handoff !== null,
      placement: settings.placement ?? "container",
      regionLabel: settings.label ?? "Live activities",
      liveLabel: scene.label,
      clock,
      metrics,
      motion,
      reduced: resolveReducedMotion(settings.reducedMotion ?? "user"),
      keyline: resolveKeyline(settings.keyline ?? "auto", settings.backdrop, metrics),
      recorder,
      interaction,
      className: settings.className,
      style: settings.style,
    };
  };

  const first = propsNow();
  const surface = createIslandSurface(container, first);
  rootElement = surface.element;
  listen(first.presentation.kind === "expanded");

  const render = () => {
    const props = propsNow();
    surface.update(props);
    listen(props.presentation.kind === "expanded");
  };

  const unsubscribes = [store.subscribe(render), subscribeReduced(render), subscribeDark(render)];

  return {
    start: (activity) => store.api.start(activity),
    update: (id, update) => store.api.update(id, update),
    end: (id) => store.api.end(id),
    expand: (id) => store.api.expand(id),
    collapse: () => store.api.collapse(),
    get activities() {
      return store.api.activities;
    },
    get presentation() {
      return store.api.presentation;
    },
    element: surface.element,
    clock,
    get reducedMotion() {
      return resolveReducedMotion(settings.reducedMotion ?? "user");
    },
    subscribe: (listener) => store.subscribe(listener),
    configure(next) {
      settings = { ...settings, ...next };
      if ("metrics" in next) metrics = resolveMetrics(settings.metrics);
      if ("motion" in next) motion = resolveMotion(settings.motion);
      context.metrics = metrics;
      context.motion = motion;
      context.reducedMotion = settings.reducedMotion ?? "user";
      render();
    },
    destroy() {
      for (const unsubscribe of unsubscribes) unsubscribe();
      listen(false);
      surface.destroy();
      if (tools && window.__islandcn === tools) delete window.__islandcn;
      if (islandContext.current === context) islandContext.current = null;
    },
  };
};
