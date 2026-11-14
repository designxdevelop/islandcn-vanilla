// What islandcn's presets took from React, as plain DOM code, so their files stay close to the
// originals. There is no virtual DOM and no component tree here:
//
// - `h` is the JSX factory. It makes real DOM nodes, at once. A function "component" is just
//   called, and what it returns is the node.
// - `morph` updates a live node from a freshly built one in place, so an element keeps its CSS
//   transitions through an update.
// - `stateful` is for the few pieces that run on their own (a clock, a ring that drains): they
//   start when their node enters an island and stop when it leaves (`watch`).
// - The hooks at the bottom keep state for one activity function (`mountActivity`), by call order.
//   They do not work inside content; content that needs state uses `stateful`.

import { islandContext, resolveReducedMotion } from "../context";
import type { Island } from "../island";

// ---- The types the presets import from React ----

export type ReactNode = Node | string | number | boolean | null | undefined | readonly ReactNode[];
export type CSSProperties = { [property: string]: string | number | undefined };
// Props are contravariant, so a component of any props fits only a parameter typed `any`.
export type ComponentType<P = any> = (props: P) => ReactNode;
export type MouseEvent = globalThis.MouseEvent;
export type DependencyList = readonly unknown[];

interface DomProps {
  children?: ReactNode;
  key?: string | number;
  style?: CSSProperties;
  className?: string;
  onClick?: (event: globalThis.MouseEvent) => void;
  onPointerDown?: (event: PointerEvent) => void;
  [attribute: string]: unknown;
}

export declare namespace h {
  namespace JSX {
    type Element = Node | null;
    type ElementType = string | ComponentType;
    interface IntrinsicElements {
      [tag: string]: DomProps;
    }
    interface IntrinsicAttributes {
      key?: string | number;
    }
    interface ElementChildrenAttribute {
      children: unknown;
    }
  }
}

// ---- h: JSX to DOM ----

const KEY = Symbol("icn.key");
const HANDLERS = Symbol("icn.handlers");
const STATE = Symbol("icn.state");

type Handlers = Record<string, ((event: Event) => void) | undefined>;

interface Bound {
  kind: string;
  props: unknown;
  instance: Stateful<any>;
  active: boolean;
}

interface Tagged {
  [KEY]?: string | number;
  [HANDLERS]?: Handlers;
  [STATE]?: Bound;
}

const tagged = (node: Node) => node as Node & Tagged;

const svgNs = "http://www.w3.org/2000/svg";
const svgTags = new Set([
  "svg", "g", "defs", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "stop", "linearGradient", "radialGradient",
  "clipPath", "mask", "pattern", "use",
]);
/** SVG attributes that are camelCase in SVG itself. Every other camelCase name is React's spelling of a dashed one. */
const svgCamel = new Set([
  "viewBox", "gradientUnits", "gradientTransform", "patternUnits", "patternTransform", "patternContentUnits", "maskUnits", "maskContentUnits",
  "clipPathUnits", "preserveAspectRatio", "pathLength", "spreadMethod", "textLength", "lengthAdjust",
]);
/** Style properties whose numbers are not lengths, as React treats them. */
const unitless = new Set([
  "animationIterationCount", "aspectRatio", "columnCount", "columns", "flex", "flexGrow", "flexShrink", "flexOrder", "gridArea", "gridRow",
  "gridRowEnd", "gridRowStart", "gridColumn", "gridColumnEnd", "gridColumnStart", "fontWeight", "lineClamp", "lineHeight", "opacity", "order",
  "orphans", "scale", "tabSize", "widows", "zIndex", "zoom", "fillOpacity", "floodOpacity", "stopOpacity", "strokeDasharray", "strokeDashoffset",
  "strokeMiterlimit", "strokeOpacity", "strokeWidth",
]);

const dashed = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** `WebkitMaskImage` to `-webkit-mask-image`; custom properties pass through. */
const cssName = (name: string) => (name.startsWith("--") ? name : dashed(name).replace(/^(webkit|moz|ms)-/, "-$1-"));

