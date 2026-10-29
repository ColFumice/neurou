import type {
  ActionDecl,
  AudioAssetDecl,
  AxiomDecl,
  BgmDecl,
  ChordDecl,
  CouplingDecl,
  CueAst,
  Decl,
  DomainAst,
  EffectAst,
  EndingDecl,
  EntityDecl,
  Expr,
  ForcingDecl,
  FormDecl,
  LoopDecl,
  LoopEdgeAst,
  MatrixDecl,
  MatrixCurveAst,
  PhaseAst,
  Program,
  ResponseCurve,
  SceneDecl,
  SignalDecl,
  SpectrumDecl,
  PortDecl,
  PortParam,
  NamespaceDecl,
  StringDecl,
  StringKind,
  SystemDecl,
  SystemPhase,
  WorldDecl,
} from './ast.js';
import { SYSTEM_PHASES } from './ast.js';
import { DECL_KEYWORDS, STRING_KEYWORDS, isStringKeyword } from './ast.js';
import { type DiagnosticBag } from './diagnostics.js';
import { tokenize, type Token } from './lexer.js';
import { suggestName } from './suggest.js';
import { type SourceFile, type Span } from './source.js';

class ParseError extends Error {}

const RESPONSE_CURVES: ResponseCurve[] = ['线性', '缓入', '缓出', '阶跃'];

const SPECTRUM_INTERPOLATIONS: readonly string[] = ['线性', '平滑', '阶跃'];
const SPECTRUM_MODES: readonly string[] = ['固定', '受迫'];
const SPECTRUM_ARTICULATIONS: readonly string[] = ['拨弦', '持续'];

/**
 * 递归下降解析器，按缩进分块。
 *
 * 设计取舍：语法糖必须「一颗糖对应一个叙事模式」。所以每一种声明都直接
 * 对应弦网络里的一个节点/边，不存在只能靠位置理解的隐式语义。
 */
class Parser {
  private readonly tokens: Token[];
  private idx = 0;

  constructor(
    private readonly source: SourceFile,
    private readonly diagnostics: DiagnosticBag,
  ) {
    this.tokens = tokenize(source, diagnostics);
  }

  // ---------- 基础 ----------

  private peek(k = 0): Token {
    const at = Math.min(this.idx + k, this.tokens.length - 1);
    return this.tokens[at]!;
  }

  private at(kind: Token['kind'], text?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (text === undefined || t.text === text);
  }

  private atIdent(text: string): boolean {
    return this.at('ident', text);
  }

  private atLineEnd(): boolean {
    const t = this.peek();
    return t.kind === 'newline' || t.kind === 'dedent' || t.kind === 'eof';
  }

  private advance(): Token {
    const t = this.peek();
    if (this.idx < this.tokens.length - 1) this.idx++;
    return t;
  }

