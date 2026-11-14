// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
// layer.tsx without React: the same elements, styles and measurements, built with DOM calls.

import type { IslandMetrics } from "./metrics";
import type { IslandNode, IslandPresentation } from "./types";
import { appendAll } from "./dom";

/** Named DOM nodes inside a layer that the frame loop positions or the renderer measures. */
export type SlotName =
  | "root"
  | "leading"
  | "trailing"
  | "attached"
  | "detached"
  | "splitAttachedLeading"
  | "splitAttachedTrailing"
  | "splitDetachedLeading"
  | "splitDetachedTrailing"
  | "expanded"
  | "expandedClip"
  | "expandedInner"
  | "expandedLeading"
  | "expandedCenter"
  | "expandedTrailing"
  | "expandedBottom";

export type RegisterSlot = (slot: SlotName, element: HTMLElement | null) => void;

interface IslandLayerOptions {
  /** What this layer shows. */
  presentation: IslandPresentation;
  metrics: IslandMetrics;
  /** Width the expanded regions lay out at. */
  expandedWidth: number;
  /** Leaving layers are hidden from assistive tech and can't take focus. */
  leaving: boolean;
}

export interface IslandLayerHandle {
  readonly root: HTMLDivElement;
  /** Shows new options. True when the slots were made anew, false when content changed in place. */
  update(options: IslandLayerOptions): boolean;
  /** Call once the root is in the document: the expanded regions measure themselves then. */
  attach(): void;
  destroy(): void;
}

// Slots start at the stage origin; the frame loop moves them with transforms every frame.
const slotBase = "position:absolute;top:0;left:0;display:flex;align-items:center;will-change:transform, opacity, filter;transform-origin:50% 50%";

// Sizes a region's content at its own width, up to its column's.
const intrinsic = "width:max-content;max-width:100%";
// Space between the expanded regions' columns.
const gap = 10;

const div = (style: string) => {
  const element = document.createElement("div");
  element.style.cssText = style;
  return element;
};

/** What a slot's content draws: nothing, a text node, or the node itself. */
const resolve = (content: IslandNode): Node | null => {
  const value = typeof content === "function" ? content() : content;
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" || typeof value === "number" ? document.createTextNode(`${value}`) : value;
};

/**
 * Puts `content` in `holder`. A node that another place still shows moves here and leaves a copy
 * behind, so a layer fading out keeps what it showed (see `IslandNode`).
 */
const mount = (holder: HTMLElement, content: IslandNode) => {
  const node = resolve(content);
  const from = node?.parentNode;
  // Only out of another island slot: a node that sits in the page itself is simply moved.
  if (node && from && from !== holder && node.parentElement?.closest("[data-islandcn]")) from.replaceChild(node.cloneNode(true), node);
  if (node) holder.replaceChildren(node);
  else holder.replaceChildren();
};

/** One place content goes, and what was last put there. */
interface Holder {
  element: HTMLElement;
  content: IslandNode;
  /** A compact slot's width cap: text there is wrapped so it ends in an ellipsis. */
  fit: number | null;
}

/**
 * Text that outgrows a compact slot ends in an ellipsis instead of being cut by the pill's edge.
 * Other content is clipped at the slot's width (`metrics.compact.maxSlotWidth`).
 */