const applyStyle = (element: HTMLElement | SVGElement, style: CSSProperties) => {
  for (const [name, value] of Object.entries(style)) {
    if (value === undefined || value === null || value === "") continue;
    const text = typeof value === "number" && value !== 0 && !unitless.has(name) && !name.startsWith("--") ? `${value}px` : `${value}`;
    element.style.setProperty(cssName(name), text);
  }
};

const attributeName = (name: string, svg: boolean) => {
  if (name === "className") return "class";
  if (name === "htmlFor") return "for";
  if (name.includes("-")) return name;
  if (svg) return svgCamel.has(name) ? name : dashed(name);
  return name.toLowerCase();
};

/** One listener per event type per element; it calls whatever handler the element holds now, so `morph` can swap handlers. */
const listen = (element: Element, type: string) => {
  element.addEventListener(type, (event) => tagged(element)[HANDLERS]?.[type]?.(event));
};

const eventType = (prop: string) => (prop === "onDoubleClick" ? "dblclick" : prop.slice(2).toLowerCase());

const appendChildren = (parent: Node, children: ReactNode) => {
  if (children === null || children === undefined || typeof children === "boolean" || children === "") return;
  if (typeof children === "string" || typeof children === "number") parent.appendChild(document.createTextNode(`${children}`));
  else if (children instanceof Node) parent.appendChild(children);
  else for (const child of children) appendChildren(parent, child);
};

/** A component's return as one node: text becomes a text node, a list a fragment. */
const toNode = (value: ReactNode): Node | null => {
  if (value === null || value === undefined || typeof value === "boolean" || value === "") return null;
  if (value instanceof Node) return value;
  if (typeof value === "string" || typeof value === "number") return document.createTextNode(`${value}`);
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, value);
  return fragment;
};

/** `<>...</>`: its children, as a fragment. */
export const Fragment = ({ children }: { children?: ReactNode }): Node => {
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, children);
  return fragment;
};

/** The JSX factory: `<span style={...}>x</span>` is `h("span", { style }, "x")`, and returns the span. */
export function h(tag: string | ComponentType, props: Record<string, unknown> | null, ...children: ReactNode[]): Node | null {
  if (typeof tag === "function") {
    const given = children.length === 0 ? props?.children : children.length === 1 ? children[0] : children;
    const node = toNode(tag({ ...props, children: given }));
    const key = props?.key;
    if (node && (typeof key === "string" || typeof key === "number")) tagged(node)[KEY] = key;
    return node;
  }
  const svg = svgTags.has(tag);
  const element: HTMLElement | SVGElement = svg ? document.createElementNS(svgNs, tag) : document.createElement(tag);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (name === "children") continue;
    if (name === "key") {
      if (typeof value === "string" || typeof value === "number") tagged(element)[KEY] = value;
    } else if (name === "style") {
      if (value) applyStyle(element, value as CSSProperties);
    } else if (/^on[A-Z]/.test(name)) {
      if (typeof value !== "function") continue;
      const type = eventType(name);
      const handlers = (tagged(element)[HANDLERS] ??= {});
      if (!(type in handlers)) listen(element, type);
      handlers[type] = value as (event: Event) => void;
    } else if (value === true) {
      element.setAttribute(attributeName(name, svg), name.startsWith("aria-") ? "true" : "");
    } else if (value === false) {
      if (name.startsWith("aria-")) element.setAttribute(name, "false");
    } else if (value !== null && value !== undefined) {
      element.setAttribute(attributeName(name, svg), `${value}`);
    }
  }
  appendChildren(element, children.length > 0 ? children : (props?.children as ReactNode));
  return element;
}

/** React's `createElement`, which the glyphs call directly. */
export const createElement = h;

let ids = 0;
/** A token unique on the page, for ids that masks and gradients refer to. */
export const useId = () => `i${++ids}`;

