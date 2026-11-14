// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
import { type CSSProperties, stateful, styleText } from "./runtime";

/*
 * A number that changes about once a second (a clock, a percentage that follows a transfer) is
 * caught mid-change in a good share of any glance. The engine's `IslandNumber` turns a digit over
 * the way a live status number does: the old one shrinks, blurs and fades before the new one
 * comes in, so for a moment neither reads. Here the two overlap instead: the new digit is already
 * most of the way in before the old one starts to go, their opacities cross high, and the blur is
 * a hair's. At every moment of a change one digit is legible.
 */

/** The steady turn, in seconds from the change. */
export const steadyTurn = {
  /** The incoming digit fades in over this window. */
  inFade: [0, 0.08],
  /**
   * The outgoing digit fades out over this one, starting half way through the incoming fade: the
   * two cross at 84% each, and both show at once for about 60 ms of the 120 ms change.
   */
  outFade: [0.04, 0.12],
  /** The incoming digit grows to full size over this window, the outgoing one shrinks over `outFade`. */
  grow: [0, 0.12],
  /** Scale a digit has at the far end of its fade. */
  scale: 0.92,
  /** Peak blur in px per px of font size, on the faint side of the crossing only (0.45 px at 15 px). */
  blurPerEm: 0.03,
} as const satisfies Record<string, number | readonly [number, number]>;

/** Seconds a change lasts: the outgoing digit is gone and the incoming one at rest. */
const TURN_SECONDS = Math.max(steadyTurn.outFade[1], steadyTurn.grow[1], steadyTurn.inFade[1]);

const progress = (t: number, [from, to]: readonly [number, number]) => Math.min(1, Math.max(0, (t - from) / (to - from)));

const smooth = (u: number) => u * u * (3 - 2 * u);

/** How a glyph looks: opacity, blur as a share of the peak, and scale. */
interface Pose {
  opacity: number;
  blur: number;
  scale: number;
}

/** The incoming digit `t` seconds into its change. */
const incomingAt = (t: number): Pose => {
  const fade = progress(t, steadyTurn.inFade);
  const grow = progress(t, steadyTurn.grow);
  return { opacity: smooth(fade), blur: 1 - fade, scale: steadyTurn.scale + (1 - steadyTurn.scale) * (1 - (1 - grow) ** 2) };
};

/** The outgoing digit `t` seconds into the change. */
const outgoingAt = (t: number): Pose => {
  const fade = progress(t, steadyTurn.outFade);
  return { opacity: 1 - smooth(fade), blur: fade >= 1 ? 0 : fade, scale: 1 - (1 - steadyTurn.scale) * fade * fade };
};

/**
 * Both glyphs of a change `t` seconds in, with blur in px for a font `em` px tall: what a still
 * taken at that moment shows.
 */
export const steadyPosesAt = (t: number, em: number) => {
  const pose = (p: Pose) => ({ opacity: p.opacity, blur: p.blur * steadyTurn.blurPerEm * em, scale: p.scale });
  return { incoming: pose(incomingAt(t)), outgoing: pose(outgoingAt(t)) };
};

/** A place changing: the character it shows going out, and when the change began (ms, `performance.now`). */
interface PlaceTurn {
  from: string;
  at: number;
}

/** The changes in flight, by place counted from the right, and every place that has ever changed. */
interface Changes {
  turns: ReadonlyMap<number, PlaceTurn>;
  cells: ReadonlySet<number>;
}

interface SteadyNumberProps {
  /** The value to show. Numbers render with `toString()`; pass a string to format it yourself. Required. */
  value: number | string;
  /** Styles on the wrapper (font, size, colour). Defaults to none. */
  style?: CSSProperties;
}

/** One place drawn as a cell: the character coming in and the one going out, stacked. */
interface Cell {
  element: HTMLSpanElement;
  incoming: HTMLSpanElement;
  outgoing: HTMLSpanElement;
  /** Whether the cell was last built as changing, which sets where its two glyphs start. */
  turning: boolean | null;
}

const layered = "grid-area:1 / 1;justify-self:center;will-change:opacity, transform, filter";

/**
 * Text whose changed characters cross over in place, overlapped so one of them always reads.
 * Places count from the right, so 9:59 to 10:00 keeps the seconds in their cells. Unchanged
 * characters don't move. Use it under the island's reduced-motion check (`NumberText` does).
 */
