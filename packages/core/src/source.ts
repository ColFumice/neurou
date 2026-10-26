/**
 * 源文件与位置信息。
 *
 * neurou 的报错要能指回创作者写的那一行——但更重要的是，报错信息本身要
 * 是人话。位置信息是给「引擎盖」用的，不是给默认路径用的。
 */

export interface Position {
  /** 0-based 行号 */
  line: number;
  /** 0-based 列号（以 UTF-16 code unit 计） */
  column: number;
  /** 0-based 字符偏移 */
  offset: number;
}

export interface Span {
  start: Position;
  end: Position;
}

export function makeSpan(start: Position, end: Position): Span {
  return { start, end };
}

export function pointSpan(pos: Position): Span {
  return { start: pos, end: pos };
}

export class SourceFile {
  readonly path: string;
  readonly text: string;
  private readonly lineStarts: number[];

  constructor(path: string, text: string) {
    this.path = path;
    // 统一换行符，保证 offset 与 lexer 看到的一致
    this.text = text.replace(/\r\n?/g, '\n');
    this.lineStarts = [0];
    for (let i = 0; i < this.text.length; i++) {
      if (this.text.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    }
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  positionAt(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return {
      line: lo,
      column: clamped - this.lineStarts[lo]!,
      offset: clamped,
    };
  }

  lineText(line: number): string {
    if (line < 0 || line >= this.lineStarts.length) return '';
    const start = this.lineStarts[line]!;
    const end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1]! - 1 : this.text.length;
    return this.text.slice(start, end);
  }
}
