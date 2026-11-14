import { describe, expect, it } from 'vitest';

import type { IslandClock } from './clock';
import { resolveMotion } from './config';
import { colourLuma, keylineAlphaFor } from './context';
import { islandMetrics } from './metrics';
import { islandMotion } from './motion';
import { solveSpring } from './spring';
import { createIslandStore, deriveScene } from './store';

/** A clock the test moves by hand: timers fire in order as time passes them. */
const manualClock = () => {
  let now = 0;
  let timers: { at: number; run: (due: number) => void }[] = [];
  const clock: IslandClock = {
    now: () => now,
    onFrame: () => () => undefined,
    at(at, run) {
      const timer = { at, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((timer) => timer !== due);
      now = Math.max(now, due.at);
      due.run(due.at);
    }
    now = end;
  };
  return { clock, advance };
};

const makeStore = () => {
  const { clock, advance } = manualClock();
  const motion = resolveMotion();
  const store = createIslandStore({ clock, motion: () => motion });
  return { store, advance, kind: () => deriveScene(store.getSnapshot()).presentation.kind };
};

describe('island store', () => {
  it('goes idle, compact, split and back as activities start and end', () => {
    const { store, kind } = makeStore();
    expect(kind()).toBe('idle');
    const first = store.api.start({ id: 'a', compact: { leading: 'A' } });
    expect(kind()).toBe('compact');
    store.api.start({ id: 'b', compact: { leading: 'B' } });
    expect(kind()).toBe('minimal');
    first.end();
    expect(kind()).toBe('compact');
    store.api.end('b');
    expect(kind()).toBe('idle');
  });

  it('expands for an alert and returns once its hold runs out', () => {
    const { store, advance, kind } = makeStore();
    store.api.start({ id: 'a', compact: { leading: 'A' } });
    store.api.update('a', { compact: { leading: 'B' }, alert: true });
    expect(kind()).toBe('expanded');
    // The update lands in place a moment after the expansion starts.
    advance(islandMotion.alertContentDelay * 1000 + 1);
    expect(store.api.activities[0]?.content.compact?.leading).toBe('B');
    advance(islandMotion.alertHold * 1000 + 1000);
    expect(kind()).toBe('compact');
  });

  it('shows one activity of a group at a time', () => {
    const { store, kind } = makeStore();
    store.api.start({ id: 'a', group: 'app' });
    store.api.start({ id: 'b', group: 'app' });
    expect(kind()).toBe('compact');
    expect(store.api.activities).toHaveLength(2);
  });

  it('turns a held press into an expansion and a quick one into a tap', () => {
    const { store, advance, kind } = makeStore();
    let taps = 0;
    store.api.start({ id: 'a', onPress: () => taps++ });
    store.press('pill');
    advance(20);
    store.release();
    expect(taps).toBe(1);
    expect(kind()).toBe('compact');
    store.press('pill');
    advance(1000);
    expect(kind()).toBe('expanded');
  });
});

describe('island springs', () => {
  it('start where they are and settle on the target', () => {
    const spring = { response: 0.483, dampingFraction: 0.62 };
    // The solver works on the distance left to the target: released one unit short of it, at rest.
    const at = (t: number) => 1 + solveSpring(spring, -1, 0, t).x;
    expect(at(0)).toBeCloseTo(0, 6);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => at(i / 100)))).toBeGreaterThan(1.05);
    expect(at(3)).toBeCloseTo(1, 4);
  });
});

describe('island keyline', () => {
  it('reads luma from hex and rgb()', () => {
    expect(colourLuma('#000')).toBe(0);
    expect(colourLuma('#ffffff')).toBeCloseTo(1, 6);
    expect(colourLuma('rgb(255, 255, 255)')).toBeCloseTo(1, 6);
    expect(colourLuma('rebeccapurple')).toBeNull();
  });

  it('is full over a near-black page and gone over a light one', () => {
    expect(keylineAlphaFor(0, islandMetrics)).toBe(islandMetrics.keyline.alpha);
    // The site's page colour.
    expect(keylineAlphaFor(colourLuma('#06080f') ?? 1, islandMetrics)).toBe(islandMetrics.keyline.alpha);
    expect(keylineAlphaFor(1, islandMetrics)).toBe(0);
    expect(keylineAlphaFor(Number.NaN, islandMetrics)).toBe(0);
  });
});
