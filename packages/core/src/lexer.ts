import type { DiagnosticBag } from './diagnostics.js';
import { type Position, type SourceFile, type Span } from './source.js';

/**
 * 词法器。
 *
 * 表层是「糖衣」：中文关键字、全角标点容忍、缩进成块。糖衣的目的是让
 * 叙事设计者写出一行接近人话的声明，而不是背诵符号表。
 *
 * 但糖衣之下必须是确定的：任何一行都要能唯一地还原成 token 序列，任何
 * 缩进错误都要能指出是哪一行、差了几格。
 */

export type TokenKind =
  | 'ident'
  | 'number'
  | 'string'
  | 'newline'
  | 'indent'
  | 'dedent'
  | 'punct'
  | 'op'
  | 'arrow'
  | 'eof';

export interface Token {
  kind: TokenKind;
  /** 归一化后的文本（全角标点已转半角，-> 已转 →） */
  text: string;
  value?: string | number;
  span: Span;
}

/** 全角标点 → 半角。只作用于代码，不作用于字符串字面量内部。 */
const FULLWIDTH: Record<string, string> = {
  '：': ':',
  '，': ',',
  '、': ',',
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '｛': '{',
  '｝': '}',
  '；': ';',
  '！': '!',
  '＋': '+',
  '－': '-',
  '＊': '*',
  '／': '/',
  '＝': '=',
  '＜': '<',
  '＞': '>',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '　': ' ',
};

const TWO_CHAR_OPS = new Set(['+=', '-=', '==', '!=', '<=', '>=', '->', '..', '&&', '||']);
const ONE_CHAR_OPS = new Set(['=', '+', '-', '*', '/', '%', '<', '>', '!', '→']);
const PUNCT = new Set([':', ',', '.', '(', ')', '[', ']', '{', '}', ';']);
const ARROWS = new Set(['↑', '↓']);
/** 允许出现在名字里的连接符（全角间隔号、连字符都归一到 _） */
const IDENT_EXTRA = new Set(['_', '·', '＿']);

function isIdentStart(ch: string): boolean {
  return /\p{L}/u.test(ch) || IDENT_EXTRA.has(ch);
}

