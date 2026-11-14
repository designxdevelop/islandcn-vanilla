// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
// use-activity.ts without React: the same `useActivity` and `useLatest`, run by `mountActivity`.

import type { Island } from "../island";
import type { ActivityContent, ActivityOptions, ActivityUpdate, IslandNode } from "../types";
import { type DependencyList, endScope, morph, outsideScope, runScope, type Scope, useEffect, useIslandActions, useMemo, useRef, watch } from "./runtime";

/** What `useActivity` hands back: ways to poke the activity it owns. */
export interface ActivityControls {
  readonly id: string;
  /** Expands the activity briefly, then settles back, like an alerting update. */
  alert(): void;
  /** Expands the activity and holds it until a press outside or `collapse()`. */
  expand(): void;
  collapse(): void;
}

/** The node each slot shows now, so the next build updates it in place instead of replacing it. */
type Roots = Map<string, IslandNode>;

/**
 * One slot's content for the engine. A node the slot already shows is changed in place (`morph`)
 * and handed over again as the same node, which the engine leaves where it is. A list of nodes
 * goes in one wrapper that takes no box of its own.
 */
const rootFor = (roots: Roots, seen: Set<Node>, slot: string, value: IslandNode): IslandNode => {
  let next = typeof value === "function" ? value() : value;
  if (next instanceof DocumentFragment) {
    const group = document.createElement("span");
    group.style.display = "contents";
    group.appendChild(next);
    next = group;
  }
  // A node is in one place at a time. The same one given to two slots is copied for the second;
  // build it twice to keep what a copy loses (handlers, anything that runs on its own).
  if (next instanceof Node && seen.has(next)) next = next.cloneNode(true);
  if (next instanceof Node) seen.add(next);
  const previous = roots.get(slot);
  const result = previous instanceof Node && next instanceof Node ? morph(previous, next) : next;
  roots.set(slot, result);
  return result;
};

/** An activity's content with every slot settled through `rootFor`. */
const settled = (roots: Roots, content: ActivityContent): ActivityContent => {
  const seen = new Set<Node>();
  const at = (slot: string, value: IslandNode) => rootFor(roots, seen, slot, value);
  return {
    compact: content.compact && { leading: at("compact.leading", content.compact.leading), trailing: at("compact.trailing", content.compact.trailing) },
    minimal: at("minimal", content.minimal),
    expanded: content.expanded && {
      leading: at("expanded.leading", content.expanded.leading),
      center: at("expanded.center", content.expanded.center),
      trailing: at("expanded.trailing", content.expanded.trailing),
      bottom: at("expanded.bottom", content.expanded.bottom),
    },
  };
};

/**
 * Binds one activity to an activity function's lifetime: starts it when the function is mounted,
 * updates it when `deps` change, and ends it (with the dismiss motion) when the function is
 * unmounted or stops calling this. Changing the id ends the old activity and starts a new one.
 *
 * `build` runs only when `deps` change, so content isn't rebuilt on every island change. Keep
 * callbacks the content calls in a ref (see `useLatest`), not in `deps`.
 */
export const useActivity = (build: () => ActivityOptions, deps: DependencyList): ActivityControls => {
  const island = useIslandActions();
  const options = useMemo(() => outsideScope(build), deps);
  const id = options.id;
  const roots = useRef<Roots>(new Map());

  useEffect(() => {
    roots.current = new Map();
    island.start({ ...options, ...settled(roots.current, options) });
    return () => island.end(id);
  }, [island, id]);

  // Also runs right after the start above; an update with the same content is cheap.
  useEffect(() => {
    const { id: _id, alert: _alert, ...content } = options;
    const update: ActivityUpdate = { ...content, ...settled(roots.current, content) };
    island.update(id, update);
  }, [island, id, options]);

  return useMemo(
    () => ({
      id,
      alert: () => island.update(id, { alert: true }),
      expand: () => island.expand(id),
      collapse: () => island.collapse(),
    }),
    [island, id],
  );
};

/** A ref that always holds the latest value, for callbacks inside island content. */
export const useLatest = <T,>(value: T) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

/** A mounted activity: what rendering a preset component gave in React. */
export interface MountedActivity<P> {
  /** New props, merged over the last ones, as a re-render with them. */
  update(props: Partial<P>): void;
  /** Ends the activity with the dismiss motion and stops everything it started. */
  unmount(): void;
}

/**
 * Runs a preset on an island: `mountActivity(island, UploadActivity, { fileName, progress })`
 * is `<UploadActivity fileName progress />` inside the provider. `update` is a render with new
 * props and `unmount` is the component going away.
 */
export const mountActivity = <P extends object>(island: Island, activity: (props: P) => unknown, initial: P): MountedActivity<P> => {
  let props = initial;
  let mounted = true;
  watch(island.element);
  const scope: Scope = {
    island,
    hooks: [],
    index: 0,
    queued: [],
    dirty: false,
    run: () => {
      if (mounted) runScope(scope, () => activity(props));
    },
  };
  scope.run();
  return {
    update(next) {
      props = { ...props, ...next };
      scope.run();
    },
    unmount() {
      mounted = false;
      endScope(scope);
    },
  };
};
