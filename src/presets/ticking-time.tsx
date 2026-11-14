// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
/** @jsx h */
import { h } from "./runtime";

import { adopt, type CSSProperties, stateful } from "./runtime";

import { NumberText, type NumberMotion, feedTurn } from "./island-text";
import { islandFont } from "./theme";

/** What the clock shows: time since a moment, time left until one, or a fixed duration. */
export type TickingTimeSource =
  | { kind: "elapsed"; since: number }
  | { kind: "remaining"; until: number }
  | { kind: "fixed"; ms: number };

interface TickingTimeProps {
  /** Where the time comes from. Times are epoch ms (`Date.now()`). */
  source: TickingTimeSource;
  /** Turns ms into text. Defaults to `formatClock` ("4:07", "1:02:09"). */
  format?: (ms: number) => string;
  /** Called once when a `remaining` source reaches zero. Defaults to none. */
  onEnd?: () => void;
  /** Text styles. Tabular figures are always on (`NumberText`). Defaults to inheriting. */
  style?: CSSProperties;
  /** Where "now" comes from, for tests and captures. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * How a changed digit moves. Defaults to "steady": a clock changes every second, so its digits
   * cross over in place and one always reads. "live" turns them over as a live status number does.
   */
  motion?: NumberMotion;
}

/** "4:07" under an hour, "1:02:09" from an hour on. Drops partial seconds. */
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
};


/** Whole minutes, rounded up, so "1" shows until the last second: "12". */
export const formatMinutes = (ms: number): string => String(Math.max(0, Math.ceil(ms / 60000)));

// A countdown shows whole seconds rounded up, so it reads 0:00 only when time is up.
const msFor = (source: TickingTimeSource, now: number) => {
  switch (source.kind) {
    case "elapsed":
      return now - source.since;
    case "remaining":
      return Math.ceil((source.until - now) / 1000) * 1000;
    case "fixed":
      return source.ms;
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
};

const keyOf = (source: TickingTimeSource) => `${source.kind}:${source.kind === "elapsed" ? source.since : source.kind === "remaining" ? source.until : source.ms}`;

/**
 * A clock that ticks once a second. Only this piece changes, never the island content around it,
 * and changed digits cross over in place so one always reads (`SteadyNumber`); with reduced motion
 * they change in place. It wakes on each whole-second boundary, not on a free-running interval, so
 * it never drifts or shows a second twice.
 */
export const TickingTime = stateful<TickingTimeProps>("TickingTime", (initial) => {
  let props = initial;
  let timer = 0;
  let running = false;
  let ended = false;
  const view = (text: string) => <NumberText value={text} style={{ fontFamily: islandFont, ...props.style }} turn={feedTurn} motion={props.motion ?? "steady"} />;
  const textNow = () => (props.format ?? formatClock)(msFor(props.source, (props.now ?? Date.now)()));
  const node = view(textNow());
  if (!node) throw new Error("islandcn: TickingTime has nothing to draw.");
  // The clock is a number that ticks: the number's own piece keeps its node and takes each new text.
  const number = adopt(node);

  const tick = () => {
    window.clearTimeout(timer);
    const { source } = props;
    const t = (props.now ?? Date.now)();
    const ms = msFor(source, t);
    number.update(view((props.format ?? formatClock)(ms)) ?? node);
    if (source.kind === "fixed" || !running) return;
    // Time to the next whole second of the raw count, when the shown value changes.
    const raw = source.kind === "remaining" ? source.until - t : t - source.since;
    if (source.kind === "remaining" && ms <= 0) {
      if (!ended) {
        ended = true;
        props.onEnd?.();
      }
      return;
    }
    // Sleep until the displayed value next changes: the next whole second of the count.
    const intoSecond = ((raw % 1000) + 1000) % 1000;
    const wait = source.kind === "remaining" ? intoSecond || 1000 : 1000 - intoSecond;
    timer = window.setTimeout(tick, Math.max(16, wait + 4));
  };

  return {
    node,
    update(next) {
      const changed = keyOf(next.source) !== keyOf(props.source);
      props = next;
      if (changed) ended = false;
      // A reduced-motion change makes the number another kind of thing: then the clock is made anew.
      if (!number.update(view(textNow()) ?? node)) return false;
      if (changed) tick();
    },
    start() {
      running = true;
      number.start();
      tick();
    },
    stop() {
      running = false;
      window.clearTimeout(timer);
      number.stop();
    },
  };
});
