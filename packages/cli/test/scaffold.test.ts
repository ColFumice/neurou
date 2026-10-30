import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileProjectFromFiles, compileText } from '@neurou/core';
import { scaffoldProject } from '../src/scaffold.js';

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'neurou-init-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('项目脚手架（v6.18）', () => {
  it('single 模板可编译', () => {
    const dir = temp();
    const result = scaffoldProject('单文件', { template: 'single', out: join(dir, 'world.nro') });
    expect(result.files).toHaveLength(1);
    const compiled = compileText(readFileSync(result.files[0]!, 'utf8'), result.files[0]!);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.ir.name).toBe('单文件');
  });

  it('project 模板多文件可编译并含模块', () => {
    const dir = temp();
    const result = scaffoldProject('多文件', { template: 'project', out: join(dir, 'proj') });
    expect(result.files).toHaveLength(5);
    expect(readFileSync(result.files[4]!, 'utf8')).toContain('neurou check world.nro');
    const files: Record<string, string> = {};
    for (const file of result.files) files[file.replace(/\\/g, '/')] = readFileSync(file, 'utf8');
    const entry = join(result.root, 'world.nro').replace(/\\/g, '/');
    const compiled = compileProjectFromFiles(entry, files);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.ir.strings.some((string) => string.id === '角色.余温')).toBe(true);
    expect(compiled.ir.rules.some((rule) => rule.name === '安抚')).toBe(true);
  });

  it('assets 模板含视觉/音频端口与资源目录', () => {
    const dir = temp();
    const result = scaffoldProject('资源', { template: 'assets', out: join(dir, 'assets') });
    expect(result.files).toHaveLength(4);
    const compiled = compileText(readFileSync(result.files[0]!, 'utf8'), result.files[0]!);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.ir.audioAssets).toHaveLength(1);
    expect(compiled.ir.textureAssets).toHaveLength(1);
    expect(compiled.ir.ports).toHaveLength(2);
  });
});
