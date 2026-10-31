import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../src/gameLoop.js';

describe('FixedStepLoop', () => {
  it('按固定步长推进并消费输入队列', () => {
    const loop = new FixedStepLoop<string>({ stepMs: 10 });
    const seen: Array<string | undefined> = [];
    loop.enqueue('a', 'b');
    const result = loop.advance(25, (input) => seen.push(input));
    expect(result.steps).toBe(2);
    expect(loop.tick).toBe(2);
    expect(seen).toEqual(['a', 'b']);
    expect(loop.pendingInputs).toBe(0);
  });

  it('暂停时不推进，恢复后继续', () => {
    const loop = new FixedStepLoop<void>({ stepMs: 10 });
    loop.pause();
    expect(loop.advance(100, () => undefined).steps).toBe(0);
    loop.resume();
    expect(loop.advance(20, () => undefined).steps).toBe(2);
  });

  it('限制单次补步步数与时间增量', () => {
    const loop = new FixedStepLoop<void>({ stepMs: 10, maxStepsPerAdvance: 3, maxDeltaMs: 50 });
    expect(loop.advance(1000, () => undefined).steps).toBe(3);
    expect(loop.advance(10, () => undefined).steps).toBeGreaterThan(0);
  });

  it('快照包含 tick/暂停/队列，且队列被复制', () => {
    const loop = new FixedStepLoop<string>({ stepMs: 10 });
    loop.enqueue('x');
    loop.pause();
    const snap = loop.snapshot();
    expect(snap.tick).toBe(0);
    expect(snap.paused).toBe(true);
    expect(snap.pending).toEqual(['x']);
    loop.clearInputs();
    expect(loop.pendingInputs).toBe(0);
  });
});
