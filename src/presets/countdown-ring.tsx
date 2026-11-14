// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
/** @jsx h */
import { h } from "./runtime";

import { patch, type ReactNode, stateful } from "./runtime";

import { useIslandReducedMotion } from "./engine";

import { ProgressRing } from "./progress-ring";
import { islandAccent } from "./theme";

interface CountdownRingProps {
  /** When the period began, epoch ms (`Date.now()`). Required. */
  start: number;
  /** When it ends, epoch ms. Required. */
  end: number;
  /** Ring colour. Defaults to blue. */
  color?: string;
  /** Outer size in pt. Defaults to 20, which fits the split capsule's room after its glyph. */
  size?: number;
  /** Stroke width in pt. Defaults to 2.5 up to 24 pt, 3 above. */
  thickness?: number;
  /** "drain": full at `start`, empty at `end` (time left). "fill": the other way (time gone). Defaults to "drain". */
  mode?: "drain" | "fill";
  /** Drawn in the middle, such as a glyph. Defaults to nothing. */
  children?: ReactNode;
  /** Called once when `end` passes, once per start and end pair. Defaults to none. */
  onEnd?: () => void;
  /** Accessible name. When set, the ring is a progressbar. Defaults to none (decoration). */
  label?: string;
  /** Where "now" comes from, for tests and captures. Defaults to `Date.now`. */
  now?: () => number;
}

/** How often the ring moves: often enough to read as a sweep, or once a second with reduced motion. */
const step = { smooth: 250, reduced: 1000 } as const satisfies Record<string, number>;

const shareAt = (start: number, end: number, now: number) => Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));

/**
 * A ring that runs down to a moment on its own: a code that expires, a focus session, a hold that
 * times out. Only the ring changes as it moves, never the island content around it, so build the
 * activity once with `start` and `end`. Pair it with `TickingTime` when the seconds should read too.
 */
export const CountdownRing = stateful<CountdownRingProps>("CountdownRing", (initial) => {
  let props = initial;
  let timer = 0;
  let running = false;
  // The period `onEnd` last fired for, so it fires once per start and end pair.
  let endedFor: string | null = null;
  const nowOf = () => (props.now ?? Date.now)();
  /** The ring at this moment. `children` go in only when given: they are nodes, and live in one ring. */
  const view = (children?: ReactNode) => {
    const { start, end, color = islandAccent.blue, size = 20, thickness, mode = "drain", label } = props;
    const gone = shareAt(start, end, nowOf());
    return (
      <ProgressRing value={mode === "drain" ? 1 - gone : gone} color={color} size={size} thickness={thickness ?? (size > 24 ? 3 : 2.5)} label={label}>
        {children}
      </ProgressRing>
    );
  };
  const node = view(initial.children);
  if (!(node instanceof Element)) throw new Error("islandcn: CountdownRing has nothing to draw.");

  /** Moves the ring to now: its own attributes and its drawing, leaving what sits in the middle alone. */
  const sweep = () => {
    const next = view();
    if (!(next instanceof Element)) return;
    for (const name of next.getAttributeNames()) node.setAttribute(name, next.getAttribute(name) ?? "");
    const drawing = node.querySelector("svg");
    const drawn = next.querySelector("svg");
    if (drawing && drawn) patch(drawing, drawn);
  };

  const tick = () => {
    sweep();
    const { start, end } = props;
    const period = `${start}:${end}`;
    const over = shareAt(start, end, nowOf()) >= 1;
    if (over && endedFor !== period) {
      endedFor = period;
      props.onEnd?.();
    }
    return !over;
  };

  const run = () => {
    window.clearInterval(timer);
    timer = 0;
    if (!running || !tick()) return;
    timer = window.setInterval(() => {
      if (!tick()) window.clearInterval(timer);
    }, useIslandReducedMotion() ? step.reduced : step.smooth);
  };

  return {
    node,
    update(next, fresh) {
      const changed = next.start !== props.start || next.end !== props.end;
      props = next;
      // The fresh ring was built with the new props and the new middle: take all of it.
      patch(node, fresh);
      if (changed) run();
    },
    start() {
      running = true;
      run();
    },
    stop() {
      running = false;
      window.clearInterval(timer);
    },
  };
});
