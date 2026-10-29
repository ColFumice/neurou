import { describe, expect, it } from 'vitest';
import { faustFallbackParams } from '../src/faustAudio.js';

describe('Faust WebAudio 兜底参数（v5.28）', () => {
  it('把端口值映射为确定频率与低增益', () => {
    expect(faustFallbackParams([0], 1)).toEqual({ frequency: 110, gain: 0.012 });
    expect(faustFallbackParams([100], 1)).toEqual({ frequency: 330, gain: 0.012 });
    expect(faustFallbackParams([50], 0.5)).toEqual({ frequency: 220, gain: 0.006 });
    expect(faustFallbackParams([], 1)).toEqual({ frequency: 110, gain: 0.012 });
  });
});
