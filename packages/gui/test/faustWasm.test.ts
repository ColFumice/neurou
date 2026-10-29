import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instantiateFaustModuleFromFile, LibFaust, FaustCompiler, FaustMonoDspGenerator } from '@grame/faustwasm/dist/esm/index.js';

describe('真实 Faust 编译（v5.32）', () => {
  it('用 libfaust wasm 编译端口 DSP 源码', async () => {
    const base = join(process.cwd(), 'packages/gui/node_modules/@grame/faustwasm/libfaust-wasm');
    const module = await instantiateFaustModuleFromFile(join(base, 'libfaust-wasm.js'));
    const lib = new LibFaust(module);
    const compiler = new FaustCompiler(lib);
    const generator = new FaustMonoDspGenerator();
    const source = 'import("stdfaust.lib"); p0 = hslider("p0", 0.0, 0.0, 1.0, 0.001); process = no.noise * (p0 * 0.08);';
    const compiled = await generator.compile(compiler, 'NeurouTest', source, '');
    expect(compiled).not.toBeNull();
    expect(generator.getJSON()).toContain('NeurouTest');
  }, 30000);
});