export const SteadyNumber = stateful<SteadyNumberProps>("SteadyNumber", (initial) => {
  let shown = String(initial.value);
  let changes: Changes = { turns: new Map(), cells: new Set() };
  const plain = new Map<number, HTMLSpanElement>();
  const cells = new Map<number, Cell>();
  let frame = 0;

  // Plain inline, as `IslandNumber` is, so a slot cut to fit ends the text in an ellipsis.
  const wrapper = document.createElement("span");
  wrapper.setAttribute("role", "text");
  const dress = (style: CSSProperties | undefined) => wrapper.setAttribute("style", styleText({ display: "inline", whiteSpace: "pre", ...style }));

  const span = (css = "") => {
    const element = document.createElement("span");
    if (css) element.style.cssText = css;
    return element;
  };

  /** The characters as spans, each place keeping its element from the last draw where it can. */
  const render = () => {
    wrapper.setAttribute("aria-label", shown);
    const chars = [...shown];
    const children = chars.map((char, index) => {
      const place = chars.length - 1 - index;
      if (!changes.cells.has(place)) {
        let element = plain.get(place);
        if (!element) {
          element = span();
          element.setAttribute("aria-hidden", "true");
          plain.set(place, element);
        }
        if (element.textContent !== char) element.textContent = char;
        return element;
      }
      // Old and new share one cell, centred on each other, and keep it between changes. Each glyph is its
      // own layer, filter included: Safari draws a blur under 1 px on a plain element as about 1 px.
      plain.delete(place);
      const turn = changes.turns.get(place);
      let cell = cells.get(place);
      if (!cell) {
        const element = span("display:inline-grid");
        element.setAttribute("aria-hidden", "true");
        const incoming = span(layered);
        const outgoing = span(layered);
        element.appendChild(incoming);
        element.appendChild(outgoing);
        cell = { element, incoming, outgoing, turning: null };
        cells.set(place, cell);
      }
      const turning = turn !== undefined;
      if (cell.turning !== turning) {
        cell.turning = turning;
        cell.incoming.style.opacity = turning ? "0" : "1";
        cell.outgoing.style.opacity = turning ? "1" : "0";
      }
      if (cell.incoming.textContent !== char) cell.incoming.textContent = char;
      const from = turn?.from ?? "";
      if (cell.outgoing.textContent !== from) cell.outgoing.textContent = from;
      return cell.element;
    });
    for (const place of [...plain.keys()]) if (place >= chars.length) plain.delete(place);
    for (const place of [...cells.keys()]) if (place >= chars.length) cells.delete(place);
    children.forEach((child, index) => {
      const at = wrapper.childNodes[index] ?? null;
      if (at !== child) wrapper.insertBefore(child, at);
    });
    while (wrapper.childNodes.length > children.length) wrapper.lastChild?.remove();
  };

  /** Paints the changes in flight each frame until every one has ended. */
  const animate = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    const em = Number.parseFloat(getComputedStyle(wrapper).fontSize) || 16;
    const blurMax = steadyTurn.blurPerEm * em;
    const paint = (element: HTMLSpanElement | undefined, pose: Pose) => {
      if (!element) return;
      element.style.opacity = pose.opacity.toFixed(3);
      const blur = blurMax * pose.blur;
      element.style.filter = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : "none";
      element.style.transform = pose.scale === 1 ? "none" : `scale(${pose.scale.toFixed(4)})`;
    };
    const rest: Pose = { opacity: 1, blur: 0, scale: 1 };
    const gone: Pose = { opacity: 0, blur: 0, scale: 1 };
    // Cells with no change in flight sit at rest: the character in, nothing going out.
    for (const place of changes.cells) {
      if (changes.turns.has(place)) continue;
      paint(cells.get(place)?.incoming, rest);
      paint(cells.get(place)?.outgoing, gone);
    }
    const write = (now: number) => {
      let done = true;
      for (const [place, turn] of changes.turns) {
        const t = (now - turn.at) / 1000;
        if (t < TURN_SECONDS) done = false;
        paint(cells.get(place)?.incoming, t >= TURN_SECONDS ? rest : incomingAt(t));
        paint(cells.get(place)?.outgoing, t >= TURN_SECONDS ? gone : outgoingAt(t));
      }
      return done;
    };
    if (write(performance.now())) return;
    const tick = (now: number) => {
      frame = write(now) ? 0 : window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
  };

  dress(initial.style);
  render();

  return {
    node: wrapper,
    update(props) {
      dress(props.style);
      const text = String(props.value);
      if (text === shown) return;
      const now = performance.now();
      const turns = new Map<number, PlaceTurn>();
      // A place still changing keeps going; a new change at it starts over from what it was turning to.
      for (const [place, turn] of changes.turns) if ((now - turn.at) / 1000 < TURN_SECONDS && place < text.length) turns.set(place, turn);
      const before = [...shown];
      const after = [...text];
      for (let place = 0; place < after.length; place += 1) {
        const from = before[before.length - 1 - place] ?? "";
        if (from !== after[after.length - 1 - place]) turns.set(place, { from, at: now });
      }
      shown = text;
      changes = { turns, cells: new Set([...changes.cells, ...turns.keys()]) };
      render();
      animate();
    },
    stop() {
      window.cancelAnimationFrame(frame);
      frame = 0;
    },
  };
});
