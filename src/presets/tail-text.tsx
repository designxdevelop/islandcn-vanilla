// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
/** @jsx h */
import { h } from "./runtime";

import { patch, stateful } from "./runtime";

import { islandFont, islandInk, trackingFor } from "./theme";

interface TailTextProps {
  /** The text so far. It may grow on every update; the newest words stay in view. */
  text: string;
  /** Size in pt: 17 for the line that matters, 15 for the one under or over it. Defaults to 17. */
  size?: 15 | 17;
  /** Weight: 600 for the main line, 400 for a quieter one. Defaults to 600. */
  weight?: 400 | 500 | 600;
  /** Text colour. Defaults to white. */
  color?: string;
}

/** How far the fade reaches in from the leading edge once the start is cut, in pt. */
const fade = 28;

/**
 * One line of text that grows at its end and keeps the end in view: a live transcript, a
 * translation, an agent's latest output. Short text starts at the leading edge like any line; once
 * it is longer than the row, the start slides out of view under a soft fade instead of the end
 * being cut with an ellipsis.
 */
export const TailText = stateful<TailTextProps>("TailText", (initial) => {
  let props = initial;
  let cut = false;
  let observer: ResizeObserver | null = null;
  const view = () => {
    const { text, size = 17, weight = 600, color = islandInk.primary } = props;
    const mask = cut ? `linear-gradient(90deg, transparent 0, #000 ${fade}px)` : undefined;
    return (
      <span
        style={{
          display: "flex",
          // With the line at least as wide as the row, flex-end keeps a long line's end in view and leaves a short one at the start.
          justifyContent: "flex-end",
          overflow: "hidden",
          minWidth: 0,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      >
        <span
          style={{
            flex: "none",
            minWidth: "100%",
            whiteSpace: "nowrap",
            font: `${weight} ${size}px/${Math.round(size * 1.3)}px ${islandFont}`,
            letterSpacing: trackingFor(size),
            color,
            WebkitFontSmoothing: "antialiased",
          }}
        >
          {text}
        </span>
      </span>
    ) as HTMLElement;
  };
  const node = view();
  const redraw = () => patch(node, view());
  // Measured, not assumed: the fade shows only when the line really runs past the row.
  const measure = () => {
    const line = node.firstElementChild;
    if (!line) return;
    const next = line.scrollWidth > node.clientWidth + 0.5;
    if (next === cut) return;
    cut = next;
    redraw();
  };
  return {
    node,
    update(next) {
      props = next;
      redraw();
      measure();
    },
    start() {
      observer = new ResizeObserver(measure);
      observer.observe(node);
      if (node.firstElementChild) observer.observe(node.firstElementChild);
      measure();
    },
    stop() {
      observer?.disconnect();
      observer = null;
    },
  };
});
