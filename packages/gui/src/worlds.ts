import { SourceFile, compile, type Diagnostic, type WorldIR } from '@neurou/core';
import rainRaw from '../../../examples/rain-slice.nro?raw';
import negotiationRaw from '../../../examples/negotiation.nro?raw';

/**
 * 两个示例世界的装载。
 *
 * GUI 不自己发明世界：它读的就是仓库里的 .nro 文件。编译失败时把错误原样
 * 显示出来，而不是假装世界存在。
 */

export type WorldKey = 'rain' | 'negotiation';

export interface WorldBundle {
  key: WorldKey;
  title: string;
  subtitle: string;
  file: string;
  ir: WorldIR;
  diagnostics: Diagnostic[];
  ok: boolean;
}

function load(key: WorldKey, title: string, subtitle: string, file: string, raw: string): WorldBundle {
  const result = compile(new SourceFile(file, raw));
  return {
    key,
    title,
    subtitle,
    file,
    ir: result.ir,
    diagnostics: result.diagnostics.sorted(),
    ok: result.ok,
  };
}

export const WORLDS: Record<WorldKey, WorldBundle> = {
  rain: load('rain', '雨循环的切片', '小调 · 多利亚', 'examples/rain-slice.nro', rainRaw),
  negotiation: load('negotiation', '谈判', '小调', 'examples/negotiation.nro', negotiationRaw),
};

export const WORLD_ORDER: WorldKey[] = ['rain', 'negotiation'];
