import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileText } from '@neurou/core';
import { simulate } from '../src/index.js';

const EXAMPLES = join(process.cwd(), 'examples');
const files = readdirSync(EXAMPLES)
  .filter((name) => name.endsWith('.nro') && !name.startsWith('_acceptance'))
  .sort();

describe('examples：所有示例世界都能小规模模拟（v2.17.2）', () => {
  for (const file of files) {
    it(`${file} 模拟不崩`, () => {
      const source = readFileSync(join(EXAMPLES, file), 'utf8');
      const compiled = compileText(source, file);
      if (!compiled.ok) throw new Error(`${file} 编译失败`);
      const result = simulate(compiled.ir, {
        runs: 2,
        maxTicks: 6,
        models: ['random'],
        seed: 1,
      });
      expect(result.runs.length).toBeGreaterThan(0);
      expect(result.health.score).toBeGreaterThanOrEqual(0);
      expect(result.health.score).toBeLessThanOrEqual(100);
    });
  }
});
