import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileProject, compileText } from '../src/index.js';

const root = process.cwd();

describe('资源资产文件完整性（v5.31）', () => {
  it('示例世界引用的音频/纹理资产都存在', () => {
    const files = ['examples/garden.nro', 'examples/harbor.nro', 'examples/soundscape.nro', 'examples/texture-rain.nro'];
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      const result = /^\s*引入\s+/m.test(source)
        ? compileProject(file, (path) => readFileSync(join(root, path), 'utf8'))
        : compileText(source, file);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const asset of [...(result.ir.audioAssets ?? []), ...(result.ir.textureAssets ?? [])]) {
        if (!existsSync(join(root, asset.src))) missing.push(`${file}: ${asset.src}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