const mountFitted = (holder: HTMLElement, content: IslandNode, maxWidth: number) => {
  const value = typeof content === "function" ? content() : content;
  if (typeof value !== "string" && typeof value !== "number") {
    mount(holder, value);
    return;
  }
  const span = document.createElement("span");
  span.style.cssText = `display:block;max-width:${maxWidth}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
  span.textContent = `${value}`;
  holder.replaceChildren(span);
};

const place = ({ element, content, fit }: Holder) => {
  if (fit === null) mount(element, content);
  else mountFitted(element, content, fit);
};

type ExpandedPresentation = Extract<IslandPresentation, { kind: "expanded" }>;

const hasBottomOf = (presentation: ExpandedPresentation) => presentation.bottom !== undefined && presentation.bottom !== null;

/** The parts of a presentation that decide which slots exist. Content alone never changes it. */
const structureOf = ({ presentation, metrics, expandedWidth }: IslandLayerOptions) => {
  switch (presentation.kind) {
    case "idle":
      return "idle";
    case "compact":
      return `compact|${metrics.compact.maxSlotWidth}|${metrics.compact.height}`;
    case "minimal":
      return `minimal|${presentation.detached === undefined ? 0 : 1}|${presentation.split ? 1 : 0}|${metrics.minimal.height}`;
    case "expanded":
      return `expanded|${hasBottomOf(presentation) ? 1 : 0}|${expandedWidth}`;
    default: {
      const exhaustive: never = presentation;
      return exhaustive;
    }
  }
};

/** Each holder's content for a presentation, by the holder's name. */
const contentOf = (presentation: IslandPresentation): Record<string, IslandNode> => {
  switch (presentation.kind) {
    case "idle":
      return {};
    case "compact":
      return { leading: presentation.leading, trailing: presentation.trailing };
    case "minimal":
      return {
        attached: presentation.attached,
        detached: presentation.detached,
        splitAttachedLeading: presentation.split?.attached.leading,
        splitAttachedTrailing: presentation.split?.attached.trailing,
        splitDetachedLeading: presentation.split?.detached.leading,
        splitDetachedTrailing: presentation.split?.detached.trailing,
      };
    case "expanded":
      return { leading: presentation.leading, center: presentation.center, trailing: presentation.trailing, bottom: presentation.bottom };
    default: {
      const exhaustive: never = presentation;
      return exhaustive;
    }
  }
};

export const createIslandLayer = (initial: IslandLayerOptions & { register: RegisterSlot }): IslandLayerHandle => {
  const { register } = initial;
  let options: IslandLayerOptions = initial;
  let structure = "";
  let metrics = initial.metrics;
  const holders = new Map<string, Holder>();
  /** The expanded regions' measuring (`buildExpanded`): `start` once the root is in the document, `stop` when rebuilt or gone. */
  const measuring: { start: (() => void) | null; stop: (() => void) | null } = { start: null, stop: null };

  const root = document.createElement("div");
  root.style.cssText = "position:absolute;inset:0";
  register("root", root);

  const slot = (name: SlotName, style: string) => {
    const element = div(style);
    element.setAttribute("data-slot", name);
    register(name, element);
    return element;
  };

  const hold = (name: string, element: HTMLElement, content: IslandNode, fit: number | null = null) => {
    const holder: Holder = { element, content, fit };
    holders.set(name, holder);
    place(holder);
    return element;
  };

  /**
   * The expanded regions. Leading and trailing get equal columns as wide as the wider of the two,
   * so the center region keeps the island's centre line and takes the rest of the row (unless that
   * would cut the center short: then each side keeps its own width). A spanning bottom region
   * (`contain: inline-size`) never widens the side columns.
   *
   * Every region of the top row starts at the row's top: leading and trailing at the padding,
   * center below the sensor. A taller center does not push the sides down (held-out wide-expand:
   * W's 36 pt circle sits at y 32.0 beside a two-line center, the same inset as A's 52 pt square).
   * Content that wants centring brings its own frame, as a SwiftUI region does.
   */
  const buildExpanded = (presentation: ExpandedPresentation) => {
    const e = metrics.expanded;
    const hasBottom = hasBottomOf(presentation);
    // ActivityKit puts the center region below the sensor: its top is the sensor's bottom edge.
    const sensorBottom = metrics.top + metrics.idle.height;
    const centerTop = Math.max(0, sensorBottom - (e.top + e.padding.top)) + e.centerTop;
    const centerShift = ((e.padding.trailing ?? e.padding.side) - e.padding.side) / 2;
    // Each region moves on its own while the shape morphs (content follows the container).
    // No will-change here: a layer per region would snap to device pixels on top of the slot's
    // own snap and land the content a third of a point high.
    const region = "min-width:0;transform-origin:50% 50%";

    // The content clip sits inside the layer's blur, so the blur softens the clip's cut too.
    const clip = slot("expandedClip", "position:absolute;inset:0");
    const expanded = slot(
      "expanded",
      `${slotBase};display:block;width:${options.expandedWidth}px;box-sizing:border-box;padding:${e.padding.top}px ${e.padding.trailing ?? e.padding.side}px ${e.padding.bottom}px ${e.padding.side}px;transform-origin:50% 0`,
    );
    const inner = div(
      `display:grid;grid-template-columns:max-content minmax(0, 1fr) max-content;grid-template-areas:${hasBottom ? '"leading center trailing" "bottom bottom bottom"' : '"leading center trailing"'};column-gap:${gap}px;row-gap:${hasBottom ? e.rowGap : 0}px;align-items:start`,
    );
    register("expandedInner", inner);

    const leadingRegion = div(`${region};grid-area:leading`);
    register("expandedLeading", leadingRegion);
    const leading = hold("leading", div(intrinsic), presentation.leading);
    appendAll(leadingRegion, leading);

    // The center region sits below the sensor, top-aligned, centred on the island: not on the
    // content between unequal side paddings (round 23: the title sat 0.16 to 0.34 pt right of the
    // simulator's with the trailing inset 17.81).
    const centerRegion = div(
      `${region};grid-area:center;align-self:start;position:relative;left:${centerShift}px;padding-top:${centerTop}px;display:flex;justify-content:center;text-align:center`,
    );
    register("expandedCenter", centerRegion);
    const center = hold("center", div(intrinsic), presentation.center);
    appendAll(centerRegion, center);

    const trailingRegion = div(`${region};grid-area:trailing;justify-self:end`);
    register("expandedTrailing", trailingRegion);
    const trailing = hold("trailing", div(intrinsic), presentation.trailing);
    appendAll(trailingRegion, trailing);

    appendAll(inner, leadingRegion, centerRegion, trailingRegion);
    if (hasBottom) {
      const bottom = div(`${region};grid-area:bottom;padding-inline:${e.bottomInset}px;contain:inline-size`);
      register("expandedBottom", bottom);
      hold("bottom", bottom, presentation.bottom);
      appendAll(inner, bottom);
    }
    appendAll(expanded, inner);
    appendAll(clip, expanded);
    appendAll(root, clip);

    // Null until measured: the first layout gives each side its own content width.
    let columns: string | null = null;
    // Each wrapper's own max-content width, read with its cap lifted (a capped wrapper would
    // never report text that grew, after a font loads for instance).
    const natural = (element: HTMLElement) => {
      const cap = element.style.maxWidth;
      element.style.maxWidth = "none";
      // The used width: fractional (a column a fraction narrower than its text ellipsizes it) and
      // untransformed (regions scale while they come in).
      const width = Number.parseFloat(getComputedStyle(element).width) || 0;
      element.style.maxWidth = cap;
      return Math.ceil(width) + 1;
    };
    const measure = () => {
      const l = natural(leading);
      const t = natural(trailing);
      const c = natural(center);
      const room = inner.clientWidth - 2 * gap;
      const side = Math.max(l, t);
      // Equal sides keep the center on the island's centre line. When that would squeeze the
      // center below its own width, each side keeps its own width and the center takes the rest.
      const next = c + 2 * side <= room ? `${side}px minmax(0, 1fr) ${side}px` : `${l}px minmax(0, 1fr) ${t}px`;
      if (columns === next) return;
      columns = next;
      inner.style.gridTemplateColumns = next;
    };

    measuring.start = () => {
      measuring.start = null;
      measure();
      let live = true;
      void document.fonts?.ready.then(() => {
        if (live) measure();
      });
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
      for (const element of [inner, leading, center, trailing]) observer?.observe(element);
      measuring.stop = () => {
        live = false;
        observer?.disconnect();
      };
    };
  };

  const build = () => {
    measuring.stop?.();
    measuring.stop = null;
    measuring.start = null;
    holders.clear();
    root.replaceChildren();
    const { presentation } = options;
    switch (presentation.kind) {
      case "idle":
        break;
      case "compact": {
        const max = metrics.compact.maxSlotWidth;
        // Clipped across only, so rings and glows can still spill a little above and below.
        const style = `${slotBase};height:${metrics.compact.height}px;max-width:${max}px;overflow-x:clip`;
        appendAll(root, hold("leading", slot("leading", style), presentation.leading, max), hold("trailing", slot("trailing", style), presentation.trailing, max));
        break;
      }
      case "minimal": {
        const box = `${slotBase};height:${metrics.minimal.height}px`;
        const split = presentation.split;
        // Both layouts are built; the frame loop shows the split when it fits and `minimal` otherwise.
        appendAll(root, hold("attached", slot("attached", box), presentation.attached));
        if (presentation.detached !== undefined) appendAll(root, hold("detached", slot("detached", box), presentation.detached));
        if (split) {
          appendAll(root, 
            hold("splitAttachedLeading", slot("splitAttachedLeading", box), split.attached.leading),
            hold("splitAttachedTrailing", slot("splitAttachedTrailing", box), split.attached.trailing),
            hold("splitDetachedLeading", slot("splitDetachedLeading", box), split.detached.leading),
            hold("splitDetachedTrailing", slot("splitDetachedTrailing", box), split.detached.trailing),
          );
        }
        break;
      }
      case "expanded":
        buildExpanded(presentation);
        break;
      default: {
        const exhaustive: never = presentation;
        return exhaustive;
      }
    }
    // Read through a call: the assignments above happen in `buildExpanded`, out of the checker's sight.
    if (root.isConnected) attach();
  };

  const attach = () => measuring.start?.();

  /** The root's own attributes, which follow the kind and whether the layer is leaving. */
  const dress = () => {
    const { presentation, leaving } = options;
    root.setAttribute("data-layer", presentation.kind);
    if (leaving) root.setAttribute("aria-hidden", "true");
    else root.removeAttribute("aria-hidden");
    root.inert = leaving;
    root.style.pointerEvents = presentation.kind === "expanded" && !leaving ? "auto" : "none";
  };

  const apply = (next: IslandLayerOptions) => {
    const previous = options;
    options = next;
    dress();
    const nextStructure = structureOf(next);
    if (nextStructure !== structure || next.metrics !== metrics) {
      // Slots registered before and not built again are gone.
      const names: SlotName[] = [
        "leading",
        "trailing",
        "attached",
        "detached",
        "splitAttachedLeading",
        "splitAttachedTrailing",
        "splitDetachedLeading",
        "splitDetachedTrailing",
        "expanded",
        "expandedClip",
        "expandedInner",
        "expandedLeading",
        "expandedCenter",
        "expandedTrailing",
        "expandedBottom",
      ];
      if (structure !== "") for (const name of names) register(name, null);
      structure = nextStructure;
      metrics = next.metrics;
      build();
      return true;
    }
    if (previous.presentation === next.presentation) return false;
    // The same slots: only content that is another value is put in again, so a node passed again
    // keeps its place and whatever it is in the middle of.
    const contents = contentOf(next.presentation);
    for (const [name, holder] of holders) {
      const content = contents[name];
      if (content === holder.content) continue;
      holder.content = content;
      place(holder);
    }
    return false;
  };

  apply(initial);

  return {
    root,
    update: apply,
    attach,
    destroy() {
      measuring.stop?.();
      measuring.stop = null;
      measuring.start = null;
    },
  };
};