  private eat(kind: Token['kind'], text?: string): boolean {
    if (this.at(kind, text)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(kind: Token['kind'], text: string | undefined, what: string): Token {
    if (this.at(kind, text)) return this.advance();
    const t = this.peek();
    this.fail(`这里需要${what}，但读到了「${t.text || t.kind}」。`, t.span);
    throw new ParseError('unreachable');
  }

  private fail(message: string, span: Span, hint?: string): void {
    this.diagnostics.error('NRO1100', 'syntax', message, { span, hint, file: this.source.path });
  }

  private spanFrom(start: Token): Span {
    const prev = this.tokens[Math.max(0, this.idx - 1)]!;
    return { start: start.span.start, end: prev.span.end };
  }

  /** 声明块的真实内容终点：跳过尾部空行/注释产生的 dedent/newline token。 */
  private contentEnd(): Span['end'] {
    let i = this.idx - 1;
    while (i >= 0) {
      const kind = this.tokens[i]?.kind;
      if (kind === 'newline' || kind === 'indent' || kind === 'dedent' || kind === 'eof') {
        i -= 1;
        continue;
      }
      return this.tokens[i]!.span.end;
    }
    return this.tokens[0]!.span.end;
  }

  private finishLine(): void {
    if (this.at('newline')) {
      this.advance();
      return;
    }
    if (this.at('dedent') || this.at('eof')) return;
    const t = this.peek();
    this.fail(`这一行到这里应该结束了，但多出了「${t.text}」。`, t.span, '是不是漏了换行，或者多打了一个逗号？');
    this.skipToLineEnd();
  }

  private skipToLineEnd(): void {
    while (!this.atLineEnd()) this.advance();
    if (this.at('newline')) this.advance();
  }

  private skipNewlines(): void {
    while (this.at('newline')) this.advance();
  }

  private enterBlock(what: string): boolean {
    if (!this.at('indent')) return false;
    this.advance();
    const t = this.peek();
    if (t.kind === 'dedent') {
      this.fail(`${what}是空的。`, t.span);
      this.advance();
      return false;
    }
    return true;
  }

  private exitBlock(): void {
    if (this.at('dedent')) this.advance();
  }

  private recoverTopLevel(): void {
    let depth = 0;
    while (!this.at('eof')) {
      if (this.at('indent')) {
        depth++;
        this.advance();
      } else if (this.at('dedent')) {
        if (depth > 0) depth--;
        this.advance();
      } else if (this.at('newline')) {
        this.advance();
        if (depth === 0) return;
      } else {
        this.advance();
      }
    }
  }

  private suggest(word: string, candidates: readonly string[]): string | undefined {
    let best: string | undefined;
    let bestDist = Infinity;
    for (const c of candidates) {
      const d = levenshtein(word, c);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best && bestDist <= Math.max(1, Math.floor(word.length / 2))) return best;
    return undefined;
  }

  // ---------- 程序 ----------

  parseProgram(): Program {
    const start = this.peek();
    const decls: Decl[] = [];
    this.skipNewlines();
    let guardIdx = -1;
    while (!this.at('eof')) {
      // 保证循环一定前进：任何一次迭代都必须吃掉至少一个 token。
      // 否则一处恢复逻辑的疏漏就会变成死循环。
      if (this.idx === guardIdx) this.advance();
      guardIdx = this.idx;

      // 顶层不应该出现 dedent；出现说明上一段块少消费了一层，安全地吃掉它。
      while (this.at('dedent')) this.advance();
      if (this.at('eof')) break;

      if (this.at('indent')) {
        const t = this.advance();
        this.fail('这里多了一层缩进，但没有可以属于它的声明。', t.span);
        this.skipBlock();
        this.skipNewlines();
        continue;
      }
      try {
        const d = this.parseDecl();
        if (d) decls.push(d);
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        this.recoverTopLevel();
      }
      this.skipNewlines();
    }
    return { decls, span: { start: start.span.start, end: this.peek().span.end } };
  }

  private skipBlock(): void {
    if (!this.at('indent')) return;
    let depth = 0;
    while (!this.at('eof')) {
      if (this.at('indent')) {
        depth++;
        this.advance();
      } else if (this.at('dedent')) {
        depth--;
        this.advance();
        if (depth === 0) return;
      } else {
        this.advance();
      }
    }
  }

  private parseDecl(): Decl | undefined {
    const t = this.peek();
    if (t.kind !== 'ident') {
      this.fail(`一行声明应该以关键字开头，但读到了「${t.text}」。`, t.span, '例如「叙事弦 信任」「力迫 背叛」。');
      this.skipToLineEnd();
      return undefined;
    }
    const kw = t.text;

    if (kw === '世界') return this.parseWorld();
    if (kw === '实体') return this.parseEntity();
    if (kw === '谱') return this.parseSpectrum();
    if (kw === '关系谱') return this.parseMatrix();
    if (kw === '音频资产') return this.parseAudioAsset();
    if (kw === '配乐') return this.parseBgm();
    if (kw === '系统') return this.parseSystem();
    if (kw === '场景') return this.parseScene();
    if (kw === '视觉端口') return this.parsePort('视觉');
    if (kw === '音频端口') return this.parsePort('音频');
    if (kw === '命名空间') return this.parseNamespace();
    if (isStringKeyword(kw)) return this.parseStringDecl(STRING_KEYWORDS[kw]!, undefined);
    if (kw === '耦合') return this.parseCoupling();
    if (kw === '回路') return this.parseLoop();
    if (kw === '力迫') return this.parseForcing();
    if (kw === '和弦') return this.parseChord();
    if (kw === '公理') return this.parseAxiom();
    if (kw === '信号') return this.parseSignal();
    if (kw === '动作') return this.parseAction();
    if (kw === '曲式') return this.parseForm();
    if (kw === '结局') return this.parseEnding();

    const hint = this.suggest(kw, DECL_KEYWORDS);
    this.fail(
      `不认识「${kw}」这个声明。`,
      t.span,
      hint ? `你是不是想写「${hint}」？` : '可用的声明有：世界、实体、七类弦、谱、关系谱、耦合、回路、力迫、和弦、公理、信号、动作、曲式、结局。',
    );
    this.skipToLineEnd();
    return undefined;
  }

  // ---------- 世界 ----------

  /** v3.7：音频资产声明。路径校验在编译器（只允许 audio/ 下的一层音频文件）。 */
  private parseAudioAsset(): AudioAssetDecl {
    const start = this.advance(); // 关键字
    const name = this.readQualifiedName('音频资产名');
    const src = this.readString('音频路径');
    this.finishLine();
    return { k: 'audio-asset', name, src, span: this.spanFrom(start) };
  }

  /** v5.1：系统是运行层调度单元，不是弦。 */
  private parseSystem(): SystemDecl {
    const start = this.advance();
    const name = this.readQualifiedName('系统名');
    const decl: SystemDecl = {
      k: 'system',
      name,
      phase: '规则',
      every: true,
      effects: [],
      span: this.spanFrom(start),
    };
    this.finishLine();
    if (this.enterBlock('系统声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const key = this.readName('字段名');
        switch (key) {
          case '阶段': {
            const phase = this.readName('系统阶段');
            if (!(SYSTEM_PHASES as readonly string[]).includes(phase)) {
              this.fail(`系统阶段「${phase}」无效。`, this.peek().span, `可用：${SYSTEM_PHASES.join('、')}。`);
            } else {
              decl.phase = phase as SystemPhase;
            }
            this.finishLine();
            break;
          }
          case '每拍':
            decl.every = true;
            this.finishLine();
            break;
          case '当':
            decl.guard = this.parseExpr();
            this.finishLine();
            break;
          case '效果':
            if (!this.atLineEnd()) {
              decl.effects.push(this.parseEffect());
              this.finishLine();
            } else {
              this.finishLine();
              this.parseEffectBlock(decl.effects);
            }
            break;
          default:
            this.fail(`系统里不认识「${key}」。`, this.peek().span, '可用：阶段、每拍、当、效果。');
            this.skipToLineEnd();
        }
      }
      this.exitBlock();
    }
    if (decl.effects.length === 0) {
      this.fail(`系统「${name}」没有效果。`, decl.span, '系统是「每拍在某个阶段做一件事」，至少写一个效果。');
    }
    return decl;
  }

  /** v5.1：场景只启用系统 + 进入/离开效果，不拥有弦。 */
  private parseScene(): SceneDecl {
    const start = this.advance();
    const name = this.readQualifiedName('场景名');
    const decl: SceneDecl = {
      k: 'scene',
      name,
      systems: [],
      enter: [],
      exit: [],
      span: this.spanFrom(start),
    };
    this.finishLine();
    if (this.enterBlock('场景声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const key = this.readName('字段名');
        if (key === '启用') {
          if (this.atIdent('系统')) this.advance();
          decl.systems.push(this.readQualifiedName('系统名'));
          this.finishLine();
        } else if (key === '进入' || key === '离开') {
          this.finishLine();
          this.parseEffectBlock(key === '进入' ? decl.enter : decl.exit);
        } else {
          this.fail(`场景里不认识「${key}」。`, this.peek().span, '可用：启用 系统、进入、离开。');
          this.skipToLineEnd();
        }
      }
      this.exitBlock();
    }
    return decl;
  }

  /** v5.6：后端端口；参数绑定到已有弦，不创造新状态。 */
  private parsePort(kind: '视觉' | '音频'): PortDecl {
    const start = this.advance();
    const name = this.readQualifiedName('端口名');
    const decl: PortDecl = { k: 'port', kind, name, params: [], span: this.spanFrom(start) };
    this.finishLine();
    if (this.enterBlock('端口声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const key = this.readName('字段名');
        if (key === '参数') {
          const paramStart = this.peek();
          const param: PortParam = {
            name: this.readName('参数名'),
            string: this.readPath('绑定的弦').join('.'),
            span: this.spanFrom(paramStart),
          };
          decl.params.push(param);
          this.finishLine();
        } else {
          this.fail(`端口里不认识「${key}」。`, this.peek().span, '可用：参数 <参数名> <弦名>。');
          this.skipToLineEnd();
        }
      }
      this.exitBlock();
    }
    if (decl.params.length === 0) {
      this.fail(`端口「${name}」没有参数。`, decl.span, '端口至少要绑定一根弦，例如「参数 强度 雨量」。');
    }
    return decl;
  }

  /** v5.11/v5.12：命名空间；v5.12 起接纳除世界/嵌套命名空间外的全部声明。 */
  private parseNamespace(): NamespaceDecl {
    const start = this.advance();
    const name = this.readName('命名空间名');
    const decls: Decl[] = [];
    this.finishLine();
    if (this.enterBlock('命名空间')) {
      while (!this.at('dedent') && !this.at('eof')) {
        this.skipNewlines();
        if (this.at('eof') || this.at('dedent')) break;
        if (this.at('indent')) {
          const token = this.advance();
          this.fail('命名空间里多了一层缩进。', token.span);
          this.skipBlock();
          this.skipNewlines();
          continue;
        }
        try {
          const decl = this.parseDecl();
          if (!decl) continue;
          if (decl.k === 'world' || decl.k === 'namespace') {
            this.fail(`命名空间「${name}」里不能声明 ${decl.k === 'world' ? '世界' : '嵌套命名空间'}。`, decl.span);
          } else {
            decls.push(decl);
          }
        } catch (error) {
          if (!(error instanceof ParseError)) throw error;
          this.recoverTopLevel();
        }
        this.skipNewlines();
      }
      this.exitBlock();
    }
    if (decls.length === 0) {
      this.fail(`命名空间「${name}」里没有声明。`, start.span);
    }
    return { k: 'namespace', name, decls, span: this.spanFrom(start) };
  }

  /** v3.8：单行配乐声明：`配乐 雨幕 音量 0.25 循环 是`。 */
  private parseBgm(): BgmDecl {
    const start = this.advance(); // 关键字
    const asset = this.readQualifiedName('配乐资产名');
    let volume = 0.35;
    let loop = true;
    while (!this.at('newline') && !this.at('eof')) {
      if (this.atIdent('音量')) {
        this.advance();
        volume = this.readNumber('配乐音量');
      } else if (this.atIdent('循环')) {
        this.advance();
        if (this.atIdent('是') || this.atIdent('真')) {
          this.advance();
          loop = true;
        } else if (this.atIdent('否') || this.atIdent('假')) {
          this.advance();
          loop = false;
        } else {
          this.fail(`「循环」只能写「是」或「否」，但读到了「${this.peek().text}」。`, this.peek().span);
          this.skipToLineEnd();
          break;
        }
      } else {
        this.fail(`「配乐」里不认识「${this.peek().text}」。`, this.peek().span, '可用：音量、循环。');
        this.skipToLineEnd();
        break;
      }
    }
    this.finishLine();
    return { k: 'bgm', asset, volume, loop, span: this.spanFrom(start) };
  }

  private parseWorld(): WorldDecl {
    const start = this.expect('ident', '世界', '「世界」');
    const name = this.readName('世界名');
    this.finishLine();
    const meta: { key: string; value: string | number }[] = [];

    if (this.enterBlock('世界声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const key = this.readName('字段名');
        if (key === '版本' || key === '种子') {
          const v = this.peek();
          if (v.kind === 'number') {
            this.advance();
            meta.push({ key, value: v.value as number });
          } else {
            meta.push({ key, value: this.readName('值') });
          }
        } else if (key === '调性') {
          const words: string[] = [];
          while (!this.atLineEnd()) {
            const v = this.peek();
            if (v.kind === 'string') {
              words.push(v.value as string);
              this.advance();
            } else if (v.kind === 'ident') {
              words.push(v.text);
              this.advance();
            } else {
              break;
            }
          }
          meta.push({ key, value: words.join(' ') });
        } else if (
          key === '作者' ||
          key === '描述' ||
          key === '章节' ||
          key === '上一章' ||
          key === '下一章' ||
          key === '初始场景'
        ) {
          const v = this.peek();
          if (v.kind === 'string') {
            this.advance();
            meta.push({ key, value: v.value as string });
          } else {
            meta.push({ key, value: this.readName('值') });
          }
        } else {
          this.fail(`世界里不认识「${key}」这个字段。`, this.peek().span, '可用字段：版本、调性、种子、作者、描述、章节、上一章、下一章、初始场景。');
          this.skipToLineEnd();
          continue;
        }
        this.finishLine();
      }
      this.exitBlock();
    }
    return { k: 'world', name, meta, span: this.spanFrom(start) };
  }

  private readName(what: string): string {
    const t = this.peek();
    if (t.kind === 'ident') {
      this.advance();
      return t.text;
    }
    this.fail(`这里需要一个${what}，但读到了「${t.text}」。`, t.span, '名字可以是中文、字母、下划线，不能以数字开头。');
    throw new ParseError('unreachable');
  }

  /** v5.12：声明/引用名字允许带命名空间点号。 */
  private readQualifiedName(what: string): string {
    const parts = [this.readName(what)];
    while (this.at('punct', '.')) {
      this.advance();
      parts.push(this.readName(what));
    }
    return parts.join('.');
  }

  private readPath(what = '名字'): string[] {
    const parts: string[] = [this.readName(what)];
    while (this.at('punct', '.')) {
      this.advance();
      parts.push(this.readName(what));
    }
    return parts;
  }

  private readNumber(what: string): number {
    const t = this.peek();
    if (t.kind === 'number') {
      this.advance();
      return t.value as number;
    }
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.advance();
      const n = this.peek();
      if (n.kind === 'number') {
        this.advance();
        return t.text === '-' ? -(n.value as number) : (n.value as number);
      }
    }
    this.fail(`这里需要一个${what}，但读到了「${t.text}」。`, t.span);
    throw new ParseError('unreachable');
  }

  private readString(what: string): string {
    const t = this.peek();
    if (t.kind === 'string') {
      this.advance();
      return t.value as string;
    }
    this.fail(`这里需要一个${what}（用引号括起来），但读到了「${t.text}」。`, t.span);
    throw new ParseError('unreachable');
  }

  /** 文本：可以用引号，也可以直接写一整行中文（适合触觉/字幕这类短句）。 */
  private readText(what: string): string {
    const t = this.peek();
    if (t.kind === 'string') {
      this.advance();
      return t.value as string;
    }
    const parts: string[] = [];
    while (!this.atLineEnd()) {
      const v = this.advance();
      parts.push(v.text);
    }
    if (parts.length === 0) {
      this.fail(`这里需要一个${what}。`, t.span, '可以直接写一句话，或者用引号括起来。');
      throw new ParseError('unreachable');
    }
    return parts.join(' ');
  }

  private readBool(): boolean {
    if (this.atIdent('真')) {
      this.advance();
      return true;
    }
    if (this.atIdent('假')) {
      this.advance();
      return false;
    }
    const t = this.peek();
    this.fail(`这里需要「真」或「假」，但读到了「${t.text}」。`, t.span);
    throw new ParseError('unreachable');
  }

  // ---------- 实体 ----------

  private parseEntity(): EntityDecl {
    const start = this.expect('ident', '实体', '「实体」');
    const name = this.readQualifiedName('实体名');
    let typeName: string | undefined;
    if (this.atIdent('是')) {
      this.advance();
      typeName = this.readName('种类名');
    }
    this.finishLine();

    const strings: StringDecl[] = [];
    const fields: { key: string; value: string; span: Span }[] = [];

    if (this.enterBlock('实体声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const t = this.peek();
        if (t.kind === 'ident' && isStringKeyword(t.text)) {
          const kind = STRING_KEYWORDS[t.text]!;
          strings.push(this.parseStringDecl(kind, name));
          continue;
        }
        // 实体上的自由字段：种类 / 标签 / 位置 / 描述
        const key = this.readName('字段名');
        if (key === '是') {
          typeName = this.readName('种类名');
          this.finishLine();
          continue;
        }
        const valueParts: string[] = [];
        const vstart = this.peek();
        while (!this.atLineEnd()) {
          const v = this.advance();
          valueParts.push(v.text);
        }
        const value = valueParts.join(' ');
        if (key !== '种类' && key !== '标签' && key !== '位置' && key !== '描述') {
          this.fail(`实体上不认识「${key}」这个字段。`, this.peek().span, '可用字段：种类、标签、位置、描述；也可以直接在里面声明弦。');
        }
        fields.push({ key, value, span: { start: vstart.span.start, end: vstart.span.end } });
        this.finishLine();
      }
      this.exitBlock();
    }
    return { k: 'entity', name, typeName, strings, fields, span: this.spanFrom(start) };
  }

  // ---------- 谱 ----------

  /**
   * 谱 名字
   *   段 0.1 0.4 0.8 0.5
   *   范围 0..1
   *   插值 平滑
   *   循环 是
   *   模式 受迫
   *
   * 「段」的条数、取值范围等语义留给编译器；这里只负责把写法解析干净，
   * 让语法错误指到具体的 token。
   */
  private parseSpectrum(): SpectrumDecl {
    const start = this.advance(); // 关键字
    const name = this.readQualifiedName('谱名');
    const decl: SpectrumDecl = {
      k: 'spectrum',
      name,
      bands: [],
      min: 0,
      max: 1,
      interpolation: '线性',
      loop: false,
      mode: '固定',
      articulation: '拨弦',
      span: this.spanFrom(start),
    };
    this.finishLine();

    let sawBands = false;
    let sawMode = false;
    let sawArticulation = false;
    if (this.enterBlock(`谱「${name}」`)) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const fieldStart = this.peek();
        const key = this.readName('字段名');
        switch (key) {
          case '段': {
            if (sawBands) {
              this.fail(`谱「${name}」的「段」只能声明一次。`, fieldStart.span, '把所有音段值写在同一行的「段」里。');
              this.skipToLineEnd();
              break;
            }
            sawBands = true;
            let bad = false;
            while (!this.atLineEnd()) {
              const t = this.peek();
              if (t.kind === 'number' || (t.kind === 'op' && (t.text === '-' || t.text === '+'))) {
                decl.bands.push(this.readNumber('音段值'));
              } else {
                this.fail(`「段」后面只能写数字，但读到了「${t.text}」。`, t.span, '音段值用空格分隔，例如「段 0.1 0.4 0.8 0.5」。');
                bad = true;
                break;
              }
            }
            if (bad) this.skipToLineEnd();
            else this.finishLine();
            break;
          }
          case '范围': {
            decl.min = this.readNumber('范围下界');
            this.expect('punct', '..', '「..」（范围写成 0..1）');
            decl.max = this.readNumber('范围上界');
            this.finishLine();
            break;
          }
          case '插值': {
            const valueStart = this.peek();
            const value = this.readName('插值方式');
            if (!SPECTRUM_INTERPOLATIONS.includes(value)) {
              this.fail(`不认识的插值方式「${value}」。`, valueStart.span, '可用：线性、平滑、阶跃。');
            } else {
              decl.interpolation = value as SpectrumDecl['interpolation'];
            }
            this.finishLine();
            break;
          }
          case '循环': {
            if (this.atIdent('是')) {
              this.advance();
              decl.loop = true;
            } else if (this.atIdent('否')) {
              this.advance();
              decl.loop = false;
            } else {
              const t = this.peek();
              this.fail(`「循环」只能写「是」或「否」，但读到了「${t.text}」。`, t.span);
              this.skipToLineEnd();
              break;
            }
            this.finishLine();
            break;
          }
          case '模式': {
            if (sawMode) {
              this.fail(`谱「${name}」的「模式」只能声明一次。`, fieldStart.span, '把模式写在一行，例如「模式 受迫」。');
              this.skipToLineEnd();
              break;
            }
            sawMode = true;
            const valueStart = this.peek();
            const value = this.readName('模式');
            if (!SPECTRUM_MODES.includes(value)) {
              this.fail(`不认识的模式「${value}」。`, valueStart.span, '可用：固定、受迫。');
            } else {
              decl.mode = value as SpectrumDecl['mode'];
            }
            this.finishLine();
            break;
          }
          case '演奏': {
            if (sawArticulation) {
              this.fail(`谱「${name}」的「演奏」只能声明一次。`, fieldStart.span, '把演奏方式写在一行，例如「演奏 持续」。');
              this.skipToLineEnd();
              break;
            }
            sawArticulation = true;
            const valueStart = this.peek();
            const value = this.readName('演奏方式');
            if (!SPECTRUM_ARTICULATIONS.includes(value)) {
              this.fail(`不认识的演奏方式「${value}」。`, valueStart.span, '可用：拨弦、持续。');
            } else {
              decl.articulation = value as SpectrumDecl['articulation'];
            }
            this.finishLine();
            break;
          }
          default:
            this.fail(`谱里不认识「${key}」这个字段。`, fieldStart.span, '可用字段：段、范围、插值、循环、模式、演奏。');
            this.skipToLineEnd();
        }
      }
      this.exitBlock();
    }
    decl.span = { start: start.span.start, end: this.contentEnd() };
    return decl;
  }

  // ---------- 关系谱 ----------

  /**
   * 关系谱 名字
   *   行 甲 乙
   *   列 甲 乙
   *   段 0 0.3
   *   段 0.3 0
   *   曲线 甲 乙 0.1 0.5 0.9
   *   插值 平滑
   *   循环 是
   *
   * 「行/列」各是一行标签，「段」按行重复，条数必须和行数一致。曲线是
   * v2.3a 的格子级时间曲线：前两个 token 是行列标签，其余是数字。
   * 标签是否存在、是否重复、曲线重复、音段个数在 1..64、数字是否有限，
   * 都留给编译器——这样诊断能指向具体曲线，同时 IR 仍保留作者写的原值。
   */
  private parseMatrix(): MatrixDecl {
    const start = this.advance(); // 关键字
    const name = this.readQualifiedName('关系谱名');
    const decl: MatrixDecl = {
      k: 'matrix',
      name,
      rows: [],
      cols: [],
      values: [],
      curves: [],
      dynamics: [],
      interpolation: '线性',
      loop: false,
      span: this.spanFrom(start),
    };
    this.finishLine();

    let sawRows = false;
    let sawCols = false;
    if (this.enterBlock(`关系谱「${name}」`)) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const fieldStart = this.peek();
        const key = this.readName('字段名');
        switch (key) {
          case '行': {
            if (sawRows) {
              this.fail(`关系谱「${name}」的「行」只能声明一次。`, fieldStart.span, '把所有行标签写在同一行的「行」里。');
              this.skipToLineEnd();
              break;
            }
            sawRows = true;
            while (!this.atLineEnd()) decl.rows.push(this.readName('行标签'));
            this.finishLine();
            break;
          }
          case '列': {
            if (sawCols) {
              this.fail(`关系谱「${name}」的「列」只能声明一次。`, fieldStart.span, '把所有列标签写在同一行的「列」里。');
              this.skipToLineEnd();
              break;
            }
            sawCols = true;
            while (!this.atLineEnd()) decl.cols.push(this.readName('列标签'));
            this.finishLine();
            break;
          }
          case '段': {
            const row: number[] = [];
            let bad = false;
            while (!this.atLineEnd()) {
              const t = this.peek();
              if (t.kind === 'number' || (t.kind === 'op' && (t.text === '-' || t.text === '+'))) {
                row.push(this.readNumber('矩阵值'));
              } else {
                this.fail(`「段」后面只能写数字，但读到了「${t.text}」。`, t.span, '矩阵值用空格分隔，例如「段 0 0.3 0.1」。');
                bad = true;
                break;
              }
            }
            if (bad) this.skipToLineEnd();
            else this.finishLine();
            decl.values.push(row);
            break;
          }
          case '曲线': {
            // 前两个 token 是标签（标识符），其余全是数字；标签不会被误读成
            // 数字，因为词法器已经按 token 类型区分。
            const rowLabel = this.readName('行标签');
            const colLabel = this.readName('列标签');
            let curveInterpolation: MatrixCurveAst['interpolation'];
            let curveLoop: boolean | undefined;
            let curveSpeed: number | undefined;
            let curvePhase: number | undefined;
            while (this.atIdent('插值') || this.atIdent('循环') || this.atIdent('速度') || this.atIdent('相位')) {
              if (this.atIdent('插值')) {
                this.advance();
                const valueStart = this.peek();
                const value = this.readName('插值方式');
                if (!SPECTRUM_INTERPOLATIONS.includes(value)) {
                  this.fail(`不认识的插值方式「${value}」。`, valueStart.span, '可用：线性、平滑、阶跃。');
                } else {
                  curveInterpolation = value as NonNullable<MatrixCurveAst['interpolation']>;
                }
              } else if (this.atIdent('循环')) {
                this.advance();
                if (this.atIdent('是') || this.atIdent('真')) {
                  this.advance();
                  curveLoop = true;
                } else if (this.atIdent('否') || this.atIdent('假')) {
                  this.advance();
                  curveLoop = false;
                } else {
                  const t = this.peek();
                  this.fail(`「循环」只能写「是」或「否」，但读到了「${t.text}」。`, t.span);
                  this.skipToLineEnd();
                  break;
                }
              } else if (this.atIdent('速度')) {
                this.advance();
                curveSpeed = this.readNumber('曲线速度');
              } else {
                this.advance();
                curvePhase = this.readNumber('曲线相位');
              }
            }
            const bands: number[] = [];
            let bad = false;
            while (!this.atLineEnd()) {
              const t = this.peek();
              if (t.kind === 'number' || (t.kind === 'op' && (t.text === '-' || t.text === '+'))) {
                bands.push(this.readNumber('曲线音段值'));
              } else {
                this.fail(
                  `「曲线」的音段值只能是数字，但读到了「${t.text}」。`,
                  t.span,
                  '曲线修饰只能写「插值 线性|平滑|阶跃」「循环 是|否」「速度 数字」「相位 数字」；之后才是空格分隔的段值，例如「曲线 信任 色温 插值 阶跃 0.1 0.5 0.9」。',
                );
                bad = true;
                break;
              }
            }
            if (bad) {
              this.skipToLineEnd();
              break;
            }
            const span = this.spanFrom(fieldStart);
            this.finishLine();
            if (bands.length === 0) {
              this.fail(
                `关系谱「${name}」的「曲线」至少需要一个音段值。`,
                span,
                '例如「曲线 信任 色温 0.1 0.5 0.9」。',
              );
            } else {
              decl.curves.push({ row: rowLabel, col: colLabel, bands, ...(curveInterpolation ? { interpolation: curveInterpolation } : {}), ...(curveLoop !== undefined ? { loop: curveLoop } : {}), ...(curveSpeed !== undefined ? { speed: curveSpeed } : {}), ...(curvePhase !== undefined ? { phase: curvePhase } : {}), span });
            }
            break;
          }
          case '动态': {
            const row = this.readName('行标签');
            const col = this.readName('列标签');
            const expr = this.parseExpr();
            decl.dynamics.push({ row, col, expr, span: this.spanFrom(fieldStart) });
            this.finishLine();
            break;
          }
          case '插值': {
            const valueStart = this.peek();
            const value = this.readName('插值方式');
            if (!SPECTRUM_INTERPOLATIONS.includes(value)) {
              this.fail(`不认识的插值方式「${value}」。`, valueStart.span, '可用：线性、平滑、阶跃。');
            } else {
              decl.interpolation = value as MatrixDecl['interpolation'];
            }
            this.finishLine();
            break;
          }
          case '循环': {
            if (this.atIdent('是')) {
              this.advance();
              decl.loop = true;
            } else if (this.atIdent('否')) {
              this.advance();
              decl.loop = false;
            } else {
              const t = this.peek();
              this.fail(`「循环」只能写「是」或「否」，但读到了「${t.text}」。`, t.span);
              this.skipToLineEnd();
              break;
            }
            this.finishLine();
            break;
          }
          case '周期': {
            decl.period = this.readNumber('周期拍数');
            this.finishLine();
            break;
          }
          case '速度': {
            decl.speed = this.readNumber('速度倍率');
            this.finishLine();
            break;
          }
          case '相位': {
            decl.phase = this.readNumber('相位');
            this.finishLine();
            break;
          }
          case '相位源': {
            const matrix = this.readName('源矩阵名');
            const row = this.readName('源行标签');
            const col = this.readName('源列标签');
            decl.phaseSource = { matrix, row, col };
            this.finishLine();
            break;
          }
          default: {
            const fields = ['行', '列', '段', '曲线', '插值', '循环', '周期', '速度', '相位', '相位源'];
            const hint = suggestName(key, fields);
            this.fail(
              `关系谱里不认识「${key}」这个字段。`,
              fieldStart.span,
              hint ? `你是不是想写「${hint}」？可用字段：${fields.join('、')}。` : `可用字段：${fields.join('、')}。`,
            );
            this.skipToLineEnd();
          }
        }
      }
      this.exitBlock();
    }
    decl.span = { start: start.span.start, end: this.contentEnd() };
    return decl;
  }

  // ---------- 弦 ----------

  private parseStringDecl(stringKind: StringKind, owner: string | undefined): StringDecl {
    const start = this.advance(); // 关键字
    const name = this.readQualifiedName('弦名');
    const decl: StringDecl = { k: 'string', stringKind, name, owner, span: this.spanFrom(start) };

    if (this.eat('punct', ':')) {
      while (!this.atLineEnd()) {
        const key = this.readName('字段名');
        this.applyStringField(decl, key);
        if (!this.eat('punct', ',')) break;
      }
    }
    this.finishLine();

    if (this.enterBlock('弦声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const key = this.readName('字段名');
        this.applyStringField(decl, key);
        this.finishLine();
      }
      this.exitBlock();
    }
    decl.span = { start: start.span.start, end: this.contentEnd() };
    return decl;
  }

  private applyStringField(decl: StringDecl, key: string): void {
    switch (key) {
      case '类型':
        decl.domain = this.readDomain();
        return;
      case '范围': {
        const min = this.readNumber('下界');
        this.expect('punct', '..', '「..」');
        const max = this.readNumber('上界');
        decl.domain = { type: 'number', min, max };
        return;
      }
      case '基线':
        decl.baseline = this.parseExpr();
        return;
      case '悬崖':
        decl.verge = this.parseExpr();
        return;
      case '安全':
        decl.safe = this.parseExpr();
        return;
      case '响应': {
        const v = this.readName('响应曲线');
        if (!(RESPONSE_CURVES as string[]).includes(v)) {
          this.fail(`不认识的响应曲线「${v}」。`, this.peek().span, '可用：线性、缓入、缓出、阶跃。');
          return;
        }
        decl.response = v as ResponseCurve;
        return;
      }
      case '可见':
        decl.visible = this.readBool();
        return;
      case '对象':
        decl.target = this.readName('关系对象');
        return;
      case '音色':
        decl.timbre = this.readName('音色谱名');
        return;
      case '描述':
        decl.note = this.readString('描述');
        return;
      default:
        this.fail(`弦上不认识「${key}」这个字段。`, this.peek().span, '可用字段：类型、范围、基线、悬崖、安全、响应、可见、对象、音色、描述。');
        this.skipToLineEnd();
    }
  }

  private readDomain(): DomainAst {
    const t = this.peek();
    if (t.kind !== 'ident') {
      this.fail(`这里需要一种类型，但读到了「${t.text}」。`, t.span, '可用类型：数值、布尔、枚举(…)、集合(…)、文本、引用(…)。');
      throw new ParseError('unreachable');
    }
    this.advance();
    switch (t.text) {
      case '数值': {
        let min: number | undefined;
        let max: number | undefined;
        if (this.at('number')) {
          min = this.readNumber('下界');
          this.expect('punct', '..', '「..」');
          max = this.readNumber('上界');
        } else if (this.at('punct', '..')) {
          this.advance();
          max = this.readNumber('上界');
        }
        return { type: 'number', min, max };
      }
      case '布尔':
        return { type: 'boolean' };
      case '文本':
        return { type: 'text' };
      case '枚举': {
        this.expect('punct', '(', '「(」');
        const values: string[] = [];
        while (!this.at('punct', ')') && !this.at('eof')) {
          values.push(this.readName('枚举值'));
          if (!this.eat('punct', ',')) break;
        }
        this.expect('punct', ')', '「)」');
        return { type: 'enum', values };
      }
      case '集合': {
        let elementKind: string | undefined;
        if (this.eat('punct', '(')) {
          elementKind = this.readName('元素种类');
          this.expect('punct', ')', '「)」');
        }
        return { type: 'set', elementKind };
      }
      case '引用': {
        let entityKind: string | undefined;
        if (this.eat('punct', '(')) {
          entityKind = this.readName('实体种类');
          this.expect('punct', ')', '「)」');
        }
        return { type: 'ref', entityKind };
      }
      default:
        this.fail(`不认识的类型「${t.text}」。`, t.span, '可用类型：数值、布尔、枚举(…)、集合(…)、文本、引用(…)。');
        throw new ParseError('unreachable');
    }
  }

  // ---------- 耦合 ----------

  private parseCoupling(): CouplingDecl {
    const start = this.advance();
    const from = this.readPath('源弦');
    this.expect('op', '→', '「→」（从哪根弦指向哪根弦）');
    const to = this.readPath('目标弦');

    const decl: CouplingDecl = { k: 'coupling', from, to, polarity: 1, span: this.spanFrom(start) };

    // 行内修饰：同向 / 反向 / 0.4 / 延迟 2 / 当 … / 曲线 缓入
    while (!this.atLineEnd()) {
      if (this.atIdent('同向')) {
        this.advance();
        decl.polarity = 1;
      } else if (this.atIdent('反向')) {
        this.advance();
        decl.polarity = -1;
      } else if (this.atIdent('强度')) {
        this.advance();
        decl.strength = this.parseExpr();
      } else if (this.atIdent('延迟')) {
        this.advance();
        decl.delay = this.parseExpr();
      } else if (this.atIdent('当')) {
        this.advance();
        decl.guard = this.parseExpr();
      } else if (this.atIdent('曲线')) {
        this.advance();
        decl.curve = this.readCurve();
      } else if (this.at('number')) {
        decl.strength = this.parseExpr();
      } else {
        const t = this.peek();
        this.fail(`耦合上不认识「${t.text}」。`, t.span, '行内可用：同向、反向、强度、延迟、当、曲线，或直接写强度数字。');
        this.skipToLineEnd();
        break;
      }
    }
    this.finishLine();

    if (this.enterBlock('耦合声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const key = this.readName('字段名');
        switch (key) {
          case '极性': {
            if (this.atIdent('同向')) {
              this.advance();
              decl.polarity = 1;
            } else if (this.atIdent('反向')) {
              this.advance();
              decl.polarity = -1;
            } else {
              this.fail('「极性」只能是「同向」或「反向」。', this.peek().span);
              this.skipToLineEnd();
            }
            break;
          }
          case '强度':
            decl.strength = this.parseExpr();
            break;
          case '延迟':
            decl.delay = this.parseExpr();
            break;
          case '当':
            decl.guard = this.parseExpr();
            break;
          case '曲线':
            decl.curve = this.readCurve();
            break;
          case '描述':
            this.advance();
            break;
          default:
            this.fail(`耦合上不认识「${key}」这个字段。`, this.peek().span, '可用字段：极性、强度、延迟、当、曲线。');
            this.skipToLineEnd();
        }
        this.finishLine();
      }
      this.exitBlock();
    }
    decl.span = this.spanFrom(start);
    return decl;
  }

  private readCurve(): ResponseCurve {
    const v = this.readName('响应曲线');
    if (!(RESPONSE_CURVES as string[]).includes(v)) {
      this.fail(`不认识的响应曲线「${v}」。`, this.peek().span, '可用：线性、缓入、缓出、阶跃。');
      return '线性';
    }
    return v as ResponseCurve;
  }

  // ---------- 回路 ----------

  private parseLoop(): LoopDecl {
    const start = this.advance();
    const name = this.readName('回路名');

    if (this.eat('punct', ':')) {
      const edges = this.parseLoopChain(name, start);
      this.finishLine();
      return { k: 'loop', name, edges, span: this.spanFrom(start) };
    }

    this.finishLine();
    const edges: LoopEdgeAst[] = [];
    if (this.enterBlock('回路声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        if (!this.atIdent('边')) {
          const t = this.peek();
          this.fail(`回路里只能写「边 A → B 同向 0.4」这样的边，但读到了「${t.text}」。`, t.span);
          this.skipToLineEnd();
          continue;
        }
        const estart = this.advance();
        const from = this.readPath('源弦');
        this.expect('op', '→', '「→」');
        const to = this.readPath('目标弦');
        let polarity: 1 | -1 = 1;
        let strength: number | undefined;
        let delay: number | undefined;
        while (!this.atLineEnd()) {
          if (this.atIdent('同向')) {
            this.advance();
            polarity = 1;
          } else if (this.atIdent('反向')) {
            this.advance();
            polarity = -1;
          } else if (this.at('number')) {
            strength = this.readNumber('强度');
          } else if (this.atIdent('强度')) {
            this.advance();
            strength = this.readNumber('强度');
          } else if (this.atIdent('延迟')) {
            this.advance();
            delay = this.readNumber('延迟');
          } else {
            this.fail(`回路的边上不认识「${this.peek().text}」。`, this.peek().span);
            this.skipToLineEnd();
            break;
          }
        }
        edges.push({ from, to, polarity, strength, delay, span: this.spanFrom(estart) });
        this.finishLine();
      }
      this.exitBlock();
    }
    if (edges.length === 0) {
      this.fail(`回路「${name}」没有任何一条边。`, start.span, '改用链式写法：回路 忠诚: 朝任↓ → 粮草↓ → 军心↓ → 朝任↓');
    }
    return { k: 'loop', name, edges, span: this.spanFrom(start) };
  }

  private parseLoopChain(name: string, start: Token): LoopEdgeAst[] {
    const nodes: { path: string[]; dir: 1 | -1; span: Span }[] = [];
    for (;;) {
      const nstart = this.peek();
      const path = this.readPath('弦名');
      if (!this.at('arrow')) {
        const t = this.peek();
        this.fail(`回路链上「${path.join('.')}」缺少方向标记。`, t.span, '每根弦后面要标 ↑ 或 ↓，例如「信任↓ → 粮草↓」。');
        throw new ParseError('unreachable');
      }
      const arrow = this.advance();
      nodes.push({ path, dir: arrow.text === '↑' ? 1 : -1, span: this.spanFrom(nstart) });
      if (!this.eat('op', '→')) break;
    }

    if (nodes.length < 2) {
      this.fail(`回路「${name}」至少要有一根弦指向另一根弦。`, start.span);
      throw new ParseError('unreachable');
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (first.path.join('.') !== last.path.join('.')) {
      this.fail(
        `回路「${name}」没有闭合：起点是「${first.path.join('.')}」，终点是「${last.path.join('.')}」。`,
        last.span,
        '链式写法的最后一个名字必须回到起点，才构成回路。',
      );
    }

    // 最后一个节点是「回到起点时，起点被推成的方向」。
    // 它与起点方向不同，正说明这是一条自我校正的回路——所以不能要求方向相同。
    const edges: LoopEdgeAst[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i]!;
      const b = nodes[i + 1]!;
      edges.push({
        from: a.path,
        to: b.path,
        polarity: a.dir === b.dir ? 1 : -1,
        span: { start: a.span.start, end: b.span.end },
      });
    }
    return edges;
  }

  // ---------- 力迫 / 和弦 ----------

  private parseForcing(): ForcingDecl {
    const start = this.advance();
    const name = this.readQualifiedName('力迫名');
    const decl: ForcingDecl = {
      k: 'forcing',
      name,
      effects: [],
      irreversible: false,
      priority: 0,
      before: [],
      repeat: false,
      span: this.spanFrom(start),
    };
    this.finishLine();
    this.parseRuleBody(decl, true);
    decl.span = this.spanFrom(start);
    return decl;
  }

  private parseChord(): ChordDecl {
    const start = this.advance();
    const name = this.readQualifiedName('和弦名');
    const decl: ChordDecl = { k: 'chord', name, effects: [], repeat: false, span: this.spanFrom(start) };
    this.finishLine();
    this.parseRuleBody(decl, false);
    decl.span = this.spanFrom(start);
    return decl;
  }

  private parseRuleBody(decl: ForcingDecl | ChordDecl, isForcing: boolean): void {
    if (!this.enterBlock(`${isForcing ? '力迫' : '和弦'}「${decl.name}」`)) {
      this.fail(`${isForcing ? '力迫' : '和弦'}「${decl.name}」没有任何内容。`, decl.span, '至少要有「效果」，或者一个「当」条件。');
      return;
    }
    while (!this.at('dedent') && !this.at('eof')) {
      if (this.at('newline')) {
        this.advance();
        continue;
      }
      const key = this.readName('字段名');
      switch (key) {
        case '当':
          decl.guard = this.parseExpr();
          this.finishLine();
          break;
        case '效果':
          if (!this.atLineEnd()) {
            decl.effects.push(this.parseEffect());
            this.finishLine();
          } else {
            this.finishLine();
            this.parseEffectBlock(decl.effects);
          }
          break;
        case '不可逆':
          if (!isForcing) {
            this.fail('只有「力迫」可以声明不可逆，「和弦」是一组效果，本身不带不可逆性。', this.peek().span);
          }
          (decl as ForcingDecl).irreversible = true;
          this.finishLine();
          break;
        case '优先级':
          (decl as ForcingDecl).priority = this.readNumber('优先级');
          this.finishLine();
          break;
        case '先于': {
          const names = [this.readQualifiedName('力迫名')];
          while (this.eat('punct', ',') || this.atIdent('和')) {
            if (this.atIdent('和')) this.advance();
            names.push(this.readQualifiedName('力迫名'));
          }
          (decl as ForcingDecl).before.push(...names);
          this.finishLine();
          break;
        }
        case '可重复':
          decl.repeat = true;
          if (!this.atLineEnd()) {
            this.fail('「可重复」后面不用跟任何东西。', this.peek().span);
            this.skipToLineEnd();
          } else {
            this.finishLine();
          }
          break;
        case '每':
          (decl as ForcingDecl).cooldown = this.readNumber('间隔拍数');
          this.finishLine();
          break;
        case '描述':
          decl.note = this.readString('描述');
          this.finishLine();
          break;
        default:
          this.fail(`「${isForcing ? '力迫' : '和弦'}」里不认识「${key}」。`, this.peek().span, '可用字段：当、效果、不可逆、优先级、先于、可重复、每、描述。');
          this.skipToLineEnd();
      }
    }
    this.exitBlock();
    if (decl.effects.length === 0) {
      this.fail(`「${decl.name}」没有声明任何效果。`, decl.span, '它被触发时什么也不会发生——补一个「效果」块。');
    }
  }

  private parseEffectBlock(out: EffectAst[]): void {
    if (!this.enterBlock('效果块')) {
      this.fail('「效果」后面什么都没有。', this.peek().span, '换行后缩进写具体的改动，例如「信任 -= 10」。');
      return;
    }
    while (!this.at('dedent') && !this.at('eof')) {
      if (this.at('newline')) {
        this.advance();
        continue;
      }
      out.push(this.parseEffect());
      this.finishLine();
    }
    this.exitBlock();
  }

  private parseEffect(): EffectAst {
    const start = this.peek();
    if (this.atIdent('施加')) {
      this.advance();
      const chord = this.readQualifiedName('和弦名');
      return { k: 'apply', chord, span: this.spanFrom(start) };
    }
    if (this.atIdent('切换场景')) {
      this.advance();
      return { k: 'scene', scene: this.readQualifiedName('场景名'), span: this.spanFrom(start) };
    }
    if (this.atIdent('关系谱')) {
      this.advance();
      const name = this.readQualifiedName('关系谱名');
      const row = this.readName('行标签');
      const col = this.readName('列标签');
      const op = this.peek();
      if (op.kind === 'op' && (op.text === '=' || op.text === '+=' || op.text === '-=')) {
        this.advance();
        const value = this.parseExpr();
        const k = op.text === '=' ? 'set' : op.text === '+=' ? 'add' : 'sub';
        return { k, matrix: { name, row, col }, value, span: this.spanFrom(start) };
      }
      this.fail(`关系谱格「${name} ${row} ${col}」需要一个运算符：=、+= 或 -=。`, op.span, '例如「关系谱 势力网 信任 色温 += 0.1」。');
      throw new ParseError('unreachable');
    }
    const target = this.readPath('要改的弦');
    const op = this.peek();
    if (op.kind === 'op' && (op.text === '=' || op.text === '+=' || op.text === '-=')) {
      this.advance();
      const value = this.parseExpr();
      const k = op.text === '=' ? 'set' : op.text === '+=' ? 'add' : 'sub';
      return { k, target, value, span: this.spanFrom(start) };
    }
    this.fail(`改动「${target.join('.')}」需要一个运算符：=、+= 或 -=。`, op.span, '例如「信任 -= 10」「秘密.知情者 += 李严」。');
    throw new ParseError('unreachable');
  }

  // ---------- 公理 ----------

  private parseAxiom(): AxiomDecl {
    const start = this.advance();
    const name = this.readQualifiedName('公理名');
    let expr: Expr | undefined;
    if (this.eat('punct', ':')) {
      expr = this.parseExpr();
      this.finishLine();
    } else {
      this.finishLine();
      if (this.enterBlock('公理声明')) {
        while (!this.at('dedent') && !this.at('eof')) {
          if (this.at('newline')) {
            this.advance();
            continue;
          }
          const key = this.readName('字段名');
          if (key === '成立' || key === '当') {
            expr = this.parseExpr();
            this.finishLine();
          } else {
            this.fail(`公理里不认识「${key}」。`, this.peek().span, '公理只写一条永远为真的表达式，例如「成立 甲.力 + 乙.力 <= 100」。');
            this.skipToLineEnd();
          }
        }
        this.exitBlock();
      }
    }
    if (!expr) {
      this.fail(`公理「${name}」没有表达式。`, start.span, '写成「公理 力量守恒: 甲.力 + 乙.力 <= 100」。');
      throw new ParseError('unreachable');
    }
    return { k: 'axiom', name, expr, span: this.spanFrom(start) };
  }

  // ---------- 信号 ----------

  private parseSignal(): SignalDecl {
    const start = this.advance();
    const name = this.readQualifiedName('信号名');
    this.finishLine();
    let guard: Expr | undefined;
    const cues: CueAst[] = [];
    if (this.enterBlock('信号声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const key = this.readName('字段名');
        if (key === '当') {
          guard = this.parseExpr();
          this.finishLine();
          continue;
        }
        if (key === '台词') {
          const cstart = this.peek();
          let speaker: string | undefined;
          if (this.at('ident') && this.peek(1).kind === 'punct' && this.peek(1).text === ':') {
            speaker = this.readName('说话者');
            this.advance();
          }
          const text = this.readString('台词');
          cues.push({ k: '台词', speaker, text, span: this.spanFrom(cstart) });
          this.finishLine();
          continue;
        }
        if (key === '视觉' || key === '音频') {
          const cstart = this.peek();
          const param = this.readName('参数名');
          const value = this.readNumber('数值');
          cues.push({ k: key, param, value, span: this.spanFrom(cstart) });
          this.finishLine();
          continue;
        }
        if (key === '触觉' || key === '字幕' || key === '提示') {
          const cstart = this.peek();
          const text = this.readText('文字');
          cues.push({ k: key, text, span: this.spanFrom(cstart) });
          this.finishLine();
          continue;
        }
        this.fail(`信号里不认识「${key}」。`, this.peek().span, '可用：当、台词、视觉、音频、触觉、字幕、提示。');
        this.skipToLineEnd();
      }
      this.exitBlock();
    }
    if (!guard) {
      this.fail(`信号「${name}」没有「当」条件。`, start.span, '信号是「当世界出现某种状态时，让玩家看见/听见/感觉到」。');
      throw new ParseError('unreachable');
    }
    if (cues.length === 0) {
      this.fail(`信号「${name}」没有绑定任何呈现方式。`, start.span, '加一句「台词」「视觉」或「音频」——否则它是一条哑信号。');
    }
    return { k: 'signal', name, guard, cues, span: this.spanFrom(start) };
  }

  // ---------- 动作 ----------

  private parseAction(): ActionDecl {
    const start = this.advance();
    const name = this.readQualifiedName('动作名');
    const decl: ActionDecl = { k: 'action', name, cost: 1, effects: [], span: this.spanFrom(start) };
    this.finishLine();
    if (this.enterBlock('动作声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const key = this.readName('字段名');
        switch (key) {
          case '当':
            decl.guard = this.parseExpr();
            this.finishLine();
            break;
          case '耗时':
            decl.cost = this.readNumber('耗时拍数');
            this.finishLine();
            break;
          case '效果':
            if (!this.atLineEnd()) {
              decl.effects.push(this.parseEffect());
              this.finishLine();
            } else {
              this.finishLine();
              this.parseEffectBlock(decl.effects);
            }
            break;
          case '描述':
            decl.note = this.readString('描述');
            this.finishLine();
            break;
          default:
            this.fail(`动作里不认识「${key}」。`, this.peek().span, '可用：当、耗时、效果、描述。');
            this.skipToLineEnd();
        }
      }
      this.exitBlock();
    }
    if (decl.effects.length === 0) {
      this.fail(`动作「${name}」没有任何效果。`, start.span, '动作至少要改变一根弦，否则玩家按了它世界不会有反应。');
    }
    return decl;
  }

  // ---------- 曲式 ----------

  private parseForm(): FormDecl {
    const start = this.advance();
    const name = this.readQualifiedName('曲式名');
    this.finishLine();
    const phases: PhaseAst[] = [];
    if (this.enterBlock('曲式声明')) {
      while (!this.at('dedent') && !this.at('eof')) {
        if (this.at('newline')) {
          this.advance();
          continue;
        }
        const pstart = this.peek();
        const key = this.readName('字段名');
        if (key !== '段落') {
          this.fail(`曲式里只能写「段落」，不认识的字段「${key}」。`, this.peek().span);
          this.skipToLineEnd();
          continue;
        }
        const phaseName = this.readName('段落名');
        let duration: number | undefined;
        while (!this.atLineEnd()) {
          if (this.atIdent('时长')) {
            this.advance();
            duration = this.readNumber('时长');
          } else if (this.atIdent('重复')) {
            this.advance();
          } else {
            this.fail(`段落上不认识「${this.peek().text}」。`, this.peek().span, '段落写成「段落 平静 时长 120」。');
            this.skipToLineEnd();
            break;
          }
        }
        if (duration === undefined) {
          this.fail(`段落「${phaseName}」没有时长。`, pstart.span, '加一句「时长 120」——单位是拍。');
          duration = 60;
        }
        phases.push({ name: phaseName, duration, span: this.spanFrom(pstart) });
        this.finishLine();
      }
      this.exitBlock();
    }
    if (phases.length === 0) {
      this.fail(`曲式「${name}」没有任何段落。`, start.span);
    }
    return { k: 'form', name, phases, span: this.spanFrom(start) };
  }

  // ---------- 结局 ----------

  private parseEnding(): EndingDecl {
    const start = this.advance();
    const name = this.readQualifiedName('结局名');
    let guard: Expr | undefined;
    let declNext: string | undefined;
    const declNexts: string[] = [];
    const hadColon = this.eat('punct', ':');
    if (hadColon && !this.atLineEnd()) {
      if (this.atIdent('当')) this.advance();
      guard = this.parseExpr();
      this.finishLine();
    } else {
      this.finishLine();
      if (this.enterBlock('结局声明')) {
        while (!this.at('dedent') && !this.at('eof')) {
          if (this.at('newline')) {
            this.advance();
            continue;
          }
          const key = this.readName('字段名');
          if (key === '当') {
            guard = this.parseExpr();
            this.finishLine();
          } else if (key === '下一章') {
            declNext = this.readString('下一章路径');
            declNexts.push(declNext);
            this.finishLine();
          } else {
            this.fail(`结局里不认识「${key}」。`, this.peek().span);
            this.skipToLineEnd();
          }
        }
        this.exitBlock();
      }
    }
    if (!guard) {
      this.fail(`结局「${name}」没有触发条件。`, start.span, '写成「结局 崩坏: 当 信任 <= 0」。');
      throw new ParseError('unreachable');
    }
    return {
      k: 'ending',
      name,
      guard,
      ...(declNext ? { nextChapter: declNext } : {}),
      ...(declNexts.length > 0 ? { nextChapters: declNexts } : {}),
      span: this.spanFrom(start),
    };
  }

  // ---------- 表达式 ----------

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.atIdent('或') || this.at('op', '||')) {
      const opTok = this.advance();
      const right = this.parseAnd();
      left = { k: 'bin', op: '或', left, right, span: { start: left.span.start, end: right.span.end } };
      void opTok;
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.atIdent('且') || this.at('op', '&&')) {
      this.advance();
      const right = this.parseNot();
      left = { k: 'bin', op: '且', left, right, span: { start: left.span.start, end: right.span.end } };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.atIdent('非') || this.at('op', '!')) {
      const start = this.advance();
      const operand = this.parseNot();
      return { k: 'un', op: '非', operand, span: { start: start.span.start, end: operand.span.end } };
    }
    return this.parseCompare();
  }

  private parseCompare(): Expr {
    let left = this.parseAdd();
    while (this.at('op') && ['==', '!=', '<', '<=', '>', '>='].includes(this.peek().text)) {
      const opTok = this.advance();
      const right = this.parseAdd();
      left = {
        k: 'bin',
        op: opTok.text as '==',
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (this.at('op') && (this.peek().text === '+' || this.peek().text === '-')) {
      const opTok = this.advance();
      const right = this.parseMul();
      left = {
        k: 'bin',
        op: opTok.text as '+',
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parseUnary();
    while (this.at('op') && ['*', '/', '%'].includes(this.peek().text)) {
      const opTok = this.advance();
      const right = this.parseUnary();
      left = {
        k: 'bin',
        op: opTok.text as '*',
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.at('op') && (this.peek().text === '-' || this.peek().text === '+')) {
      const start = this.advance();
      const operand = this.parseUnary();
      return { k: 'un', op: start.text as '-', operand, span: { start: start.span.start, end: operand.span.end } };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === 'number') {
      this.advance();
      return { k: 'num', v: t.value as number, span: t.span };
    }
    if (t.kind === 'string') {
      this.advance();
      return { k: 'str', v: t.value as string, span: t.span };
    }
    if (t.kind === 'punct' && t.text === '(') {
      this.advance();
      const inner = this.parseExpr();
      this.expect('punct', ')', '「)」');
      return inner;
    }
    if (t.kind === 'punct' && t.text === '{') {
      const start = this.advance();
      const items: string[] = [];
      while (!this.at('punct', '}') && !this.at('eof')) {
        const v = this.peek();
        if (v.kind === 'ident' || v.kind === 'string') {
          items.push(v.kind === 'string' ? (v.value as string) : v.text);
          this.advance();
        } else {
          this.fail('集合里只能写名字或字符串。', v.span);
          this.skipToLineEnd();
          break;
        }
        if (!this.eat('punct', ',')) break;
      }
      this.expect('punct', '}', '「}」');
      return { k: 'set', items, span: this.spanFrom(start) };
    }
    if (t.kind === 'ident') {
      if (t.text === '真' || t.text === '假') {
        this.advance();
        return { k: 'bool', v: t.text === '真', span: t.span };
      }
      this.advance();
      // 函数调用
      if (this.at('punct', '(') && !this.at('punct', '.')) {
        this.advance();
        const args: Expr[] = [];
        while (!this.at('punct', ')') && !this.at('eof') && !this.atLineEnd()) {
          args.push(this.parseExpr());
          if (!this.eat('punct', ',')) break;
        }
        this.expect('punct', ')', '「)」');
        return { k: 'call', name: t.text, args, span: this.spanFrom(t) };
      }
      const parts = [t.text];
      while (this.at('punct', '.')) {
        this.advance();
        parts.push(this.readName('路径'));
      }
      return { k: 'path', parts, span: this.spanFrom(t) };
    }
    this.fail(`这里需要一个值，但读到了「${t.text}」。`, t.span, '可以写数字、字符串、真/假、弦名，或一个括号表达式。');
    throw new ParseError('unreachable');
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n]!;
}

export function parse(source: SourceFile, diagnostics: DiagnosticBag): Program {
  return new Parser(source, diagnostics).parseProgram();
}
