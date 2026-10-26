import { SourceFile, compile, type Diagnostic, type WorldIR } from '@neurou/core';
import raw from '../../../examples/core-test.nro?raw';

export interface CoreWorld {
  title: string;
  file: string;
  ir: WorldIR;
  diagnostics: Diagnostic[];
  ok: boolean;
}

const result = compile(new SourceFile('examples/core-test.nro', raw));

export const CORE_TEST: CoreWorld = {
  title: '弦测试体',
  file: 'examples/core-test.nro',
  ir: result.ir,
  diagnostics: result.diagnostics.sorted(),
  ok: result.ok,
};