/** Whether the island runs reduced motion, read when content is built. */
export const useIslandReducedMotion = () => resolveReducedMotion(islandContext.current?.reducedMotion ?? "user");

const sheets = new Set<string>();
/** Puts a block of CSS in the document head once, however many times it is asked for. */
export const addStyle = (id: string, css: string) => {
  if (sheets.has(id) || typeof document === "undefined") return;
  sheets.add(id);
  const sheet = document.createElement("style");
  sheet.id = `islandcn-${id}`;
  sheet.textContent = css;
  document.head.appendChild(sheet);
};

// ---- stateful: content that runs on its own ----

/** A piece of content with a life of its own. `node` is what it draws and never changes. */
export interface Stateful<P> {
  readonly node: Node;
  /**
   * New props for the same piece, and the node a fresh build with them made (never put in the
   * page; a piece that takes children patches its own node from it). Return false when it can't
   * take them in place: it is then replaced.
   */
  update(props: P, fresh: Node): boolean | void;
  /** Called when the node enters an island: start timers and animation here. */
  start?(): void;
  /** Called when it leaves: stop them. */
  stop?(): void;
}

/** Makes a component out of `setup`. `morph` updates such a piece through `update` and leaves its node alone. */
export const stateful =
  <P,>(kind: string, setup: (props: P) => Stateful<P>) =>
  (props: P): Node => {
    const instance = setup(props);
    tagged(instance.node)[STATE] = { kind, props, instance, active: false };
    return instance.node;
  };

const eachStateful = (node: Node, visit: (bound: Bound, node: Node) => void) => {
  const bound = tagged(node)[STATE];
  if (bound) visit(bound, node);
  for (let child = node.firstChild; child; child = child.nextSibling) eachStateful(child, visit);
};

/** Starts the pieces in `node` that are in the page and stops the ones that are not. */
const settle = (node: Node) =>
  eachStateful(node, (bound, at) => {
    const live = at.isConnected;
    if (live === bound.active) return;
    bound.active = live;
    if (live) bound.instance.start?.();
    else bound.instance.stop?.();
  });

const watched = new WeakSet<Element>();
/**
 * Watches an island for content coming and going: the engine mounts a layer's content when the
 * layer appears (the expanded view, say) and drops it when it has faded, as React mounted and
 * unmounted it. Pieces made by `stateful` start and stop with that.
 */
export const watch = (root: Element) => {
  if (watched.has(root) || typeof MutationObserver === "undefined") return;
  watched.add(root);
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) settle(node);
      for (const node of record.addedNodes) settle(node);
    }
  }).observe(root, { childList: true, subtree: true });
};

// ---- morph: a live node, updated from a new one ----

const sameKind = (live: Node, fresh: Node) => {
  if (live.nodeType !== fresh.nodeType || live.nodeName !== fresh.nodeName) return false;
  if (tagged(live)[KEY] !== tagged(fresh)[KEY]) return false;
  return tagged(live)[STATE]?.kind === tagged(fresh)[STATE]?.kind;
};

const replace = (live: Node, fresh: Node) => {
  live.parentNode?.replaceChild(fresh, live);
  settle(live);
  settle(fresh);
  return fresh;
};

const morphChildren = (live: Node, fresh: Node) => {
  const next = [...fresh.childNodes];
  const byKey = new Map<string | number, Node>();
  for (const child of live.childNodes) {
    const key = tagged(child)[KEY];
    if (key !== undefined) byKey.set(key, child);
  }
  let cursor = live.firstChild;
  for (const child of next) {
    const key = tagged(child)[KEY];
    const match = key === undefined ? cursor : (byKey.get(key) ?? null);
    if (match && sameKind(match, child)) {
      if (match === cursor) cursor = cursor.nextSibling;
      else live.insertBefore(match, cursor);
      morph(match, child);
    } else {
      live.insertBefore(child, cursor);
      settle(child);
    }
  }
  while (cursor) {
    const gone = cursor;
    cursor = cursor.nextSibling;
    live.removeChild(gone);
    settle(gone);
  }
};

