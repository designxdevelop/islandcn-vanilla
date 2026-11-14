// What the presets import from the engine. The names are the React engine's, so the preset files
// read as the originals do; `IslandNumber` and `IslandProgress` are the engine's elements wrapped as
// content that updates in place.

import { IslandNumber as makeNumber, type IslandNumberOptions, IslandProgress as makeProgress, type IslandProgressOptions } from "../primitives";
import { stateful } from "./runtime";

export { continuousRectPath } from "../path";
export { islandMetrics } from "../metrics";
export type { ActivityOptions, ActivityUpdate, CompactContent } from "../types";
export { useIslandActions, useIslandReducedMotion } from "./runtime";

type NumberProps = Omit<IslandNumberOptions, "style"> & { style?: Record<string, string | number | undefined> };

/** React's style object as the element's: numbers that are lengths are already px strings by here, or unitless. */
const styleOf = (style: Record<string, string | number | undefined> | undefined): Partial<CSSStyleDeclaration> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(style ?? {})) {
    if (value === undefined) continue;
    out[name] = typeof value === "number" && !/^(fontWeight|lineHeight|opacity|flex|zIndex)$/.test(name) && value !== 0 ? `${value}px` : `${value}`;
  }
  return out;
};

/** The engine's number, whose changed digits turn over. A new `value` turns them; a new `turn` makes a new one. */
export const IslandNumber = stateful<NumberProps>("IslandNumber", (initial) => {
  const element = makeNumber({ ...initial, style: styleOf(initial.style) });
  let turn = initial.turn;
  return {
    node: element,
    update(props) {
      if (props.turn !== turn) return false;
      turn = props.turn;
      Object.assign(element.style, styleOf(props.style));
      element.set(props.value);
    },
  };
});

/** The engine's progress bar, whose fill eases to each new value. */
export const IslandProgress = stateful<IslandProgressOptions>("IslandProgress", (initial) => {
  const element = makeProgress(initial);
  const look = (props: IslandProgressOptions) => `${props.color}|${props.track}|${props.height}|${props.radius}`;
  const made = look(initial);
  return {
    node: element,
    update(props) {
      if (look(props) !== made) return false;
      element.set(props.value);
    },
  };
});
