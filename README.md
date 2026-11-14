# islandcn-vanilla

A port of [islandcn](https://github.com/opencoredev/islandcn)'s Dynamic Island engine (`lib/island`, the `island-core` registry item, at commit `0011a41`) and its presets (`components/islandcn`) from React to plain TypeScript and DOM calls. No framework, no runtime dependencies.

MIT, copyright (c) 2026 Leo; see `LICENSE`. The glyph data is Hugeicons (MIT, `LICENSE-hugeicons.md`). islandcn copies the look and motion of Apple's island, not its assets, and is not affiliated with Apple.

## Install

```sh
npm install github:designxdevelop/islandcn-vanilla#v0.1.0
```

npm builds `dist/` on install (`prepare`). The output is ES modules with extensionless relative imports, made for a bundler (Vite, esbuild, webpack), not for loading straight into Node or a browser.

## Use

```ts
import { createIsland } from "islandcn-vanilla";

const island = createIsland({ container: document.querySelector("#island")! });
island.start({ id: "saved", compact: { leading: "✓", trailing: "Saved" } });
setTimeout(() => island.end("saved"), 2000);
```

With a preset:

```ts
import { createIsland } from "islandcn-vanilla";
import { mountActivity, UploadActivity } from "islandcn-vanilla/presets";

const island = createIsland({ container });
const upload = mountActivity(island, UploadActivity, { fileName: "report.pdf", progress: 0 });
upload.update({ progress: 0.5 });
upload.unmount();
```

`islandcn-vanilla/presets` is a separate entry, so importing the engine alone leaves the presets out of your bundle.

## Develop

`npm run verify` typechecks, runs the tests and builds.

## What is the original's, unchanged

`choreography`, `clock`, `config`, `devtools`, `frame`, `geometry`, `metrics`, `motion`, `path`, `perf`, `platform`, `skirt`, `spring` and `store` are the original files. `types` differs only in the content type (below). In `surface.ts` the frame loop, the carries and the retarget are the original's line for line; `primitives.ts` keeps the original's poses and timing.

To take a newer islandcn, copy those files over again and re-apply the renderer's changes to `src/surface.ts`: refs become `{ current }` boxes, the `useCallback` wrappers come off, and the render and effects are the code at the top and bottom of `createIslandSurface`.

## What changed with React gone

| React | Here |
| --- | --- |
| `<IslandProvider>` + `<Island />` + `useIsland()` | `createIsland(options)` returns the same API (`start`, `update`, `end`, `expand`, `collapse`, `activities`, `presentation`), plus `subscribe`, `configure`, `reducedMotion`, `element` and `destroy` |
| `<IslandView />` | `createIslandView(container, props)` with `update(props)` |
| `<IslandNumber value />`, `<IslandProgress value />` | `IslandNumber({ value })`, `IslandProgress({ value })` return their element; call its `set(value)` |
| `ReactNode` content | `IslandNode`: text, a number, a DOM node, or a function that returns one |
| Context | The island made last is the default clock and reduced-motion setting for views and primitives; pass `clock` to override |

Two things follow from content being real nodes:

- A node is in one place at a time. The same content often shows in two layers at once (the pill fading out while the split fades in), so a node a new layer needs moves there and leaves a copy in the old one. Pass a function to get a fresh node per place.
- An update with the same node changes nothing. To change content in place, change the node (`set` on the primitives) or pass other content.

## Presets

`src/presets/` is islandcn's `components/islandcn` (the activities and the content kit) with the same JSX, run without React by `presets/runtime.ts`:

- `h` builds real DOM nodes. Each activity update rebuilds its content and `morph` patches it onto the nodes already shown, matching by tag and `key`.
- Activities keep React's hooks (`useState`, `useEffect`, `useRef`, `useMemo`) by call order. Mount one with `mountActivity(island, UploadActivity, props)`; it returns `update(partial)` and `unmount()`.
- Pieces that run on their own timers (a ticking clock, a draining ring, the recording wave) are `stateful`: they keep their node across updates and start and stop as a `MutationObserver` sees them enter and leave the island. For that, `surface.ts` `destroy` takes the layers out before the root leaves the page; keep that on a re-port. `destroy` doesn't unmount activities: call `unmount()` on each, as React would unmount your components.
- The JSX compiles to `h` at build time (`tsconfig.json`), so consumers need no JSX setup.

## Units

The engine works in points and writes pixel values as inline styles, every frame. The CSS the presets inject (`addStyle`) is upstream's, in points too.

`dom.ts` exists so the source also typechecks next to Cloudflare's Workers types, whose `Element.append` shadows the DOM's.
