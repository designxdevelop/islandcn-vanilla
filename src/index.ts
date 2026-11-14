// A port of islandcn's engine (https://github.com/opencoredev/islandcn, MIT, copyright (c) 2026 Leo)
// from React to plain TypeScript and DOM calls. See LICENSE and README.md at the repository root.

export { createIsland, type Island, type IslandOptions, type IslandSettings } from "./island";
export { createIslandView, type IslandView, type IslandViewProps } from "./view";
export {
  IslandNumber,
  IslandProgress,
  numberMotion,
  type IslandNumberElement,
  type IslandNumberOptions,
  type IslandProgressElement,
  type IslandProgressOptions,
} from "./primitives";
export { colourLuma, keylineAlphaFor, type KeylineSetting } from "./context";

export type {
  Activity,
  ActivityContent,
  ActivityHandle,
  ActivityOptions,
  ActivityUpdate,
  CompactContent,
  ExpandedContent,
  ExpandReason,
  IslandApi,
  IslandNode,
  IslandPresentation,
  IslandSequence,
  PresentationKind,
  ReducedMotionSetting,
  SequenceIsland,
} from "./types";

export { createFrameClock, defaultClock, type ControllableClock, type IslandClock } from "./clock";
export { AnimatedValue, solveSpring, type SpringConfig, type Transition } from "./spring";
export { islandMetrics, type IslandMetrics } from "./metrics";
export { islandMotion, shapeTransitions, type IslandMotion, type ShapeTransition } from "./motion";
export { resolveMetrics, resolveMotion, type IslandMetricsOverrides, type IslandMotionOverrides } from "./config";
export { bridgePath, capsulePath, continuousRectPath, roundedRectPath, type CornerShape } from "./path";
export type { IslandDevtools, DevtoolsOptions } from "./devtools";
export type { FrameStats } from "./perf";
