import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileText } from '../src/index.js';

const EXAMPLES = join(process.cwd(), 'examples');

describe('examples：所有示例世界都能编译（v2.17.1）', () => {
  const files = readdirSync(EXAMPLES)
    .filter((name) => name.endsWith('.nro') && !name.startsWith('_acceptance'))
    .sort();

  it('至少包含核心示例', () => {
    expect(files).toEqual(expect.arrayContaining(['tuner.nro', 'spectra.nro', 'relations.nro', 'moon-tide.nro', 'lighthouse.nro']));
  });

  for (const file of files) {
    it(`${file} 编译无错误`, () => {
      const source = readFileSync(join(EXAMPLES, file), 'utf8');
      const result = compileText(source, file);
      if (!result.ok) {
        throw new Error(`${file}: ${result.diagnostics.errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
      }
      expect(result.ok).toBe(true);
    });
  }
});
