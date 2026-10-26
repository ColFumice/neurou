import { describe, expect, it } from 'vitest';
import { DiagnosticBag, SourceFile, tokenize } from '../src/index.js';

function lex(src: string) {
  const diags = new DiagnosticBag();
  const tokens = tokenize(new SourceFile('t.nro', src), diags);
  return { tokens, diags };
}

describe('词法', () => {
  it('按缩进发出 indent / dedent', () => {
    const { tokens } = lex('世界 甲\n  版本 一\n');
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual(['ident', 'ident', 'newline', 'indent', 'ident', 'ident', 'newline', 'dedent', 'eof']);
  });

  it('容忍全角标点与全角箭头', () => {
    const { tokens } = lex('回路 甲：信任↓ → 恐惧↑\n');
    expect(tokens.map((t) => t.text)).toContain(':');
    const arrows = tokens.filter((t) => t.kind === 'arrow').map((t) => t.text);
    expect(arrows).toEqual(['↓', '↑']);
    expect(tokens.some((t) => t.kind === 'op' && t.text === '→')).toBe(true);
  });

  it('把 -> 归一化成 →', () => {
    const { tokens } = lex('耦合 甲 -> 乙\n');
    expect(tokens.some((t) => t.kind === 'op' && t.text === '→')).toBe(true);
  });

  it('0..100 解析成数字 / 范围 / 数字', () => {
    const { tokens } = lex('类型 数值 0..100\n');
    expect(tokens.filter((t) => t.kind === 'number').map((t) => t.value)).toEqual([0, 100]);
    expect(tokens.some((t) => t.kind === 'punct' && t.text === '..')).toBe(true);
  });

  it('混用制表符与空格会报缩进错误', () => {
    const { diags } = lex('世界 甲\n \t版本 1\n');
    expect(diags.errors.some((d) => d.code === 'NRO1001')).toBe(true);
  });

  it('未闭合字符串不会死循环', () => {
    const { tokens, diags } = lex('世界 甲\n  描述 "没有结束\n');
    expect(tokens.length).toBeGreaterThan(0);
    expect(diags.errors.some((d) => d.code === 'NRO1003')).toBe(true);
  });
});