function isIdentPart(ch: string): boolean {
  return /\p{L}|\p{N}/u.test(ch) || IDENT_EXTRA.has(ch);
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

export function tokenize(source: SourceFile, diagnostics: DiagnosticBag): Token[] {
  const text = source.text;
  const tokens: Token[] = [];
  let i = 0;
  let line = 0;
  let col = 0;
  const indentStack: { width: number; col: number }[] = [{ width: 0, col: 0 }];
  let lineHasToken = false;
  let atLineStart = true;

  const pos = (): Position => ({ line, column: col, offset: i });

  function spanFrom(start: Position): Span {
    return { start, end: pos() };
  }

  function push(kind: TokenKind, start: Position, textOut: string, value?: string | number): void {
    const tok: Token = { kind, text: textOut, span: spanFrom(start) };
    if (value !== undefined) tok.value = value;
    tokens.push(tok);
    lineHasToken = true;
  }

  function advance(n = 1): void {
    for (let k = 0; k < n; k++) {
      if (text[i] === '\n') {
        line++;
        col = 0;
      } else {
        col++;
      }
      i++;
    }
  }

  /** 尝试读取行首缩进；返回 false 表示这一行整体被跳过（空行/注释行）。 */
  function handleLineStart(): boolean {
    const start = i;
    let width = 0;
    let sawSpace = false;
    let sawTab = false;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === ' ') {
        sawSpace = true;
        width += 1;
        advance();
      } else if (ch === '\t') {
        sawTab = true;
        width += 4 - (width % 4);
        advance();
      } else {
        break;
      }
    }
    if (sawSpace && sawTab) {
      diagnostics.error('NRO1001', 'syntax', '这一行的缩进混用了空格和制表符，无法判断层级。', {
        hint: '统一用两个空格缩进—— neurou 的块层级只认缩进。',
        span: { start: { line, column: 0, offset: start }, end: pos() },
        file: source.path,
      });
    }

    // 空行 / 纯注释行：吃掉，不产生 newline，也不影响缩进栈
    if (i >= text.length) return false;
    if (text[i] === '\n') {
      advance();
      return false;
    }
    if (text[i] === '#' || (text[i] === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') advance();
      if (i < text.length) advance();
      return false;
    }

    const top = indentStack[indentStack.length - 1]!;
    if (width > top.width) {
      indentStack.push({ width, col: pos().column });
      const startPos: Position = { line, column: 0, offset: start };
      push('indent', startPos, '');
    } else if (width < top.width) {
      while (indentStack.length > 1 && indentStack[indentStack.length - 1]!.width > width) {
        indentStack.pop();
        const startPos: Position = { line, column: 0, offset: start };
        push('dedent', startPos, '');
      }
      if (indentStack[indentStack.length - 1]!.width !== width) {
        diagnostics.error('NRO1002', 'syntax', '这一行的缩进对不上任何一层块。', {
          hint: '缩进要回到某一层已经出现过的位置，不能停在两层之间。',
          span: { start: { line, column: 0, offset: start }, end: pos() },
          file: source.path,
        });
      }
    }
    atLineStart = false;
    return true;
  }

  while (i < text.length) {
    if (atLineStart) {
      const keepGoing = handleLineStart();
      if (!keepGoing) {
        atLineStart = true;
        lineHasToken = false;
        continue;
      }
      if (i >= text.length) break;
      atLineStart = false;
    }

    const ch = text[i]!;

    if (ch === ' ' || ch === '\t') {
      advance();
      continue;
    }

    if (ch === '\n') {
      if (lineHasToken) {
        const start = pos();
        advance();
        push('newline', start, '\n');
        lineHasToken = false;
      } else {
        advance();
      }
      atLineStart = true;
      continue;
    }

    if (ch === '#' || (ch === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') advance();
      continue;
    }

    // 字符串
    if (ch === '"') {
      const start = pos();
      advance();
      let value = '';
      let closed = false;
      while (i < text.length) {
        const c = text[i]!;
        if (c === '"') {
          advance();
          closed = true;
          break;
        }
        if (c === '\n') break;
        if (c === '\\') {
          const next = text[i + 1];
          if (next === 'n') value += '\n';
          else if (next === 't') value += '\t';
          else if (next === '"') value += '"';
          else if (next === '\\') value += '\\';
          else value += next ?? '';
          advance(2);
          continue;
        }
        value += c;
        advance();
      }
      if (!closed) {
        diagnostics.error('NRO1003', 'syntax', '字符串没有闭合。', {
          hint: '补上结尾的引号。',
          span: spanFrom(start),
          file: source.path,
        });
      }
      push('string', start, value, value);
      continue;
    }

    // 数字
    if (isDigit(ch)) {
      const start = pos();
      let out = '';
      while (i < text.length && isDigit(text[i]!)) {
        out += text[i]!;
        advance();
      }
      if (text[i] === '.' && isDigit(text[i + 1] ?? '')) {
        out += '.';
        advance();
        while (i < text.length && isDigit(text[i]!)) {
          out += text[i]!;
          advance();
        }
      }
      const n = Number(out);
      push('number', start, out, n);
      continue;
    }

    // 名字
    if (isIdentStart(ch)) {
      const start = pos();
      let out = '';
      while (i < text.length && isIdentPart(text[i]!)) {
        const c = text[i]!;
        out += c === '·' || c === '＿' ? '_' : c;
        advance();
      }
      push('ident', start, out);
      continue;
    }

    // 箭头（↑ ↓ 是方向标记，单独一类）
    if (ARROWS.has(ch)) {
      const start = pos();
      advance();
      push('arrow', start, ch);
      continue;
    }

    // 全角 → 半角
    const norm = FULLWIDTH[ch] ?? ch;
    if (norm !== ch) {
      const start = pos();
      advance();
      const two = norm + (FULLWIDTH[text[i] ?? ''] ?? text[i] ?? '');
      if (TWO_CHAR_OPS.has(two)) {
        advance();
        push('op', start, two);
      } else if (PUNCT.has(norm)) {
        push('punct', start, norm);
      } else if (ONE_CHAR_OPS.has(norm)) {
        push('op', start, norm);
      } else {
        push('punct', start, norm);
      }
      continue;
    }

    // 双字符运算符
    const two = text.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      const start = pos();
      advance(2);
      if (two === '->') push('op', start, '→');
      else if (two === '..') push('punct', start, '..');
      else push('op', start, two);
      continue;
    }

    if (PUNCT.has(ch)) {
      const start = pos();
      advance();
      push('punct', start, ch);
      continue;
    }

    if (ONE_CHAR_OPS.has(ch)) {
      const start = pos();
      advance();
      push('op', start, ch);
      continue;
    }

    // 未知字符：报错并跳过，避免死循环
    {
      const start = pos();
      advance();
      diagnostics.error('NRO1004', 'syntax', `无法识别的字符「${ch}」。`, {
        hint: '检查是否误用了中文标点或特殊符号。',
        span: spanFrom(start),
        file: source.path,
      });
    }
  }

  // 收尾：补 newline、清空缩进栈
  if (lineHasToken) {
    push('newline', pos(), '\n');
  }
  while (indentStack.length > 1) {
    indentStack.pop();
    push('dedent', pos(), '');
  }
  push('eof', pos(), '');
  return tokens;
}