/**
 * Makes `live` look like `fresh` and returns the node now in the page: `live`, changed in place,
 * or `fresh` when the two are different kinds of thing (another tag, another key).
 */
export const morph = (live: Node, fresh: Node): Node => {
  if (live === fresh) return live;
  if (!sameKind(live, fresh)) return replace(live, fresh);
  const bound = tagged(live)[STATE];
  const next = tagged(fresh)[STATE];
  if (bound && next) {
    bound.props = next.props;
    return bound.instance.update(next.props, fresh) === false ? replace(live, fresh) : live;
  }
  return patch(live, fresh);
};

/**
 * `morph` without the check that the two are the same kind of thing: the attributes, handlers and
 * children of `fresh`, written onto `live`. A piece made by `stateful` updates its own node with it.
 */
export const patch = (live: Node, fresh: Node): Node => {
  if (live instanceof CharacterData && fresh instanceof CharacterData) {
    if (live.data !== fresh.data) live.data = fresh.data;
    return live;
  }
  if (live instanceof Element && fresh instanceof Element) {
    for (const name of live.getAttributeNames()) if (!fresh.hasAttribute(name)) live.removeAttribute(name);
    for (const name of fresh.getAttributeNames()) {
      const value = fresh.getAttribute(name) ?? "";
      if (live.getAttribute(name) !== value) live.setAttribute(name, value);
    }
    const handlers = tagged(fresh)[HANDLERS];
    if (handlers) {
      const had = (tagged(live)[HANDLERS] ??= {});
      for (const type of Object.keys(handlers)) if (!(type in had)) listen(live, type);
      for (const type of Object.keys(had)) had[type] = handlers[type];
      Object.assign(had, handlers);
    } else if (tagged(live)[HANDLERS]) {
      const had = tagged(live)[HANDLERS] ?? {};
      for (const type of Object.keys(had)) had[type] = undefined;
    }
  }
  morphChildren(live, fresh);
  return live;
};

/**
 * For a piece whose node is another piece's (a clock is a number that ticks): takes hold of the
 * inner piece before the outer one claims the node, so the outer can pass updates, starts and
 * stops through. Call it in `setup`, on the node, before returning.
 */
export const adopt = (node: Node) => {
  const inner = tagged(node)[STATE];
  return {
    /** Shows a fresh build of the inner piece. False when that is another kind of thing. */
    update(fresh: Node): boolean {
      const next = tagged(fresh)[STATE];
      if (inner) return next?.kind === inner.kind && inner.instance.update(next.props, fresh) !== false;
      if (next || fresh.nodeName !== node.nodeName) return false;
      patch(node, fresh);
      return true;
    },
    start: () => inner?.instance.start?.(),
    stop: () => inner?.instance.stop?.(),
  };
};

/** A style object as the text of a `style` attribute, with React's rules for numbers. */
export const styleText = (style: CSSProperties): string => {
  const holder = document.createElement("span");
  applyStyle(holder, style);
  return holder.getAttribute("style") ?? "";
};

// ---- Hooks, for one activity function ----

type Hook =
  | { kind: "state"; value: unknown; set: (next: unknown) => void }
  | { kind: "ref"; ref: { current: unknown } }
  | { kind: "memo"; value: unknown; deps: DependencyList }
  | { kind: "effect"; deps: DependencyList | undefined; cleanup: (() => void) | undefined };

/** One mounted activity function: its hooks by call order, and the island it runs on. */
export interface Scope {
  island: Island;
  hooks: Hook[];
  index: number;
  /** Effects whose deps changed in this run, to run once it has returned. */
  queued: (() => void)[];
  /** A state change asked for another run. */
  dirty: boolean;
  run(): void;
}

let current: Scope | null = null;

const scopeNow = () => {
  if (!current) throw new Error("islandcn: hooks work only inside an activity function run by mountActivity(). Content uses stateful().");
  return current;
};

const sameDeps = (a: DependencyList | undefined, b: DependencyList | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

const hookAt = <H extends Hook>(scope: Scope, kind: H["kind"], make: () => H): { hook: H; made: boolean } => {
  const at = scope.index++;
  const had = scope.hooks[at];
  if (had && had.kind === kind) return { hook: had as H, made: false };
  const hook = make();
  scope.hooks[at] = hook;
  return { hook, made: true };
};

export function useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
  const scope = scopeNow();
  const { hook } = hookAt<Extract<Hook, { kind: "state" }>>(scope, "state", () => {
    const made: Extract<Hook, { kind: "state" }> = {
      kind: "state",
      value: typeof initial === "function" ? (initial as () => T)() : initial,
      set(next) {
        const value = typeof next === "function" ? (next as (previous: unknown) => unknown)(made.value) : next;
        if (Object.is(value, made.value)) return;
        made.value = value;
        // In the middle of a run the run repeats; outside one, the next microtask runs it.
        if (current === scope) scope.dirty = true;
        else if (!scope.dirty) {
          scope.dirty = true;
          queueMicrotask(() => scope.dirty && scope.run());
        }
      },
    };
    return made;
  });
  return [hook.value as T, hook.set as (next: T | ((previous: T) => T)) => void];
}

export function useRef<T>(initial: T): { current: T } {
  const { hook } = hookAt<Extract<Hook, { kind: "ref" }>>(scopeNow(), "ref", () => ({ kind: "ref", ref: { current: initial } }));
  return hook.ref as { current: T };
}

export function useMemo<T>(make: () => T, deps: DependencyList): T {
  const { hook, made } = hookAt<Extract<Hook, { kind: "memo" }>>(scopeNow(), "memo", () => ({ kind: "memo", value: make(), deps }));
  if (!made && !sameDeps(hook.deps, deps)) {
    hook.value = make();
    hook.deps = deps;
  }
  return hook.value as T;
}

export function useEffect(effect: () => void | (() => void), deps?: DependencyList): void {
  const scope = scopeNow();
  const { hook, made } = hookAt<Extract<Hook, { kind: "effect" }>>(scope, "effect", () => ({ kind: "effect", deps: undefined, cleanup: undefined }));
  if (!made && sameDeps(hook.deps, deps)) return;
  hook.deps = deps;
  scope.queued.push(() => {
    hook.cleanup?.();
    hook.cleanup = effect() ?? undefined;
  });
}

/**
 * Runs `build` with no activity in scope. Content is built this way, so a hook called while
 * building content fails loudly instead of landing among the activity's own.
 */
export const outsideScope = <T,>(build: () => T): T => {
  const outer = current;
  current = null;
  try {
    return build();
  } finally {
    current = outer;
  }
};

/** The island an activity function runs on. */
export const useIslandActions = (): Island => scopeNow().island;

/** Runs `component` as the scope's function: hooks line up by call order, effects run after it returns. */
export const runScope = (scope: Scope, component: () => void) => {
  // A state change during the run, or from an effect, runs it again; stop a function that never settles.
  for (let round = 0; round < 25; round += 1) {
    scope.dirty = false;
    scope.index = 0;
    scope.queued = [];
    const outer = current;
    current = scope;
    try {
      component();
    } finally {
      current = outer;
    }
    // Hooks the function did not reach this time are over (a branch that returned early).
    for (const hook of scope.hooks.splice(scope.index)) if (hook.kind === "effect") hook.cleanup?.();
    for (const effect of scope.queued) effect();
    if (!scope.dirty) return;
  }
  throw new Error("islandcn: an activity kept changing its own state.");
};

/** Ends a scope: every effect cleans up, last first. */
export const endScope = (scope: Scope) => {
  for (const hook of scope.hooks.splice(0).reverse()) if (hook.kind === "effect") hook.cleanup?.();
};
