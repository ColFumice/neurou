import type {
  ActionDecl,
  AudioAssetDecl,
  AxiomDecl,
  BgmDecl,
  ChordDecl,
  CouplingDecl,
  CueAst,
  Decl,
  EffectAst,
  EndingDecl,
  EntityDecl,
  Expr,
  ForcingDecl,
  FormDecl,
  FunctionDecl,
  LoopDecl,
  MatrixDecl,
  Program,
  ResponseCurve,
  SceneDecl,
  SignalDecl,
  SpectrumDecl,
  PortDecl,
  NamespaceDecl,
  StringDecl,
  StringKind,
  SystemDecl,
  WorldDecl,
} from './ast.js';
import { DiagnosticBag, type Diagnostic } from './diagnostics.js';
import type {
  IRAudioAsset,
  IRAxiom,
  IRBgm,
  IRCoupling,
  IRCue,
  IREffect,
  IREntity,
  IREnding,
  IRLoop,
  IRMatrix,
  IRPhase,
  IRFunction,
  IRNamespace,
  IRPort,
  IRRule,
  IRScene,
  IRSignal,
  IRSpectrum,
  IRString,
  IRSystem,
  LExpr,
  Value,
  WorldIR,
} from './ir.js';
import { SourceFile, type Span } from './source.js';
import { suggestName } from './suggest.js';
export { suggestName } from './suggest.js';
import { parse } from './parser.js';

export interface CompileResult {
  source: SourceFile;
  program: Program;
  diagnostics: DiagnosticBag;
  /** 即使有错误也尽量产出图，供 GUI 部分预览与引擎盖诊断 */
  ir: WorldIR;
  ok: boolean;
}

type TypeName = 'number' | 'boolean' | 'text' | 'enum' | 'set' | 'ref' | 'any';

const FUNCTION_TYPE_NAMES: Record<string, TypeName> = {
  数值: 'number',
  真假: 'boolean',
  文本: 'text',
  枚举: 'enum',
  集合: 'set',
  引用: 'ref',
  任意: 'any',
};

function resolveFunctionType(raw: string): TypeName | undefined {
  return FUNCTION_TYPE_NAMES[raw];
}

interface Scope {
  owner?: string;
  /** v5.19/v5.22：函数形参类型；只在 lowering 函数体时存在。 */
  params?: Map<string, TypeName>;
}

const KIND_SOLVER: Record<StringKind, string> = {
  叙事: '状态机',
  视觉: '渲染管线',
  动画: '动画求解器',
  物理: '物理积分器',
  控制: '输入映射',
  空间: '区域图',
  认知: '知识图谱更新器',
  关系: '事件驱动更新器',
};

export function kindSolver(kind: StringKind): string {
  return KIND_SOLVER[kind];
}

class Compiler {
  private readonly diagnostics = new DiagnosticBag();
  private program: Program = { decls: [], span: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } };
  private world: WorldDecl | undefined;

  private readonly entities = new Map<string, IREntity>();
  private readonly entityDecls = new Map<string, EntityDecl>();
  private readonly strings = new Map<string, IRString>();
  private readonly stringDecls = new Map<string, StringDecl>();
  private readonly shortNames = new Map<string, string[]>();

  private readonly chordDecls = new Map<string, ChordDecl>();
  private readonly forcingDecls = new Map<string, ForcingDecl>();
  private readonly actionDecls = new Map<string, ActionDecl>();
  private readonly signalDecls: SignalDecl[] = [];
  private readonly endingDecls: EndingDecl[] = [];
  private readonly axiomDecls: AxiomDecl[] = [];
  private readonly loopDecls: LoopDecl[] = [];
  private readonly couplingDecls: CouplingDecl[] = [];
  private formDecl: FormDecl | undefined;

  private readonly couplings: IRCoupling[] = [];
  private readonly loops: IRLoop[] = [];
  private readonly rules: IRRule[] = [];
  private readonly signals: IRSignal[] = [];
  private readonly endings: IREnding[] = [];
  private readonly axioms: IRAxiom[] = [];
  private readonly phases: IRPhase[] = [];
  private readonly spectra: IRSpectrum[] = [];
  private readonly spectrumNames = new Set<string>();
  private readonly audioAssets: IRAudioAsset[] = [];
  private readonly audioAssetNames = new Set<string>();
  private bgmDecl: BgmDecl | undefined;
  private bgm: IRBgm | undefined;
  private readonly systemDecls: SystemDecl[] = [];
  private readonly sceneDecls: SceneDecl[] = [];
  private readonly systems: IRSystem[] = [];
  private readonly scenes: IRScene[] = [];
  private readonly portDecls: PortDecl[] = [];
  private readonly namespaceDecls: NamespaceDecl[] = [];
  private readonly namespaces: IRNamespace[] = [];
  private readonly exportedQualified = new Set<string>();
  private readonly functionDecls = new Map<string, FunctionDecl>();
  private readonly functionBodies = new Map<string, LExpr>();
  private readonly functionReturnTypes = new Map<string, TypeName>();
  private readonly functions: IRFunction[] = [];
  private readonly expandingFunctions = new Set<string>();
  /** v5.21：调用图；'<world>' 代表规则/动作/系统等世界级调用者。 */
  private readonly functionCalls = new Map<string, Set<string>>();
  private currentFunction: string | undefined;
  private readonly ports: IRPort[] = [];
  private readonly matrices: IRMatrix[] = [];
  private readonly matrixByName = new Map<string, IRMatrix>();

  private readonly readBy = new Map<string, Set<string>>();
  private readonly writtenBy = new Map<string, Set<string>>();
  private readonly matrixWrites = new Set<string>();
  private readonly matrixDynamics = new Set<string>();
  private couplingSeq = 0;

  constructor(private readonly source: SourceFile) {}

  compile(): CompileResult {
    this.program = parse(this.source, this.diagnostics);
    this.collect(this.program.decls);
    this.validateNamespaceExports();
    this.buildFunctionBodies();
    this.scanMatrixWrites();
    this.buildCouplings();
    this.buildLoops();
    this.buildRules();
    this.buildSystems();
    this.buildScenes();
    this.buildPorts();
    this.buildAxioms();
    this.buildSignals();
    this.buildEndings();
    this.buildPhases();
    this.analyze();
    this.diagnoseFunctionReachability();

    const ir = this.assemble();
    return {
      source: this.source,
      program: this.program,
      diagnostics: this.diagnostics,
      ir,
      ok: !this.diagnostics.hasErrors,
    };
  }

  // ---------- 收集 ----------

  /** v5.14：导出清单只能指向命名空间里的弦；短名引用只对导出项生效。 */
  private validateNamespaceExports(): void {
    for (const namespace of this.namespaceDecls) {
      for (const exported of namespace.exports) {
        if (!this.strings.has(`${namespace.name}.${exported}`)) {
          this.error('NRO2001', `命名空间「${namespace.name}」导出了不存在的弦「${exported}」。`, namespace.span, {
            hint: '第一版只允许导出七类弦；系统/场景的导出后置。',
          });
        }
      }
    }
  }

  /** v5.12：把命名空间内的声明改写为限定名字；引用仍由作者显式限定。 */
  private prefixNamespaceDecl(d: Decl, namespace: string): Decl {
    switch (d.k) {
      case 'world':
      case 'namespace':
        this.error('NRO2004', `命名空间内不能声明${d.k === 'world' ? '世界' : '嵌套命名空间'}。`, d.span);
        return d;
      case 'entity': {
        const name = `${namespace}.${d.name}`;
        return {
          ...d,
          name,
          strings: d.strings.map((string) => ({ ...string, owner: name })),
        };
      }
      case 'string':
        return { ...d, namespace: d.namespace ?? namespace };
      case 'scene':
        return {
          ...d,
          name: `${namespace}.${d.name}`,
          systems: d.systems.map((system) =>
            system.includes('.') ? system : `${namespace}.${system}`,
          ),
        };
      case 'bgm':
        return { ...d, asset: d.asset.includes('.') ? d.asset : `${namespace}.${d.asset}` };
      case 'coupling':
      case 'loop':
        return d;
      case 'port':
        return { ...d, name: `${namespace}.${d.name}` };
      default:
        if ('name' in d && typeof d.name === 'string') {
          return { ...d, name: `${namespace}.${d.name}` } as Decl;
        }
        return d;
    }
  }

  private collect(decls: Decl[]): void {
    for (const d of decls) {
      switch (d.k) {
        case 'world':
          if (this.world) {
            this.error('NRO2004', `已经有一个世界「${this.world.name}」了，不能再声明第二个世界。`, d.span, {
              hint: '一个 .nro 文件只描述一个宇宙；要并行可以有多个文件。',
            });
          } else {
            this.world = d;
          }
          break;
        case 'entity':
          if (this.entityDecls.has(d.name)) {
            this.error('NRO2004', `实体「${d.name}」重复声明。`, d.span, { hint: '改个名字，或者删掉其中一个。' });
          } else {
            this.entityDecls.set(d.name, d);
            const fields: Record<string, string> = {};
            for (const f of d.fields) fields[f.key] = f.value;
            this.entities.set(d.name, {
              id: d.name,
              name: d.name,
              typeName: d.typeName ?? fields['种类'],
              fields,
            });
          }
          break;
        case 'string':
          this.declareString(d, undefined);
          break;
        case 'namespace': {
          this.namespaceDecls.push(d);
          this.namespaces.push({ name: d.name, exports: [...d.exports] });
          for (const exported of d.exports) this.exportedQualified.add(`${d.name}.${exported}`);
          for (const child of d.decls) this.collect([this.prefixNamespaceDecl(child, d.name)]);
          break;
        }
        case 'function':
          if (this.functionDecls.has(d.name)) {
            this.error('NRO2004', `函数「${d.name}」重复声明。`, d.span);
          } else {
            this.functionDecls.set(d.name, d);
            this.functions.push({
              id: `function:${d.name}`,
              name: d.name,
              params: [...d.params],
              paramTypes: [...d.paramTypes],
              returnType: d.returnType,
              locals: d.locals.map((local) => ({
                name: local.name,
                source: this.source.text.slice(local.expr.span.start.offset, local.expr.span.end.offset),
              })),
              bodySource: this.source.text.slice(d.body.span.start.offset, d.body.span.end.offset),
            });
          }
          break;
        case 'spectrum':
          this.declareSpectrum(d);
          break;
        case 'matrix':
          this.declareMatrix(d);
          break;
        case 'system':
          this.systemDecls.push(d);
          break;
        case 'scene':
          this.sceneDecls.push(d);
          break;
        case 'port':
          this.portDecls.push(d);
          break;
        case 'audio-asset':
          this.declareAudioAsset(d);
          break;
        case 'bgm':
          if (this.bgmDecl) {
            this.error('NRO2004', '世界只能声明一段「配乐」。', d.span);
          } else {
            this.bgmDecl = d;
          }
          break;
        case 'coupling':
          this.couplingDecls.push(d);
          break;
        case 'loop':
          if (this.loopDecls.some((l) => l.name === d.name)) {
            this.error('NRO2004', `回路「${d.name}」重复声明。`, d.span);
          }
          this.loopDecls.push(d);
          break;
        case 'forcing':
          if (this.forcingDecls.has(d.name)) this.error('NRO2004', `力迫「${d.name}」重复声明。`, d.span);
          this.forcingDecls.set(d.name, d);
          break;
        case 'chord':
          if (this.chordDecls.has(d.name)) this.error('NRO2004', `和弦「${d.name}」重复声明。`, d.span);
          this.chordDecls.set(d.name, d);
          break;
        case 'action':
          if (this.actionDecls.has(d.name)) this.error('NRO2004', `动作「${d.name}」重复声明。`, d.span);
          this.actionDecls.set(d.name, d);
          break;
        case 'signal':
          this.signalDecls.push(d);
          break;
        case 'ending':
          this.endingDecls.push(d);
          break;
        case 'axiom':
          this.axiomDecls.push(d);
          break;
        case 'form':
          if (this.formDecl) this.warn('NRO3305', '一个世界只演奏一个曲式，后面的曲式被忽略了。', d.span);
          else this.formDecl = d;
          break;
      }
    }

    // 实体内部嵌套的弦
    for (const d of decls) {
      if (d.k !== 'entity') continue;
      for (const s of d.strings) this.declareString(s, d.name);
    }

    // 弦和实体可能声明在谱之后；名字冲突必须等所有顶层名字都收集完再查。
    this.checkSpectrumNameConflicts();
    this.checkMatrixNameConflicts();
    this.checkMatrixPhaseSources();
    this.checkTimbreReferences();
    this.checkBgm();
  }

  /** v2.7：多矩阵联动——相位源指向源矩阵的格子（曲线或标量），且不能成环。 */
  private checkMatrixPhaseSources(): void {
    for (const matrix of this.matrices) {
      const source = matrix.phaseSource;
      if (!source) continue;
      const seen = new Set<string>([matrix.name]);
      let current: IRMatrix | undefined = matrix;
      while (current?.phaseSource) {
        const link = current.phaseSource;
        if (seen.has(link.matrix)) {
          this.error('NRO2100', `关系谱「${matrix.name}」的相位源形成了环。`, matrix.span ?? zeroSpan(), {
            hint: '相位源不能引用自己或形成循环依赖。',
          });
          delete matrix.phaseSource;
          break;
        }
        const target = this.matrixByName.get(link.matrix);
        if (!target) {
          const hint = suggestName(link.matrix, [...this.matrixByName.keys()]);
          this.error('NRO2101', `关系谱「${matrix.name}」的相位源引用了不存在的关系谱「${link.matrix}」。`, matrix.span ?? zeroSpan(), hint ? { hint: `你是不是想写「${hint}」？` } : undefined);
          delete matrix.phaseSource;
          break;
        }
        if (!target.rows.includes(link.row)) {
          this.error('NRO2101', `关系谱「${target.name}」没有行标签「${link.row}」。`, matrix.span ?? zeroSpan());
          delete matrix.phaseSource;
          break;
        }
        if (!target.cols.includes(link.col)) {
          this.error('NRO2101', `关系谱「${target.name}」没有列标签「${link.col}」。`, matrix.span ?? zeroSpan());
          delete matrix.phaseSource;
          break;
        }
        if (target.period === undefined) {
          this.error('NRO2100', `相位源「${target.name}」没有「周期」，无法提供相位。`, matrix.span ?? zeroSpan(), {
            hint: '源矩阵需要有周期，例如「周期 30」。',
          });
          delete matrix.phaseSource;
          break;
        }
        seen.add(target.name);
        current = target;
      }
    }
  }

  /** v2.0：弦的 `音色 谱名` 必须指向真实存在的谱。 */
  private checkTimbreReferences(): void {
    for (const string of this.strings.values()) {
      if (!string.timbre) continue;
      if (!this.spectrumNames.has(string.timbre)) {
        this.error('NRO2101', `弦「${string.id}」的音色引用了不存在的谱「${string.timbre}」。`, string.span ?? zeroSpan(), {
          hint: '先声明「谱 名字」，再在弦里写「音色 名字」。',
        });
      }
    }
  }

  /** v3.8：配乐必须引用已声明的音频资产，音量 0..1。 */
  private checkBgm(): void {
    const decl = this.bgmDecl;
    if (!decl) return;
    const asset = this.audioAssets.find((item) => item.id === decl.asset || item.name === decl.asset);
    if (!asset) {
      this.error('NRO2101', `配乐引用了不存在的音频资产「${decl.asset}」。`, decl.span, {
        hint: '先写「音频资产 名字 "audio/xxx.wav"」，再写「配乐 名字」。',
      });
      return;
    }
    let volume = decl.volume;
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      this.error('NRO2100', `配乐音量「${String(decl.volume)}」无效：必须在 0..1 之间。`, decl.span);
      volume = 0.35;
    }
    this.bgm = { asset: asset.id, volume, loop: decl.loop };
  }

  /** v3.7：音频资产，路径限制在 audio/ 下的一层音频文件。 */
  private declareAudioAsset(d: AudioAssetDecl): void {
    if (this.audioAssetNames.has(d.name)) {
      this.error('NRO2004', `音频资产「${d.name}」重复声明。`, d.span);
      return;
    }
    const src = d.src.trim().replace(/^\/+/, '');
    if (!/^audio\/[A-Za-z0-9._-]+\.(wav|mp3|ogg)$/i.test(src)) {
      this.error('NRO2108', `音频资产「${d.name}」的路径「${d.src}」无效。`, d.span, {
        hint: '只允许 audio/ 下一层的 .wav/.mp3/.ogg，例如 "audio/clock.wav"。',
      });
      return;
    }
    this.audioAssetNames.add(d.name);
    this.audioAssets.push({ id: d.name, name: d.name, src });
  }

  private declareSpectrum(d: SpectrumDecl): void {
    if (this.spectrumNames.has(d.name)) {
      this.error('NRO2004', `谱「${d.name}」重复声明。`, d.span, { hint: '改个名字，或者删掉其中一个。' });
      return;
    }
    this.spectrumNames.add(d.name);

    let min = d.min;
    let max = d.max;
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      this.error('NRO2100', `谱「${d.name}」的范围必须是有限数字（当前 ${min}..${max}）。`, d.span, {
        hint: '范围写成「范围 0..1」这样的两个有限数字。',
      });
      min = Number.isFinite(min) ? min : 0;
      max = Number.isFinite(max) ? max : 1;
    } else if (min >= max) {
      this.error('NRO2100', `谱「${d.name}」的范围 ${min}..${max} 无效：上界必须大于下界。`, d.span, {
        hint: '例如「范围 0..1」；下界和上界不能相等，也不能倒过来。',
      });
    }

    let interpolation: IRSpectrum['interpolation'] = d.interpolation;
    if (interpolation !== '线性' && interpolation !== '平滑' && interpolation !== '阶跃') {
      this.error('NRO2100', `谱「${d.name}」的插值方式「${String(interpolation)}」无效。`, d.span, {
        hint: '可用：线性、平滑、阶跃。',
      });
      interpolation = '线性';
    }

    let mode: IRSpectrum['mode'] = d.mode ?? '固定';
    if (mode !== '固定' && mode !== '受迫') {
      this.error('NRO2100', `谱「${d.name}」的模式「${String(mode)}」无效。`, d.span, {
        hint: '可用：固定、受迫。',
      });
      mode = '固定';
    }

    let articulation: IRSpectrum['articulation'] = d.articulation ?? '拨弦';
    if (articulation !== '拨弦' && articulation !== '持续') {
      this.error('NRO2100', `谱「${d.name}」的演奏方式「${String(articulation)}」无效。`, d.span, {
        hint: '可用：拨弦、持续。',
      });
      articulation = '拨弦';
    }

    if (d.bands.length === 0) {
      this.error('NRO2100', `谱「${d.name}」的「段」至少需要一个音段值。`, d.span, {
        hint: '空谱无法插值——写一行「段 0.1 0.4 0.8 0.5」。',
      });
    } else if (d.bands.length > 256) {
      this.error('NRO2100', `谱「${d.name}」有 ${d.bands.length} 个音段值，超过了上限 256。`, d.span, {
        hint: '一条谱最多 256 个音段；更长的数据请用算法或文件生成。',
      });
    }

    for (let i = 0; i < d.bands.length; i++) {
      const value = d.bands[i]!;
      if (!Number.isFinite(value)) {
        this.error('NRO2100', `谱「${d.name}」的第 ${i + 1} 个音段值不是有限数字。`, d.span);
        continue;
      }
      if (Number.isFinite(min) && Number.isFinite(max) && min < max && (value < min || value > max)) {
        this.error('NRO2100', `谱「${d.name}」的第 ${i + 1} 个音段值 ${value} 落在范围 ${min}..${max} 之外。`, d.span, {
          hint: '音段值必须落在范围内，不会自动截断——改值或放宽「范围」。',
        });
      }
    }

    this.spectra.push({
      id: d.name,
      name: d.name,
      bands: [...d.bands],
      min,
      max,
      interpolation,
      loop: d.loop,
      mode,
      articulation,
      span: d.span,
    });
  }

  /** 谱与弦/实体共享顶层命名空间：同名会让未来的引用产生歧义。 */
  private checkSpectrumNameConflicts(): void {
    for (const spectrum of this.spectra) {
      const span = spectrum.span ?? zeroSpan();
      if (this.strings.has(spectrum.name)) {
        this.error('NRO2004', `谱「${spectrum.name}」与同名弦冲突：顶层名字必须唯一。`, span, {
          hint: '给谱或弦改一个名字。',
        });
      } else if (this.entities.has(spectrum.name)) {
        this.error('NRO2004', `谱「${spectrum.name}」与同名实体冲突：顶层名字必须唯一。`, span, {
          hint: '给谱或实体改一个名字。',
        });
      }
    }
  }

  // ---------- 关系谱 ----------

  /**
   * v2.1c：关系谱是静态矩阵；v2.3a 起格子可以带运行时时间曲线。
   * 校验标签数量/唯一性、段的条数与宽度、所有值都是有限数字，以及每一条
   * 曲线的行列标签、音段数（1..64）、有限性和重复；出错时仍把原值放进 IR，
   * 供编辑器预览。
   *
   * 诊断码：形状/标签/曲线错误沿用谱的 NRO2100（NRO2103 已被力迫「先于」环占用），
   * 重名用 NRO2004，语法/未知字段由 parser 报 NRO1100。
   */
  private declareMatrix(d: MatrixDecl): void {
    if (this.matrixByName.has(d.name)) {
      this.error('NRO2004', `关系谱「${d.name}」重复声明。`, d.span, { hint: '改个名字，或者删掉其中一个。' });
      return;
    }

    if (d.rows.length === 0) {
      this.error('NRO2100', `关系谱「${d.name}」没有「行」标签。`, d.span, {
        hint: '至少写一行「行 甲 乙」；行标签是 查关系谱(..., "行名", ...) 的第二个参数。',
      });
    } else if (d.rows.length > 64) {
      this.error('NRO2100', `关系谱「${d.name}」有 ${d.rows.length} 个行标签，超过了上限 64。`, d.span, {
        hint: '一张关系谱最多 64 行；更大的表请拆成多张。',
      });
    }
    if (d.cols.length === 0) {
      this.error('NRO2100', `关系谱「${d.name}」没有「列」标签。`, d.span, {
        hint: '至少写一行「列 甲 乙」；列标签是 查关系谱(..., "列名") 的第三个参数。',
      });
    } else if (d.cols.length > 64) {
      this.error('NRO2100', `关系谱「${d.name}」有 ${d.cols.length} 个列标签，超过了上限 64。`, d.span, {
        hint: '一张关系谱最多 64 列；更大的表请拆成多张。',
      });
    }
    this.checkMatrixLabels(d.name, d.rows, '行', d.span);
    this.checkMatrixLabels(d.name, d.cols, '列', d.span);

    if (d.rows.length > 0 && d.values.length !== d.rows.length) {
      this.error(
        'NRO2100',
        `关系谱「${d.name}」需要 ${d.rows.length} 条「段」（每条对应一行），但写了 ${d.values.length} 条。`,
        d.span,
        { hint: '「段」的条数必须和「行」标签数一致。' },
      );
    }
    if (d.cols.length > 0) {
      for (let i = 0; i < d.values.length; i++) {
        const row = d.values[i]!;
        if (row.length !== d.cols.length) {
          this.error(
            'NRO2100',
            `关系谱「${d.name}」的第 ${i + 1} 条「段」有 ${row.length} 个数，但「列」有 ${d.cols.length} 个标签。`,
            d.span,
            { hint: `每条「段」必须正好写 ${d.cols.length} 个数字，顺序对应「列」。` },
          );
        }
      }
    }
    for (let i = 0; i < d.values.length; i++) {
      const row = d.values[i]!;
      for (let j = 0; j < row.length; j++) {
        if (!Number.isFinite(row[j]!)) {
          this.error('NRO2100', `关系谱「${d.name}」第 ${i + 1} 条「段」的第 ${j + 1} 个数不是有限数字。`, d.span, {
            hint: '矩阵值必须是有限的十进制数字（可以带负号）。',
          });
        }
      }
    }

    // 曲线是 v2.3a 的追加数据：标量「段」仍是必填的回退值。
    const seenCurves = new Set<string>();
    for (const curve of d.curves) {
      const span = curve.span ?? d.span;
      const rowIndex = d.rows.indexOf(curve.row);
      if (rowIndex < 0) {
        const hint = suggestName(curve.row, d.rows);
        this.error('NRO2100', `关系谱「${d.name}」的「曲线」引用了不存在的行标签「${curve.row}」。`, span, {
          hint: hint ? `你是不是想写「${hint}」？` : d.rows.length > 0 ? `可用的行：${d.rows.join('、')}。` : '先写「行」标签，再给格子加曲线。',
        });
      }
      const colIndex = d.cols.indexOf(curve.col);
      if (colIndex < 0) {
        const hint = suggestName(curve.col, d.cols);
        this.error('NRO2100', `关系谱「${d.name}」的「曲线」引用了不存在的列标签「${curve.col}」。`, span, {
          hint: hint ? `你是不是想写「${hint}」？` : d.cols.length > 0 ? `可用的列：${d.cols.join('、')}。` : '先写「列」标签，再给格子加曲线。',
        });
      }
      if (curve.bands.length === 0) {
        this.error('NRO2100', `关系谱「${d.name}」的曲线「${curve.row} × ${curve.col}」没有任何音段值。`, span, {
          hint: '一条曲线至少要有 1 个数字；没有曲线就删掉这一行。',
        });
      } else if (curve.bands.length > 64) {
        this.error(
          'NRO2100',
          `关系谱「${d.name}」的曲线「${curve.row} × ${curve.col}」有 ${curve.bands.length} 个音段值，超过了上限 64。`,
          span,
          { hint: '一条曲线最多 64 个采样点；更密的曲线请先降采样。' },
        );
      }
      for (let i = 0; i < curve.bands.length; i++) {
        if (!Number.isFinite(curve.bands[i]!)) {
          this.error(
            'NRO2100',
            `关系谱「${d.name}」的曲线「${curve.row} × ${curve.col}」第 ${i + 1} 个音段值不是有限数字。`,
            span,
            { hint: '曲线音段值必须是有限的十进制数字（可以带负号）。' },
          );
        }
      }
      if (curve.speed !== undefined && (!Number.isFinite(curve.speed) || curve.speed <= 0 || curve.speed > 8)) {
        this.error('NRO2100', `关系谱「${d.name}」的曲线「${curve.row} × ${curve.col}」速度无效：必须是 0..8 之间的正数。`, span);
      }
      if (curve.phase !== undefined && !Number.isFinite(curve.phase)) {
        this.error('NRO2100', `关系谱「${d.name}」的曲线「${curve.row} × ${curve.col}」相位无效。`, span);
      }
      if (rowIndex >= 0 && colIndex >= 0) {
        const cell = `${curve.row}\u0000${curve.col}`;
        if (seenCurves.has(cell)) {
          this.error('NRO2100', `关系谱「${d.name}」的格子「${curve.row} × ${curve.col}」声明了多条曲线。`, span, {
            hint: '一个格子只允许一条时间曲线；把采样点合并到同一行「曲线」里。',
          });
        }
        seenCurves.add(cell);
      }
    }

    let period = d.period;
    if (period !== undefined && (!Number.isFinite(period) || period <= 0 || period > 10000)) {
      this.error('NRO2100', `关系谱「${d.name}」的周期「${String(period)}」无效：必须是 0..10000 之间的正数拍。`, d.span, {
        hint: '周期表示曲线一个循环对应多少拍，例如「周期 40」。',
      });
      period = undefined;
    }

    let speed = d.speed ?? 1;
    if (!Number.isFinite(speed) || speed <= 0 || speed > 8) {
      this.error('NRO2100', `关系谱「${d.name}」的速度「${String(d.speed)}」无效：必须是 0..8 之间的正数。`, d.span, {
        hint: '速度是时间轴倍率，例如「速度 2」表示两倍快。',
      });
      speed = 1;
    }
    let phase = d.phase ?? 0;
    if (!Number.isFinite(phase)) {
      this.error('NRO2100', `关系谱「${d.name}」的相位无效。`, d.span);
      phase = 0;
    }
    phase = ((phase % 1) + 1) % 1;

    // v2.19：动态标量格。
    const dynamicCells: { row: string; col: string; expr: LExpr }[] = [];
    const seenDynamic = new Set<string>();
    for (const dynamic of d.dynamics) {
      if (!d.rows.includes(dynamic.row)) {
        this.error('NRO2101', `关系谱「${d.name}」的「动态」引用了不存在的行标签「${dynamic.row}」。`, dynamic.span ?? d.span);
        continue;
      }
      if (!d.cols.includes(dynamic.col)) {
        this.error('NRO2101', `关系谱「${d.name}」的「动态」引用了不存在的列标签「${dynamic.col}」。`, dynamic.span ?? d.span);
        continue;
      }
      const key = `${dynamic.row}\u0000${dynamic.col}`;
      if (seenDynamic.has(key)) {
        this.error('NRO2100', `关系谱「${d.name}」的格子「${dynamic.row} × ${dynamic.col}」声明了多条动态值。`, dynamic.span ?? d.span);
        continue;
      }
      if (d.curves.some((curve) => curve.row === dynamic.row && curve.col === dynamic.col)) {
        this.error('NRO2100', `关系谱「${d.name}」的格子「${dynamic.row} × ${dynamic.col}」不能同时有曲线和动态值。`, dynamic.span ?? d.span, {
          hint: '二选一：要随时间变化就用曲线，要用表达式就用动态值。',
        });
        continue;
      }
      seenDynamic.add(key);
      const lowered = this.lower(dynamic.expr, {});
      if (lowered.type !== 'number' && lowered.type !== 'any') {
        this.error('NRO2003', `关系谱「${d.name}」的动态格「${dynamic.row} × ${dynamic.col}」必须是数字表达式。`, dynamic.expr.span);
        continue;
      }
      dynamicCells.push({ row: dynamic.row, col: dynamic.col, expr: lowered.expr });
    }
    if (dynamicCells.length > 0) this.matrixDynamics.add(d.name);

    const matrix: IRMatrix = {
      id: d.name,
      name: d.name,
      rows: [...d.rows],
      cols: [...d.cols],
      values: d.values.map((row) => [...row]),
      curves: d.curves.map((curve) => ({
        row: curve.row,
        col: curve.col,
        bands: [...curve.bands],
        ...(curve.interpolation ? { interpolation: curve.interpolation } : {}),
        ...(curve.loop !== undefined ? { loop: curve.loop } : {}),
        ...(curve.speed !== undefined ? { speed: curve.speed } : {}),
        ...(curve.phase !== undefined ? { phase: ((curve.phase % 1) + 1) % 1 } : {}),
      })),
      ...(dynamicCells.length > 0 ? { dynamics: dynamicCells } : {}),
      interpolation: d.interpolation,
      loop: d.loop,
      ...(period !== undefined ? { period } : {}),
      speed,
      phase,
      ...(d.phaseSource ? { phaseSource: { ...d.phaseSource } } : {}),
      span: d.span,
    };
    this.matrices.push(matrix);
    this.matrixByName.set(matrix.name, matrix);
  }

  private checkMatrixLabels(name: string, labels: string[], which: '行' | '列', span: Span): void {
    const seen = new Set<string>();
    for (const label of labels) {
      if (seen.has(label)) {
        this.error('NRO2100', `关系谱「${name}」的${which}标签「${label}」重复。`, span, {
          hint: `${which}标签用于 查关系谱(...) 定位，必须唯一。`,
        });
      }
      seen.add(label);
    }
  }

  /** 关系谱与谱/弦/实体共享顶层命名空间：同名会让未来的引用产生歧义。 */
  private checkMatrixNameConflicts(): void {
    for (const matrix of this.matrices) {
      const span = matrix.span ?? zeroSpan();
      if (this.spectrumNames.has(matrix.name)) {
        this.error('NRO2004', `关系谱「${matrix.name}」与同名谱冲突：顶层名字必须唯一。`, span, {
          hint: '给关系谱或谱改一个名字。',
        });
      } else if (this.strings.has(matrix.name)) {
        this.error('NRO2004', `关系谱「${matrix.name}」与同名弦冲突：顶层名字必须唯一。`, span, {
          hint: '给关系谱或弦改一个名字。',
        });
      } else if (this.entities.has(matrix.name)) {
        this.error('NRO2004', `关系谱「${matrix.name}」与同名实体冲突：顶层名字必须唯一。`, span, {
          hint: '给关系谱或实体改一个名字。',
        });
      }
    }
  }

  private declareString(d: StringDecl, owner: string | undefined, namespace?: string): void {
    const scope = namespace ?? d.namespace;
    const id = owner ? `${owner}.${d.name}` : scope ? `${scope}.${d.name}` : d.name;
    if (this.strings.has(id)) {
      this.error('NRO2004', `弦「${id}」重复声明。`, d.span, { hint: '同一个实体下不能有两根同名的弦。' });
      return;
    }
    if (d.stringKind === '关系' && !d.target) {
      this.error('NRO2106', `关系弦「${id}」没有声明「对象」。`, d.span, {
        hint: '关系弦必须说明它是对谁的关系，例如「对象 秃鹫」。',
      });
    }
    if (d.stringKind !== '关系' && owner === undefined && d.target) {
      this.error('NRO2106', `只有关系弦需要「对象」，「${id}」多写了。`, d.span);
    }
    const explicitBaseline = this.baselineOf(d, id);
    const domain = this.domainOf(d, id, explicitBaseline);
    const baseline = explicitBaseline ?? defaultForDomain(domain);
    if (typeof baseline === 'number' && domain.type === 'number') {
      if (domain.min !== undefined && baseline < domain.min) {
        this.error('NRO2005', `弦「${id}」的基线 ${baseline} 小于取值范围的下界 ${domain.min}。`, d.span);
      }
      if (domain.max !== undefined && baseline > domain.max) {
        this.error('NRO2005', `弦「${id}」的基线 ${baseline} 大于取值范围的上界 ${domain.max}。`, d.span);
      }
    }
    const verge = this.constNumber(d.verge, `${id}.悬崖`, d.span);
    const safe = this.constNumber(d.safe, `${id}.安全`, d.span);

    if (d.verge || d.safe) {
      if (domain.type !== 'number') {
        this.error('NRO2005', `「${id}」不是数值弦，不能有悬崖线/安全线。`, d.span, {
          hint: '阈值只对数值弦有意义；布尔或集合弦请用「当」条件表达。',
        });
      } else if (verge !== undefined && safe !== undefined && verge === safe) {
        this.error('NRO2005', `「${id}」的悬崖线和安全线重合成了一条。`, d.span, {
          hint: '两条线之间要有区间，否则世界没有「紧张」这一档。',
        });
      } else {
        for (const [label, v] of [
          ['悬崖', verge],
          ['安全', safe],
        ] as const) {
          if (v === undefined) continue;
          if (domain.min !== undefined && v < domain.min) {
            this.error('NRO2005', `「${id}」的${label}线 ${v} 落在取值范围之外（最小 ${domain.min}）。`, d.span, {
              hint: '这条线永远不会被越过——改到范围内。',
            });
          }
          if (domain.max !== undefined && v > domain.max) {
            this.error('NRO2005', `「${id}」的${label}线 ${v} 落在取值范围之外（最大 ${domain.max}）。`, d.span, {
              hint: '这条线永远不会被越过——改到范围内。',
            });
          }
        }
      }
    }

    const ir: IRString = {
      id,
      name: d.name,
      kind: d.stringKind,
      domain,
      baseline,
      response: d.response ?? '线性',
      owner,
      ...(scope ? { namespace: scope } : {}),
      target: d.target,
      ...(d.timbre ? { timbre: d.timbre } : {}),
      note: d.note,
      span: d.span,
    };
    if (verge !== undefined) ir.verge = verge;
    if (safe !== undefined) ir.safe = safe;

    this.strings.set(id, ir);
    this.stringDecls.set(id, d);
    const short = d.name;
    const arr = this.shortNames.get(short) ?? [];
    arr.push(id);
    this.shortNames.set(short, arr);
  }

  private baselineOf(d: StringDecl, id: string): Value | undefined {
    if (!d.baseline) return undefined;
    const lowered = this.lower(d.baseline, {});
    if (lowered.type === 'any') return undefined;
    const v = evalConst(lowered.expr);
    if (v === undefined) {
      this.error('NRO2006', `弦「${id}」的基线必须是一个确定的常数。`, d.baseline.span, {
        hint: '基线是世界的初始值，不能引用别的弦。',
      });
      return undefined;
    }
    return v;
  }

  private domainOf(d: StringDecl, id: string, baseline: Value | undefined): IRString['domain'] {
    if (d.domain) {
      const dom = d.domain;
      if (dom.type === 'enum' && dom.values.length === 0) {
        this.error('NRO2005', `枚举类型「${id}」没有列出任何取值。`, d.span);
      }
      if (typeof baseline === 'number' && dom.type !== 'number') {
        this.error('NRO2003', `「${id}」的基线和类型对不上：类型是 ${describeDomain(dom)}，基线却是数字。`, d.span);
      }
      if (typeof baseline === 'boolean' && dom.type !== 'boolean') {
        this.error('NRO2003', `「${id}」的基线和类型对不上：类型是 ${describeDomain(dom)}，基线却是真/假。`, d.span);
      }
      if (typeof baseline === 'string' && dom.type === 'enum' && !dom.values.includes(baseline)) {
        this.error('NRO2003', `「${id}」的基线「${baseline}」不在枚举取值里（${dom.values.join('、')}）。`, d.span);
      }
      return dom as IRString['domain'];
    }
    // 推断
    if (baseline === undefined) {
      this.error('NRO2008', `无法确定弦「${id}」的类型。`, d.span, {
        hint: '给它写一个「类型」，或者写一个数字/真假的「基线」，让编译器自己推断。',
      });
      return { type: 'number' };
    }
    if (typeof baseline === 'number') return { type: 'number' };
    if (typeof baseline === 'boolean') return { type: 'boolean' };
    if (typeof baseline === 'string') return { type: 'text' };
    return { type: 'set' };
  }

  private constNumber(e: Expr | undefined, what: string, fallbackSpan: Span): number | undefined {
    if (!e) return undefined;
    const lowered = this.lower(e, {});
    const v = evalConst(lowered.expr);
    if (typeof v !== 'number') {
      this.error('NRO2006', `${what} 必须是一个数字常数。`, e.span);
      void fallbackSpan;
      return undefined;
    }
    return v;
  }

  // ---------- 名字解析 ----------

  private shortNameVisible(id: string, short: string, span: Span): boolean {
    const string = this.strings.get(id);
    const namespace = string?.namespace;
    if (!namespace || this.exportedQualified.has(id)) return true;
    this.error('NRO2001', `短名「${short}」在命名空间「${namespace}」里未导出；请写全「${id}」或加「导出 ${short}」。`, span);
    return false;
  }

  private resolve(parts: string[], span: Span, scope: Scope): string | undefined {
    const joined = parts.join('.');
    if (this.strings.has(joined)) {
      this.markRead(joined, 'reference');
      return joined;
    }
    if (parts.length === 1) {
      const short = parts[0]!;
      const cands = this.shortNames.get(short);
      if (cands && cands.length > 0) {
        if (cands.length === 1) {
          const id = cands[0]!;
          if (!this.shortNameVisible(id, short, span)) return undefined;
          this.markRead(id, 'reference');
          return id;
        }
        const ownerCand = scope.owner ? `${scope.owner}.${short}` : undefined;
        if (ownerCand && this.strings.has(ownerCand)) {
          if (!this.shortNameVisible(ownerCand, short, span)) return undefined;
          this.markRead(ownerCand, 'reference');
          return ownerCand;
        }
        this.error('NRO2002', `「${short}」这个名字有歧义：${cands.join('、')} 都叫这个。`, span, {
          hint: '用「实体.弦名」写全，例如「李严.信任」。',
        });
        return undefined;
      }
      // 全局弦 + 当前实体的短名
      if (scope.owner) {
        const cand = `${scope.owner}.${short}`;
        if (this.strings.has(cand)) {
          this.markRead(cand, 'reference');
          return cand;
        }
      }
    }
    const suggestion = suggestName(joined, [...this.strings.keys()]);
    this.error('NRO2001', `找不到叫「${joined}」的弦。`, span, suggestion ? { hint: `你是不是想写「${suggestion}」？` } : undefined);
    return undefined;
  }

  private markRead(id: string, who: string): void {
    const set = this.readBy.get(id) ?? new Set<string>();
    set.add(who);
    this.readBy.set(id, set);
  }

  private markWritten(id: string, who: string): void {
    const set = this.writtenBy.get(id) ?? new Set<string>();
    set.add(who);
    this.writtenBy.set(id, set);
  }

  // ---------- 表达式 ----------

  private lower(e: Expr, scope: Scope): { expr: LExpr; type: TypeName } {
    switch (e.k) {
      case 'num':
        return { expr: { k: 'const', v: e.v }, type: 'number' };
      case 'bool':
        return { expr: { k: 'const', v: e.v }, type: 'boolean' };
      case 'str':
        return { expr: { k: 'const', v: e.v }, type: 'text' };
      case 'set':
        return { expr: { k: 'const', v: e.items }, type: 'set' };
      case 'path': {
        const joined = e.parts.join('.');
        if (e.parts.length === 1 && scope.params?.has(joined)) {
          return { expr: { k: 'param', name: joined }, type: scope.params.get(joined) ?? 'any' };
        }
        // v2.3：此刻 = 当前拍数（无参内建值，可省略括号）。
        if (joined === '此刻') {
          return { expr: { k: 'call', fn: '此刻', args: [] }, type: 'number' };
        }
        // 实体名可以直接当作引用值使用（例如集合里的「管道」）。
        if (e.parts.length === 1 && !this.strings.has(joined) && this.entities.has(joined)) {
          return { expr: { k: 'const', v: joined }, type: 'ref' };
        }
        const id = this.resolve(e.parts, e.span, scope);
        if (!id) return { expr: { k: 'const', v: 0 }, type: 'any' };
        const s = this.strings.get(id)!;
        return { expr: { k: 'read', id }, type: typeOfDomain(s.domain) };
      }
      case 'un': {
        const inner = this.lower(e.operand, scope);
        if (e.op === '非') {
          if (inner.type !== 'boolean' && inner.type !== 'any') {
            this.error('NRO2003', `「非」只能作用于真/假，但这里是一个${typeLabel(inner.type)}。`, e.span);
          }
          return { expr: { k: 'un', op: '非', e: inner.expr }, type: 'boolean' };
        }
        if (inner.type !== 'number' && inner.type !== 'any') {
          this.error('NRO2003', `负号只能作用于数字，但这里是一个${typeLabel(inner.type)}。`, e.span);
        }
        return { expr: { k: 'un', op: e.op, e: inner.expr }, type: 'number' };
      }
      case 'bin': {
        const l = this.lower(e.left, scope);
        const r = this.lower(e.right, scope);
        if (e.op === '且' || e.op === '或') {
          if (l.type !== 'boolean' && l.type !== 'any') this.error('NRO2003', `「${e.op}」的左边应该是一个真假判断。`, e.left.span);
          if (r.type !== 'boolean' && r.type !== 'any') this.error('NRO2003', `「${e.op}」的右边应该是一个真假判断。`, e.right.span);
          return { expr: { k: 'bin', op: e.op, l: l.expr, r: r.expr }, type: 'boolean' };
        }
        if (['==', '!='].includes(e.op)) {
          if (!comparable(l.type, r.type)) {
            this.error('NRO2003', `不能拿一个${typeLabel(l.type)}和一个${typeLabel(r.type)}做比较。`, e.span);
          }
          return { expr: { k: 'bin', op: e.op, l: l.expr, r: r.expr }, type: 'boolean' };
        }
        if (['<', '<=', '>', '>='].includes(e.op)) {
          const ok = l.type === 'number' && r.type === 'number';
          if (!ok && l.type !== 'any' && r.type !== 'any') {
            this.error('NRO2003', `大小比较只支持数字，这里是${typeLabel(l.type)}和${typeLabel(r.type)}。`, e.span);
          }
          return { expr: { k: 'bin', op: e.op, l: l.expr, r: r.expr }, type: 'boolean' };
        }
        if (l.type !== 'number' && l.type !== 'any') this.error('NRO2003', `「${e.op}」的左边应该是数字。`, e.left.span);
        if (r.type !== 'number' && r.type !== 'any') this.error('NRO2003', `「${e.op}」的右边应该是数字。`, e.right.span);
        return { expr: { k: 'bin', op: e.op, l: l.expr, r: r.expr }, type: 'number' };
      }
      case 'if': {
        const cond = this.lower(e.cond, scope);
        if (cond.type !== 'boolean' && cond.type !== 'any') {
          this.error('NRO2003', `「如果」的条件应该是真假判断，这里是${typeLabel(cond.type)}。`, e.cond.span);
        }
        const then = this.lower(e.then, scope);
        const otherwise = this.lower(e.otherwise, scope);
        let type: TypeName = then.type;
        if (then.type !== 'any' && otherwise.type !== 'any' && then.type !== otherwise.type) {
          this.error('NRO2003', `「如果」两个分支类型不一致：${typeLabel(then.type)} 与 ${typeLabel(otherwise.type)}。`, e.span);
          type = 'any';
        } else if (then.type === 'any') {
          type = otherwise.type;
        }
        return {
          expr: { k: 'call', fn: '选择', args: [cond.expr, then.expr, otherwise.expr] },
          type,
        };
      }
      case 'call': {
        const args = e.args.map((a) => this.lower(a, scope));
        const user = this.functionDecls.get(e.name);
        if (user) {
          if (e.args.length !== user.params.length) {
            this.error('NRO2003', `函数「${e.name}」需要 ${user.params.length} 个参数，现在给了 ${e.args.length} 个。`, e.span);
            return { expr: { k: 'const', v: null }, type: 'any' };
          }
          const body = this.ensureFunctionBody(user.name, e.span);
          if (!body) return { expr: { k: 'const', v: null }, type: 'any' };
          for (let index = 0; index < user.params.length; index++) {
            const raw = user.paramTypes[index] ?? null;
            const expected = raw ? resolveFunctionType(raw) : 'any';
            const actual = args[index]!.type;
            if (expected && expected !== 'any' && actual !== 'any' && !assignable(actual, expected)) {
              this.error(
                'NRO2003',
                `函数「${e.name}」的参数「${user.params[index]!}」需要${typeLabel(expected)}，这里是${typeLabel(actual)}。`,
                e.args[index]!.span,
              );
            }
          }
          this.recordFunctionCall(this.currentFunction ?? '<world>', user.name);
          return {
            expr: {
              k: 'call',
              fn: `用户:${user.name}`,
              args: args.map((arg) => arg.expr),
            },
            type: this.functionReturnTypes.get(user.name) ?? 'any',
          };
        }
        const argTypes = args.map((a) => a.type);
        const fail = (want: string): { expr: LExpr; type: TypeName } => {
          this.error('NRO2003', `函数「${e.name}」需要${want}。`, e.span);
          return { expr: { k: 'const', v: null }, type: 'any' };
        };
        const l = args.map((a) => a.expr);
        switch (e.name) {
          case '数量':
            if (argTypes[0] !== 'set' && argTypes[0] !== 'any') return fail('一个集合');
            return { expr: { k: 'call', fn: '数量', args: l }, type: 'number' };
          case '包含':
            if ((argTypes[0] !== 'set' && argTypes[0] !== 'any') || args.length !== 2) return fail('一个集合和一个元素');
            return { expr: { k: 'call', fn: '包含', args: l }, type: 'boolean' };
          case '空':
            if (argTypes[0] !== 'set' && argTypes[0] !== 'text' && argTypes[0] !== 'any') return fail('一个集合或文本');
            return { expr: { k: 'call', fn: '空', args: l }, type: 'boolean' };
          case '最小':
          case '最大':
            if (args.length !== 2 || argTypes.some((t) => t !== 'number' && t !== 'any')) return fail('两个数字');
            return { expr: { k: 'call', fn: e.name, args: l }, type: 'number' };
          case '绝对值':
            if (args.length !== 1 || (argTypes[0] !== 'number' && argTypes[0] !== 'any')) return fail('一个数字');
            return { expr: { k: 'call', fn: '绝对值', args: l }, type: 'number' };
          case '存在':
            if (argTypes[0] !== 'ref' && argTypes[0] !== 'any') return fail('一个引用');
            return { expr: { k: 'call', fn: '存在', args: l }, type: 'boolean' };
          case '此刻':
            if (e.args.length !== 0) return fail('没有参数（此刻表示当前拍数）');
            return { expr: { k: 'call', fn: '此刻', args: [] }, type: 'number' };
          case '查谱': {
            if (e.args.length !== 2) {
              this.error('NRO2003', `函数「查谱」需要两个参数：谱名（字符串）和位置（数字），现在给了 ${e.args.length} 个。`, e.span, {
                hint: '例如：查谱("情绪地形", 0.5)。',
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            const nameArg = e.args[0]!;
            const position = args[1]!;
            if (argTypes[1] !== 'number' && argTypes[1] !== 'any') {
              this.error('NRO2003', `「查谱」的位置参数必须是数字，这里是${typeLabel(argTypes[1]!)}。`, e.args[1]!.span, {
                hint: '位置是 0..1 的归一化坐标，例如 查谱("情绪地形", 0.5)。',
              });
            }
            if (nameArg.k !== 'str') {
              this.error('NRO2003', '「查谱」的第一个参数必须是直接写出的谱名字符串。', nameArg.span, {
                hint: '谱名在编译期就要确定，例如 查谱("情绪地形", 0.5)。',
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            // 名字必须指向一条已声明的谱（WorldIR.spectra 的 id/name）。
            if (!this.spectrumNames.has(nameArg.v)) {
              const hint = suggestName(nameArg.v, [...this.spectrumNames]);
              this.error('NRO2101', `「查谱」引用了不存在的谱「${nameArg.v}」。`, nameArg.span, hint ? { hint: `你是不是想写「${hint}」？` } : { hint: '先声明「谱 名字」，再在表达式里查询它。' });
            }
            return {
              expr: { k: 'call', fn: '查谱', args: [{ k: 'const', v: nameArg.v }, position.expr] },
              type: 'number',
            };
          }
          case '查关系谱': {
            // v2.3a：三参数是编译期标量查表；四参数在有曲线时下降成
            // 运行时采样调用，没有曲线时仍折叠成标量（位置被忽略）。
            // 诊断沿用「查谱」：引用不存在用 NRO2101，参数形态用 NRO2003。
            if (e.args.length !== 3 && e.args.length !== 4) {
              this.error(
                'NRO2003',
                `函数「查关系谱」需要三个参数（矩阵名、行名、列名）或四个参数（再加位置），现在给了 ${e.args.length} 个。`,
                e.span,
                { hint: '例如：查关系谱("势力网", "信任", "色温") 或 查关系谱("势力网", "信任", "色温", 0.5)。' },
              );
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            const nameArg = e.args[0]!;
            const rowArg = e.args[1]!;
            const colArg = e.args[2]!;
            if (nameArg.k !== 'str' || rowArg.k !== 'str' || colArg.k !== 'str') {
              const bad = nameArg.k !== 'str' ? nameArg : rowArg.k !== 'str' ? rowArg : colArg;
              this.error('NRO2003', '「查关系谱」的参数必须是直接写出的字符串：矩阵名、行名、列名。', bad.span, {
                hint: '矩阵和标签都在编译期确定，例如 查关系谱("势力网", "信任", "色温")。',
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            if (!this.matrixByName.has(nameArg.v)) {
              const names = [...this.matrixByName.keys()];
              const hint = suggestName(nameArg.v, names);
              this.error('NRO2101', `「查关系谱」引用了不存在的关系谱「${nameArg.v}」。`, nameArg.span, {
                hint: hint
                  ? `你是不是想写「${hint}」？`
                  : names.length > 0
                    ? `已声明的关系谱：${names.join('、')}。`
                    : '先声明「关系谱 名字」，再在表达式里查它。',
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            const matrix = this.matrixByName.get(nameArg.v)!;
            const rowIndex = matrix.rows.indexOf(rowArg.v);
            if (rowIndex < 0) {
              const hint = suggestName(rowArg.v, matrix.rows);
              this.error('NRO2101', `关系谱「${matrix.name}」没有行标签「${rowArg.v}」。`, rowArg.span, {
                hint: hint ? `你是不是想写「${hint}」？` : `可用的行：${matrix.rows.join('、')}。`,
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            const colIndex = matrix.cols.indexOf(colArg.v);
            if (colIndex < 0) {
              const hint = suggestName(colArg.v, matrix.cols);
              this.error('NRO2101', `关系谱「${matrix.name}」没有列标签「${colArg.v}」。`, colArg.span, {
                hint: hint ? `你是不是想写「${hint}」？` : `可用的列：${matrix.cols.join('、')}。`,
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }

            const position = e.args.length === 4 ? args[3]! : undefined;
            if (position && argTypes[3] !== 'number' && argTypes[3] !== 'any') {
              this.error(
                'NRO2003',
                `「查关系谱」的位置参数必须是数字，这里是${typeLabel(argTypes[3]!)}。`,
                e.args[3]!.span,
                { hint: '位置是 0..1 的归一化坐标；省略位置时读取「段」的标量值。' },
              );
            }
            const hasCurve = matrix.curves.some((curve) => curve.row === rowArg.v && curve.col === colArg.v);
            if (position && hasCurve) {
              return {
                expr: {
                  k: 'call',
                  fn: '查关系谱',
                  args: [
                    { k: 'const', v: matrix.name },
                    { k: 'const', v: rowArg.v },
                    { k: 'const', v: colArg.v },
                    position.expr,
                  ],
                },
                type: 'number',
              };
            }
            // 三参数，或四参数但该格子没有曲线：矩阵的「段」是静态作者
            // 数据，直接折叠成常量；四参数的位置表达式没有可采样的曲线，
            // 因此被忽略（文档语义：无曲线的格子回退到标量值）。
            // v2.17：如果这张矩阵会被规则改动，不能折叠，运行时再读。
            if (this.matrixWrites.has(matrix.name) || this.matrixDynamics.has(matrix.name)) {
              return {
                expr: {
                  k: 'call',
                  fn: '查关系谱',
                  args: [
                    { k: 'const', v: matrix.name },
                    { k: 'const', v: rowArg.v },
                    { k: 'const', v: colArg.v },
                  ],
                },
                type: 'number',
              };
            }
            const cell = matrix.values[rowIndex]?.[colIndex];
            return {
              expr: { k: 'const', v: typeof cell === 'number' && Number.isFinite(cell) ? cell : 0 },
              type: 'number',
            };
          }
          case '谱位': {
            if (e.args.length !== 1) {
              this.error('NRO2003', `「谱位」需要一个参数：矩阵名（字符串），现在给了 ${e.args.length} 个。`, e.span, {
                hint: '例如：谱位("潮汐")。',
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            const nameArg = e.args[0]!;
            if (nameArg.k !== 'str') {
              this.error('NRO2003', '「谱位」的参数必须是直接写出的矩阵名字符串。', nameArg.span);
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            const matrix = this.matrixByName.get(nameArg.v);
            if (!matrix) {
              const hint = suggestName(nameArg.v, [...this.matrixByName.keys()]);
              this.error('NRO2101', `「谱位」引用了不存在的关系谱「${nameArg.v}」。`, nameArg.span, hint ? { hint: `你是不是想写「${hint}」？` } : undefined);
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            if (matrix.period === undefined) {
              this.error('NRO2100', `关系谱「${nameArg.v}」没有「周期」，无法计算时间轴位置。`, nameArg.span, {
                hint: '先给它加一句「周期 40」。',
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            return { expr: { k: 'call', fn: '谱位', args: [{ k: 'const', v: matrix.name }] }, type: 'number' };
          }
          case '当前谱值': {
            if (e.args.length !== 3) {
              this.error('NRO2003', `「当前谱值」需要三个参数：矩阵名、行、列（都是字符串），现在给了 ${e.args.length} 个。`, e.span, {
                hint: '例如：当前谱值("潮汐", "月相", "潮位")。',
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            const [nameArg, rowArg, colArg] = e.args as [Expr, Expr, Expr];
            if (nameArg.k !== 'str' || rowArg.k !== 'str' || colArg.k !== 'str') {
              this.error('NRO2003', '「当前谱值」的三个参数都必须是直接写出的字符串。', e.span);
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            const matrix = this.matrixByName.get(nameArg.v);
            if (!matrix) {
              const hint = suggestName(nameArg.v, [...this.matrixByName.keys()]);
              this.error('NRO2101', `「当前谱值」引用了不存在的关系谱「${nameArg.v}」。`, nameArg.span, hint ? { hint: `你是不是想写「${hint}」？` } : undefined);
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            if (!matrix.rows.includes(rowArg.v)) {
              const hint = suggestName(rowArg.v, matrix.rows);
              this.error('NRO2101', `关系谱「${matrix.name}」没有行标签「${rowArg.v}」。`, rowArg.span, hint ? { hint: `你是不是想写「${hint}」？` } : undefined);
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            if (!matrix.cols.includes(colArg.v)) {
              const hint = suggestName(colArg.v, matrix.cols);
              this.error('NRO2101', `关系谱「${matrix.name}」没有列标签「${colArg.v}」。`, colArg.span, hint ? { hint: `你是不是想写「${hint}」？` } : undefined);
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            if (!matrix.curves.some((curve) => curve.row === rowArg.v && curve.col === colArg.v)) {
              this.error('NRO2100', `关系谱「${matrix.name}」的「${rowArg.v} × ${colArg.v}」没有曲线，不能用当前谱值。`, e.span, {
                hint: '给这个格子加一条曲线，或改用三参数「查关系谱」读标量。',
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            if (matrix.period === undefined) {
              this.error('NRO2100', `关系谱「${matrix.name}」没有「周期」，无法计算当前谱值。`, nameArg.span, {
                hint: '先给它加一句「周期 40」。',
              });
              return { expr: { k: 'const', v: 0 }, type: 'number' };
            }
            return {
              expr: { k: 'call', fn: '当前谱值', args: [{ k: 'const', v: matrix.name }, { k: 'const', v: rowArg.v }, { k: 'const', v: colArg.v }] },
              type: 'number',
            };
          }
          default: {
            const hint = suggestName(e.name, ['数量', '包含', '空', '最小', '最大', '绝对值', '存在', '此刻', '查谱', '查关系谱', '谱位', '当前谱值']);
            this.error('NRO2007', `不认识函数「${e.name}」。`, e.span, hint ? { hint: `你是不是想用「${hint}」？` } : undefined);
            return { expr: { k: 'const', v: null }, type: 'any' };
          }
        }
      }
    }
  }

  /** v5.20：函数体只 lower 一次，调用节点只保留函数名。 */
  private buildFunctionBodies(): void {
    for (const name of this.functionDecls.keys()) this.ensureFunctionBody(name);
  }

  private ensureFunctionBody(name: string, span?: Span): LExpr | undefined {
    const cached = this.functionBodies.get(name);
    if (cached) return cached;
    const decl = this.functionDecls.get(name);
    if (!decl) return undefined;
    if (this.expandingFunctions.has(name)) {
      this.error('NRO2008', `函数「${name}」递归调用了自己。`, span ?? decl.span, { hint: '纯函数不能递归。' });
      return undefined;
    }
    this.expandingFunctions.add(name);
    const previousFunction = this.currentFunction;
    this.currentFunction = name;
    try {
      const params = new Map<string, TypeName>();
      for (let index = 0; index < decl.params.length; index++) {
        const raw = decl.paramTypes[index] ?? null;
        const type = raw ? resolveFunctionType(raw) : 'any';
        if (raw && !type) {
          this.error('NRO2003', `函数「${name}」的参数「${decl.params[index]!}」类型「${raw}」无效。`, decl.span, {
            hint: '可用：数值、真假、文本、枚举、集合、引用、任意。',
          });
          params.set(decl.params[index]!, 'any');
        } else {
          params.set(decl.params[index]!, type ?? 'any');
        }
      }
      const lowered = this.lower(this.expandLocals(decl), { params });
      const declaredReturn = decl.returnType ? resolveFunctionType(decl.returnType) : undefined;
      if (decl.returnType && !declaredReturn) {
        this.error('NRO2003', `函数「${name}」的返回类型「${decl.returnType}」无效。`, decl.span, {
          hint: '可用：数值、真假、文本、枚举、集合、引用、任意。',
        });
      }
      if (declaredReturn && lowered.type !== 'any' && !assignable(lowered.type, declaredReturn)) {
        this.error('NRO2003', `函数「${name}」声明返回${typeLabel(declaredReturn)}，实际返回${typeLabel(lowered.type)}。`, decl.body.span);
      }
      const returnType = declaredReturn ?? lowered.type;
      this.functionReturnTypes.set(name, returnType);
      this.functionBodies.set(name, lowered.expr);
      const irFunction = this.functions.find((fn) => fn.name === name);
      if (irFunction) irFunction.body = lowered.expr;
      return lowered.expr;
    } finally {
      this.currentFunction = previousFunction;
      this.expandingFunctions.delete(name);
    }
  }

  /** v5.21：记录调用边，用于未使用函数诊断。 */
  private recordFunctionCall(caller: string, callee: string): void {
    const set = this.functionCalls.get(caller) ?? new Set<string>();
    set.add(callee);
    this.functionCalls.set(caller, set);
  }

  /** v5.21：从世界级调用者出发做可达性分析；不可达函数给 warning。 */
  private diagnoseFunctionReachability(): void {
    const reachable = new Set<string>();
    const queue = ['<world>'];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const callee of this.functionCalls.get(current) ?? []) {
        if (reachable.has(callee)) continue;
        reachable.add(callee);
        queue.push(callee);
      }
    }
    for (const [name, decl] of this.functionDecls) {
      if (!reachable.has(name)) {
        this.warn('NRO3307', `函数「${name}」没有被任何规则/动作/系统调用。`, decl.span, {
          hint: '删掉它，或从一个会被执行的效果/条件里调用它。',
        });
      }
    }
  }

  /** v5.23：按顺序展开局部变量，再代入返回表达式；运行时无局部节点。 */
  private expandLocals(decl: FunctionDecl): Expr {
    const values = new Map<string, Expr>();
    for (const local of decl.locals) {
      values.set(local.name, this.substituteLocalExpr(local.expr, values));
    }
    return this.substituteLocalExpr(decl.body, values);
  }

  private substituteLocalExpr(expr: Expr, values: Map<string, Expr>): Expr {
    switch (expr.k) {
      case 'path': {
        if (expr.parts.length === 1) {
          const replacement = values.get(expr.parts[0]!);
          if (replacement) return replacement;
        }
        return expr;
      }
      case 'bin':
        return {
          ...expr,
          left: this.substituteLocalExpr(expr.left, values),
          right: this.substituteLocalExpr(expr.right, values),
        };
      case 'un':
        return { ...expr, operand: this.substituteLocalExpr(expr.operand, values) };
      case 'if':
        return {
          ...expr,
          cond: this.substituteLocalExpr(expr.cond, values),
          then: this.substituteLocalExpr(expr.then, values),
          otherwise: this.substituteLocalExpr(expr.otherwise, values),
        };
      case 'call':
        return { ...expr, args: expr.args.map((arg) => this.substituteLocalExpr(arg, values)) };
      default:
        return expr;
    }
  }

  private lowerGuard(e: Expr | undefined, scope: Scope, what: string): LExpr | undefined {
    if (!e) return undefined;
    const lowered = this.lower(e, scope);
    if (lowered.type !== 'boolean' && lowered.type !== 'any') {
      this.error('NRO2003', `${what}的「当」应该是一个真假判断，但这里是一个${typeLabel(lowered.type)}。`, e.span, {
        hint: '用比较写成判断，例如「信任 < 30」。',
      });
    }
    return lowered.expr;
  }

  // ---------- 耦合 ----------

  private buildCouplings(): void {
    for (const d of this.couplingDecls) {
      const from = this.resolve(d.from, d.span, {});
      const to = this.resolve(d.to, d.span, {});
      if (!from || !to) continue;
      this.requireNumeric(from, d.span, '耦合的起点');
      this.requireNumeric(to, d.span, '耦合的终点');
      if (from === to) {
        this.error('NRO2107', `「${from}」不能耦合到自己。`, d.span, { hint: '自我的变化请用「回路」表达，回路至少要两根弦。' });
        continue;
      }
      let staticStrength = 0.2;
      let strengthExpr: LExpr | undefined;
      if (d.strength) {
        const lowered = this.lower(d.strength, {});
        if (lowered.type !== 'number' && lowered.type !== 'any') {
          this.error('NRO2003', '耦合强度必须是数字表达式。', d.strength.span);
        } else {
          const constant = evalConst(lowered.expr);
          if (typeof constant === 'number') staticStrength = constant;
          else strengthExpr = lowered.expr;
        }
      }
      let delay = 0;
      let delayExpr: LExpr | undefined;
      if (d.delay) {
        const lowered = this.lower(d.delay, {});
        if (lowered.type !== 'number' && lowered.type !== 'any') {
          this.error('NRO2003', '耦合延迟必须是数字表达式。', d.delay.span);
        } else {
          const constant = evalConst(lowered.expr);
          if (typeof constant === 'number') delay = constant;
          else delayExpr = lowered.expr;
        }
      }
      if (delay < 0) this.error('NRO2107', '耦合延迟不能是负数。', d.span);
      const guard = this.lowerGuard(d.guard, {}, '耦合');
      const c: IRCoupling = {
        id: `c:${from}->${to}:${this.couplingSeq++}`,
        from,
        to,
        polarity: d.polarity,
        strength: staticStrength,
        delay: Math.max(0, delay),
        curve: d.curve ?? '线性',
        span: d.span,
      };
      if (strengthExpr) c.strengthExpr = strengthExpr;
      if (delayExpr) c.delayExpr = delayExpr;
      if (guard) c.guard = guard;
      this.couplings.push(c);
      this.markWritten(to, `耦合 ${from}→${to}`);
      this.markRead(from, `耦合 ${from}→${to}`);
      this.checkCurve(d.curve, d.span);
    }
  }

  private checkCurve(curve: ResponseCurve | undefined, span: Span): void {
    if (curve === '阶跃' || curve === '缓入' || curve === '缓出') {
      // 这些曲线在运行时是连续的吗？阶跃会让信号有一跳，属于体验级提示
      void curve;
      void span;
    }
  }

  private requireNumeric(id: string, span: Span, what: string): void {
    const s = this.strings.get(id);
    if (!s) return;
    if (s.domain.type !== 'number') {
      this.error('NRO2003', `${what}「${id}」必须是一根数值弦。`, span, {
        hint: `它是${describeDomain(s.domain)}，不能参与数值耦合。`,
      });
    }
  }

  // ---------- 回路 ----------

  private buildLoops(): void {
    for (const d of this.loopDecls) {
      const edges: IRCoupling[] = [];
      for (const e of d.edges) {
        const from = this.resolve(e.from, e.span, {});
        const to = this.resolve(e.to, e.span, {});
        if (!from || !to) continue;
        this.requireNumeric(from, e.span, '回路的起点');
        this.requireNumeric(to, e.span, '回路的终点');
        const c: IRCoupling = {
          id: `c:${from}->${to}:${this.couplingSeq++}`,
          from,
          to,
          polarity: e.polarity,
          strength: e.strength ?? 0.2,
          delay: Math.max(0, e.delay ?? 0),
          curve: '线性',
          loop: d.name,
          span: e.span,
        };
        edges.push(c);
        this.couplings.push(c);
        this.markWritten(to, `回路 ${d.name}`);
        this.markRead(from, `回路 ${d.name}`);
      }
      if (edges.length < 2) {
        this.error('NRO2101', `回路「${d.name}」至少要两条边。`, d.span);
        continue;
      }
      const cycleError = validateCycle(edges);
      if (cycleError) {
        this.error('NRO2101', `回路「${d.name}」不闭合：${cycleError}。`, d.span, {
          hint: '回路的每根弦要有且只有一条出边、一条入边，并且走一圈能回到起点。',
        });
        continue;
      }
      let polarity: 1 | -1 = 1;
      for (const e of edges) if (e.polarity === -1) polarity = polarity === 1 ? -1 : 1;
      this.loops.push({ id: `loop:${d.name}`, name: d.name, edges: edges.map((e) => e.id), polarity, span: d.span });
    }
  }

  // ---------- 规则 ----------

  private buildRules(): void {
    for (const d of this.forcingDecls.values()) {
      const rule: IRRule = {
        id: `forcing:${d.name}`,
        kind: 'forcing',
        name: d.name,
        effects: this.lowerEffects(d.effects, {}),
        irreversible: d.irreversible,
        priority: d.priority,
        before: d.before,
        repeat: d.repeat,
        cooldown: d.cooldown ?? 0,
        cost: 0,
        note: d.note,
        span: d.span,
      };
      const guard = this.lowerGuard(d.guard, {}, `力迫「${d.name}」`);
      if (guard) rule.guard = guard;
      if (d.cooldown !== undefined && !d.repeat) {
        this.warn('NRO3306', `力迫「${d.name}」写了「每 N 拍」但没有写「可重复」，这条冷却不会生效。`, d.span, {
          hint: '想让它反复触发，加一句「可重复」。',
        });
      }
      if (rule.cooldown < 0) this.error('NRO2107', `力迫「${d.name}」的冷却不能是负数。`, d.span);
      this.rules.push(rule);
    }

    for (const d of this.chordDecls.values()) {
      const rule: IRRule = {
        id: `chord:${d.name}`,
        kind: 'chord',
        name: d.name,
        effects: this.lowerEffects(d.effects, {}),
        irreversible: false,
        priority: 0,
        before: [],
        repeat: d.repeat,
        cooldown: 0,
        cost: 0,
        note: d.note,
        span: d.span,
      };
      const guard = this.lowerGuard(d.guard, {}, `和弦「${d.name}」`);
      if (guard) rule.guard = guard;
      this.rules.push(rule);
    }

    for (const d of this.actionDecls.values()) {
      const rule: IRRule = {
        id: `action:${d.name}`,
        kind: 'action',
        name: d.name,
        effects: this.lowerEffects(d.effects, {}),
        irreversible: false,
        priority: 0,
        before: [],
        repeat: true,
        cooldown: 0,
        cost: d.cost,
        note: d.note,
        span: d.span,
      };
      const guard = this.lowerGuard(d.guard, {}, `动作「${d.name}」`);
      if (guard) rule.guard = guard;
      if (d.cost < 0) this.error('NRO2107', `动作「${d.name}」的耗时不能是负数。`, d.span);
      this.rules.push(rule);
    }

    this.checkChordRecursion();
    this.checkPrecedence();
  }

  /** v2.17：规则/和弦/动作的效果可能改矩阵，先收集，禁止把这些格折叠成常量。 */
  private scanMatrixWrites(): void {
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      const node = value as Record<string, unknown>;
      const matrix = node.matrix;
      if (matrix && typeof matrix === 'object' && !Array.isArray(matrix)) {
        const name = (matrix as Record<string, unknown>).name;
        if (typeof name === 'string') this.matrixWrites.add(name);
      }
      for (const key of Object.keys(node)) {
        if (key === 'span') continue;
        visit(node[key]);
      }
    };
    visit(this.program.decls);
  }

  private lowerEffects(effects: EffectAst[], scope: Scope): IREffect[] {
    const out: IREffect[] = [];
    for (const e of effects) {
      if (e.k === 'scene') {
        if (!e.scene) continue;
        if (!this.sceneDecls.some((scene) => scene.name === e.scene)) {
          this.error('NRO2101', `找不到叫「${e.scene}」的场景。`, e.span);
          continue;
        }
        out.push({ k: 'scene', scene: e.scene });
        continue;
      }
      if (e.k === 'apply') {
        if (!e.chord) continue;
        if (!this.chordDecls.has(e.chord)) {
          const hint = suggestName(e.chord, [...this.chordDecls.keys()]);
          this.error('NRO2001', `找不到叫「${e.chord}」的和弦。`, e.span, hint ? { hint: `你是不是想写「${hint}」？` } : undefined);
          continue;
        }
        out.push({ k: 'apply', chord: `chord:${e.chord}` });
        continue;
      }
      if (e.matrix) {
        const matrix = this.matrixByName.get(e.matrix.name);
        if (!matrix) {
          const hint = suggestName(e.matrix.name, [...this.matrixByName.keys()]);
          this.error('NRO2101', `找不到关系谱「${e.matrix.name}」。`, e.span, hint ? { hint: `你是不是想写「${hint}」？` } : undefined);
          continue;
        }
        if (!matrix.rows.includes(e.matrix.row)) {
          this.error('NRO2101', `关系谱「${matrix.name}」没有行标签「${e.matrix.row}」。`, e.span);
          continue;
        }
        if (!matrix.cols.includes(e.matrix.col)) {
          this.error('NRO2101', `关系谱「${matrix.name}」没有列标签「${e.matrix.col}」。`, e.span);
          continue;
        }
        if (matrix.dynamics?.some((dynamic) => dynamic.row === e.matrix!.row && dynamic.col === e.matrix!.col)) {
          this.error('NRO2100', `关系谱「${matrix.name}」的「${e.matrix.row} × ${e.matrix.col}」是动态格，不能被效果写入。`, e.span, {
            hint: '动态格由「动态 行 列 表达式」计算；要可写请改成普通「段」格。',
          });
          continue;
        }
        const lowered = e.value ? this.lower(e.value, scope) : { expr: { k: 'const', v: 0 } as LExpr, type: 'any' as TypeName };
        if (lowered.type !== 'number' && lowered.type !== 'any') {
          this.error('NRO2003', `关系谱格「${matrix.name} ${e.matrix.row} ${e.matrix.col}」只能写数字。`, e.span);
        }
        out.push({
          k: e.k === 'set' ? 'matrixSet' : e.k === 'add' ? 'matrixAdd' : 'matrixSub',
          matrix: matrix.name,
          row: e.matrix.row,
          col: e.matrix.col,
          value: lowered.expr,
        });
        this.matrixWrites.add(matrix.name);
        continue;
      }
      if (!e.target) continue;
      const id = this.resolve(e.target, e.span, scope);
      if (!id) continue;
      const s = this.strings.get(id)!;
      const value = e.value ? this.lower(e.value, scope) : { expr: { k: 'const', v: null } as LExpr, type: 'any' as TypeName };

      if (e.k === 'set') {
        if (!assignable(value.type, typeOfDomain(s.domain))) {
          this.error('NRO2003', `不能把${typeLabel(value.type)}赋给${describeDomain(s.domain)}的「${id}」。`, e.span);
        }
      } else {
        // += / -=：数字做加减，集合做增删
        if (s.domain.type === 'number') {
          if (value.type !== 'number' && value.type !== 'any') {
            this.error('NRO2003', `「${id}」是数值弦，只能加减数字，不能加减${typeLabel(value.type)}。`, e.span);
          }
        } else if (s.domain.type === 'set') {
          if (value.type !== 'text' && value.type !== 'enum' && value.type !== 'ref' && value.type !== 'any') {
            this.error('NRO2003', `「${id}」是集合，只能往里加/删元素，不能加一个${typeLabel(value.type)}。`, e.span);
          }
        } else {
          this.error('NRO2003', `「${id}」是${describeDomain(s.domain)}，不能用 ${e.k === 'add' ? '+=' : '-='} 修改。`, e.span, {
            hint: '布尔或文本弦请用「=」直接赋值。',
          });
        }
      }
      out.push({ k: e.k, id, value: value.expr });
      this.markWritten(id, '规则');
    }
    return out;
  }

  private checkChordRecursion(): void {
    const graph = new Map<string, string[]>();
    for (const r of this.rules) {
      if (r.kind !== 'chord') continue;
      const targets = r.effects.filter((e): e is { k: 'apply'; chord: string } => e.k === 'apply').map((e) => e.chord);
      graph.set(r.id, targets);
    }
    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const visit = (id: string): boolean => {
      const st = state.get(id) ?? 0;
      if (st === 1) {
        const cycle = [...stack.slice(stack.indexOf(id)), id].join(' → ');
        const span = this.rules.find((r) => r.id === id)?.span;
        this.error('NRO2105', `和弦套和弦形成了死循环：${cycle}。`, span ?? { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } }, {
          hint: '让其中一个和弦直接写效果，而不是再去「施加」另一个。',
        });
        return true;
      }
      if (st === 2) return false;
      state.set(id, 1);
      stack.push(id);
      for (const next of graph.get(id) ?? []) {
        if (graph.has(next) && visit(next)) return true;
      }
      stack.pop();
      state.set(id, 2);
      return false;
    };
    for (const id of graph.keys()) {
      if (!state.has(id)) visit(id);
    }
  }

  private checkPrecedence(): void {
    const forcings = this.rules.filter((r) => r.kind === 'forcing');
    const byName = new Map(forcings.map((r) => [r.name, r]));
    const edges = new Map<string, string[]>();
    for (const r of forcings) {
      const outs: string[] = [];
      for (const b of r.before) {
        const target = byName.get(b);
        if (!target) {
          const hint = suggestName(b, [...byName.keys()]);
          this.error('NRO2001', `「${r.name}」想先于「${b}」，但没有这个力迫。`, r.span ?? zeroSpan(), hint ? { hint: `你是不是想写「${hint}」？` } : undefined);
          continue;
        }
        outs.push(target.id);
      }
      edges.set(r.id, outs);
    }
    const state = new Map<string, 0 | 1 | 2>();
    const visit = (id: string, stack: string[]): boolean => {
      const st = state.get(id) ?? 0;
      if (st === 1) {
        const names = [...stack.slice(stack.indexOf(id)), id].map((x) => x.replace(/^forcing:/, ''));
        this.error('NRO2103', `力迫的「先于」关系绕成了一个环：${names.join(' → ')}。`, zeroSpan(), {
          hint: '偏序必须能排出先后；去掉其中一条「先于」。',
        });
        return true;
      }
      if (st === 2) return false;
      state.set(id, 1);
      stack.push(id);
      for (const next of edges.get(id) ?? []) if (visit(next, stack)) return true;
      stack.pop();
      state.set(id, 2);
      return false;
    };
    for (const r of forcings) if (!state.has(r.id)) visit(r.id, []);
  }

  // ---------- 公理 / 信号 / 结局 / 曲式 ----------

  /** v5.1：系统是运行层调度单元，不改变弦网络本体。 */
  private buildSystems(): void {
    const seen = new Set<string>();
    for (const d of this.systemDecls) {
      if (seen.has(d.name)) {
        this.error('NRO2004', `系统「${d.name}」重复声明。`, d.span);
        continue;
      }
      seen.add(d.name);
      const guard = d.guard ? this.lowerGuard(d.guard, {}, `系统「${d.name}」`) : undefined;
      this.systems.push({
        id: `system:${d.name}`,
        name: d.name,
        phase: d.phase,
        every: d.every,
        ...(guard ? { guard } : {}),
        effects: this.lowerEffects(d.effects, {}),
        span: d.span,
      });
    }
  }

  /** v5.1：场景只启用系统 + 进入/离开效果，不能声明弦。 */
  private buildScenes(): void {
    const systemNames = new Set(this.systems.map((system) => system.name));
    const seen = new Set<string>();
    for (const d of this.sceneDecls) {
      if (seen.has(d.name)) {
        this.error('NRO2004', `场景「${d.name}」重复声明。`, d.span);
        continue;
      }
      seen.add(d.name);
      const systems: string[] = [];
      for (const name of d.systems) {
        if (!systemNames.has(name)) {
          const hint = suggestName(name, [...systemNames]);
          this.error('NRO2101', `场景「${d.name}」启用了不存在的系统「${name}」。`, d.span, hint ? { hint: `你是不是想写「${hint}」？` } : undefined);
          continue;
        }
        if (!systems.includes(name)) systems.push(name);
      }
      this.scenes.push({
        id: `scene:${d.name}`,
        name: d.name,
        systems,
        enter: this.lowerEffects(d.enter, {}),
        exit: this.lowerEffects(d.exit, {}),
        span: d.span,
      });
    }
  }

  /** v5.6：端口只绑定已有弦，不创造新状态。 */
  private buildPorts(): void {
    const seen = new Set<string>();
    for (const d of this.portDecls) {
      const key = `${d.kind}:${d.name}`;
      if (seen.has(key)) {
        this.error('NRO2004', `${d.kind}端口「${d.name}」重复声明。`, d.span);
        continue;
      }
      seen.add(key);
      const paramNames = new Set<string>();
      const params: IRPort['params'] = [];
      for (const param of d.params) {
        if (paramNames.has(param.name)) {
          this.error('NRO2004', `端口「${d.name}」的参数「${param.name}」重复。`, d.span);
          continue;
        }
        paramNames.add(param.name);
        const id = this.resolve(param.string.split('.'), d.span, {});
        if (!id) continue;
        params.push({ name: param.name, string: id });
      }
      this.ports.push({
        id: `port:${d.kind}:${d.name}`,
        name: d.name,
        kind: d.kind,
        params,
      });
    }
  }

  private buildAxioms(): void {
    for (const d of this.axiomDecls) {
      const lowered = this.lower(d.expr, {});
      if (lowered.type !== 'boolean' && lowered.type !== 'any') {
        this.error('NRO2003', `公理「${d.name}」必须是一个永远为真的判断。`, d.expr.span);
      }
      const v = evalConst(lowered.expr);
      if (v === false) {
        this.error('NRO2104', `公理「${d.name}」从一开始就是假的。`, d.span, { hint: '它约束的初值自相矛盾，这个世界不可能存在。' });
      }
      this.axioms.push({ id: `axiom:${d.name}`, name: d.name, expr: lowered.expr, span: d.span });
      this.markAxiomReads(lowered.expr);
      this.checkAxiomAgainstEffects(d.name, lowered.expr, d.span);
    }
  }

  private markAxiomReads(e: LExpr): void {
    if (e.k === 'read') this.markRead(e.id, '公理');
    else if (e.k === 'bin') {
      this.markAxiomReads(e.l);
      this.markAxiomReads(e.r);
    } else if (e.k === 'un') this.markAxiomReads(e.e);
    else if (e.k === 'call') e.args.forEach((a) => this.markAxiomReads(a));
  }

  private checkAxiomAgainstEffects(name: string, expr: LExpr, span: Span): void {
    // 只做「简单等式公理 vs 直接赋值」的静态对撞，覆盖最常见的一类矛盾。
    let id: string | undefined;
    let expected: Value | undefined;
    let equality = true;
    if (expr.k === 'bin' && (expr.op === '==' || expr.op === '!=')) {
      equality = expr.op === '==';
      if (expr.l.k === 'read' && expr.r.k === 'const') {
        id = expr.l.id;
        expected = expr.r.v;
      } else if (expr.r.k === 'read' && expr.l.k === 'const') {
        id = expr.r.id;
        expected = expr.l.v;
      }
    }
    if (!id || expected === undefined) return;
    for (const r of this.rules) {
      for (const e of r.effects) {
        if (e.k !== 'set' || e.id !== id) continue;
        const v = evalConst(e.value);
        if (v === undefined) continue;
        const same = JSON.stringify(v) === JSON.stringify(expected);
        if (equality ? !same : same) {
          this.error(
            'NRO2104',
            `「${r.name}」会把「${id}」改成 ${formatValue(v)}，这会破坏公理「${name}」（${formatValue(expected)} ${equality ? '==' : '!='} ${id}）。`,
            r.span ?? span,
            { hint: '要么改掉这条效果，要么放松公理——两者不能同时成立。' },
          );
        }
      }
    }
  }

  private buildSignals(): void {
    for (const d of this.signalDecls) {
      const guard = this.lowerGuard(d.guard, {}, `信号「${d.name}」`);
      const cues: IRCue[] = d.cues.map((c) => this.cueOf(c));
      this.signals.push({ id: `signal:${d.name}`, name: d.name, guard: guard ?? { k: 'const', v: false }, cues, span: d.span });
      if (guard) this.markSignalReads(guard);
      if (cues.length === 0) {
        this.error('NRO2108', `信号「${d.name}」没有呈现方式，玩家什么也感知不到。`, d.span);
      }
    }
  }

  private markSignalReads(e: LExpr): void {
    if (e.k === 'read') this.markRead(e.id, '信号');
    else if (e.k === 'bin') {
      this.markSignalReads(e.l);
      this.markSignalReads(e.r);
    } else if (e.k === 'un') this.markSignalReads(e.e);
    else if (e.k === 'call') e.args.forEach((a) => this.markSignalReads(a));
  }

  private cueOf(c: CueAst): IRCue {
    switch (c.k) {
      case '台词':
        return { k: '台词', speaker: c.speaker, text: c.text };
      case '视觉':
      case '音频':
        return { k: c.k, param: c.param, value: c.value };
      default:
        return { k: c.k, text: c.text };
    }
  }

  private buildEndings(): void {
    for (const d of this.endingDecls) {
      const lowered = this.lower(d.guard, {});
      if (lowered.type !== 'boolean' && lowered.type !== 'any') {
        this.error('NRO2003', `结局「${d.name}」的触发条件必须是真假判断。`, d.guard.span);
      }
      const rawNexts = d.nextChapters ?? (d.nextChapter ? [d.nextChapter] : []);
      const nexts: string[] = [];
      for (const nextChapter of rawNexts) {
        if (!/^examples\/[^/\\]+\.nro$/.test(nextChapter)) {
          this.error('NRO2101', `结局「${d.name}」的下一章路径「${nextChapter}」无效。`, d.span, {
            hint: '只允许 examples/<名字>.nro，并写成字符串。',
          });
        } else {
          nexts.push(nextChapter);
        }
      }
      this.endings.push({
        id: `ending:${d.name}`,
        name: d.name,
        guard: lowered.expr,
        ...(nexts.length > 0 ? { nextChapter: nexts[0]! } : {}),
        ...(nexts.length > 1 ? { nextChapters: nexts } : {}),
        span: d.span,
      });
      this.markEndingReads(lowered.expr);
    }
  }

  private markEndingReads(e: LExpr): void {
    if (e.k === 'read') this.markRead(e.id, '结局');
    else if (e.k === 'bin') {
      this.markEndingReads(e.l);
      this.markEndingReads(e.r);
    } else if (e.k === 'un') this.markEndingReads(e.e);
    else if (e.k === 'call') e.args.forEach((a) => this.markEndingReads(a));
  }

  private buildPhases(): void {
    if (!this.formDecl) return;
    for (const p of this.formDecl.phases) {
      if (p.duration <= 0) {
        this.error('NRO2107', `段落「${p.name}」的时长必须大于 0。`, p.span);
        continue;
      }
      this.phases.push({ id: `phase:${p.name}`, name: p.name, duration: p.duration });
    }
  }

  // ---------- 分析 ----------

  private analyze(): void {
    this.analyzeLoops();
    this.analyzeSilence();
    this.analyzeDeadStrings();
    this.analyzeEndings();
    this.analyzeUniverse();
  }

  private analyzeLoops(): void {
    for (const loop of this.loops) {
      const edges = loop.edges.map((id) => this.couplings.find((c) => c.id === id)).filter((c): c is IRCoupling => !!c);
      const ids = new Set<string>();
      for (const e of edges) {
        ids.add(e.from);
        ids.add(e.to);
      }
      const clamp = [...ids].some((id) => {
        const s = this.strings.get(id);
        if (!s || s.domain.type !== 'number') return false;
        return s.verge !== undefined || s.safe !== undefined || s.domain.min !== undefined || s.domain.max !== undefined;
      });
      const referencedByEnding = this.endings.some((en) => exprReads(en.guard, ids));
      const span = loop.span ?? zeroSpan();

      if (loop.polarity === 1) {
        if (!clamp && !referencedByEnding) {
          this.error(
            'NRO2102',
            `回路「${loop.name}」是自我强化的，但环上没有任何闸门，也没有结局接住它——这个世界会一路冲向无穷。`,
            span,
            {
              hint: '给环上至少一根弦加「悬崖」/「安全」线，或者写一个引用这些弦的「结局」。',
            },
          );
        } else if (!clamp) {
          this.warn('NRO3307', `回路「${loop.name}」是自我强化的，靠结局直接截断，环本身没有闸门。`, span, {
            hint: '加一条阈值会让压力在体验层更可读。',
          });
        }
      } else if (!clamp) {
        this.warn('NRO3106', `回路「${loop.name}」是自我校正的，但没有阈值——它可能收敛到一个静止点，故事会「死水化」。`, span, {
          hint: '给环上某根弦加一条悬崖线，让收敛点之前有可感知的压力。',
        });
      }
    }
  }

  private analyzeSilence(): void {
    for (const s of this.strings.values()) {
      if (s.domain.type !== 'number') continue;
      if (s.verge === undefined && s.safe === undefined) continue;
      const readers = this.readBy.get(s.id);
      const hasSignal = [...(readers ?? [])].some((r) => r === '信号');
      if (!hasSignal) {
        this.warn(
          'NRO3101',
          `「${s.id}」会越过悬崖，但没有任何「信号」让玩家看见/听见——这属于静默失败。`,
          s.span ?? zeroSpan(),
          { hint: `写一条「信号」，在「当 ${s.id} ${s.verge !== undefined ? (s.verge < (s.safe ?? Infinity) ? '<' : '>') : '<'} ${s.verge ?? s.safe}」时给出台词、视觉或音频。` },
        );
      }
    }
  }

  private analyzeDeadStrings(): void {
    for (const s of this.strings.values()) {
      const read = this.readBy.get(s.id);
      if (!read || read.size === 0) {
        const written = this.writtenBy.get(s.id);
        if (written && written.size > 0) {
          this.warn('NRO3102', `「${s.id}」有人改，但没有任何规则、信号或结局读取它——它是一根死弦。`, s.span ?? zeroSpan(), {
            hint: '把它接到一条耦合、一个信号或一个结局上，否则它不影响任何事。',
          });
        } else {
          this.warn('NRO3102', `「${s.id}」既没有人读，也没有人写——它从开局到结束都是基线值。`, s.span ?? zeroSpan());
        }
      }
    }
  }

  private analyzeEndings(): void {
    if (this.endings.length === 0) {
      this.warn('NRO3104', '这个世界没有「结局」——模拟会一直跑到拍数上限。', this.world?.span ?? zeroSpan(), {
        hint: '至少写一个「结局 崩坏: 当 …」，让世界有落点。',
      });
      return;
    }
    const written = new Set(this.writtenBy.keys());
    for (const en of this.endings) {
      const ids = new Set<string>();
      collectReads(en.guard, ids);
      const reachable = [...ids].some((id) => written.has(id));
      if (!reachable) {
        this.warn('NRO3103', `结局「${en.name}」依赖的弦从来不会被改变，所以它可能永远不会发生。`, en.span ?? zeroSpan(), {
          hint: '检查是否有力迫、动作或耦合真的会推动这些弦。',
        });
      }
    }
  }

  private analyzeUniverse(): void {
    if (!this.world) {
      this.error('NRO2009', '这个文件没有「世界」声明。', zeroSpan(), {
        hint: '第一行写「世界 你的世界名」。',
      });
    }
    if (this.rules.filter((r) => r.kind === 'action').length === 0) {
      this.warn('NRO3105', '这个世界没有任何「动作」——玩家无法介入，只能看它自己演化。', this.world?.span ?? zeroSpan(), {
        hint: '如果这是有意的（纯演化世界），可以忽略；否则写几个「动作」。',
      });
    }
    for (const s of this.strings.values()) {
      if (s.kind === '关系' && s.target && !this.entities.has(s.target)) {
        this.error('NRO2001', `关系弦「${s.id}」的对象「${s.target}」不是已声明的实体。`, s.span ?? zeroSpan());
      }
      const dom = s.domain;
      if (dom.type === 'ref' && dom.entityKind) {
        const kind = dom.entityKind;
        if (![...this.entities.values()].some((e) => e.typeName === kind)) {
          this.warn('NRO3308', `引用类型「${s.id}」指向的种类「${kind}」不存在任何实体。`, s.span ?? zeroSpan());
        }
      }
    }
    if (this.strings.size === 0) {
      this.error('NRO2009', '这个世界一根弦都没有。', this.world?.span ?? zeroSpan(), {
        hint: '从「叙事弦 信任」这样的声明开始。',
      });
    }
  }

  // ---------- 组装 ----------

  private assemble(): WorldIR {
    const meta: Record<string, string | number> = {};
    if (this.world) for (const m of this.world.meta) meta[m.key] = m.value;
    if (!meta['调性']) meta['调性'] = '未定';
    return {
      format: 'neurou/ir-0.1',
      name: this.world?.name ?? '未命名世界',
      meta,
      entities: [...this.entities.values()],
      strings: [...this.strings.values()],
      spectra: this.spectra,
      matrices: this.matrices,
      ...(this.audioAssets.length > 0 ? { audioAssets: this.audioAssets } : {}),
      ...(this.bgm ? { bgm: this.bgm } : {}),
      ...(this.systems.length > 0 ? { systems: this.systems } : {}),
      ...(this.scenes.length > 0 ? { scenes: this.scenes } : {}),
      ...(this.ports.length > 0 ? { ports: this.ports } : {}),
      ...(this.namespaces.length > 0 ? { namespaces: this.namespaces } : {}),
      ...(this.functions.length > 0 ? { functions: this.functions } : {}),
      couplings: this.couplings,
      loops: this.loops,
      rules: this.rules,
      axioms: this.axioms,
      signals: this.signals,
      phases: this.phases,
      endings: this.endings,
      stats: {
        strings: this.strings.size,
        spectra: this.spectra.length,
        matrices: this.matrices.length,
        couplings: this.couplings.length,
        loops: this.loops.length,
        rules: this.rules.length,
        signals: this.signals.length,
        endings: this.endings.length,
      },
    };
  }

  // ---------- 诊断快捷方式 ----------

  private error(code: string, message: string, span: Span, opts?: { hint?: string; related?: string[] }): void {
    this.diagnostics.error(code, 'semantic', message, { span, file: this.source.path, ...opts });
  }

  private warn(code: string, message: string, span: Span, opts?: { hint?: string; related?: string[] }): void {
    const tier = code.startsWith('NRO3') ? 'experience' : 'semantic';
    this.diagnostics.warn(code, tier, message, { span, file: this.source.path, ...opts });
  }
}

// ---------- 纯函数工具 ----------

function zeroSpan(): Span {
  const p = { line: 0, column: 0, offset: 0 };
  return { start: p, end: p };
}

function defaultForDomain(d: IRString['domain']): Value {
  switch (d.type) {
    case 'number':
      return d.min ?? 0;
    case 'boolean':
      return false;
    case 'enum':
      return d.values[0] ?? '';
    case 'set':
      return [];
    case 'text':
      return '';
    case 'ref':
      return null;
  }
}

function typeOfDomain(d: IRString['domain']): TypeName {
  switch (d.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return 'enum';
    case 'set':
      return 'set';
    case 'text':
      return 'text';
    case 'ref':
      return 'ref';
  }
}

function typeLabel(t: TypeName): string {
  const map: Record<TypeName, string> = {
    number: '数字',
    boolean: '真假值',
    text: '文本',
    enum: '枚举值',
    set: '集合',
    ref: '引用',
    any: '未知类型',
  };
  return map[t];
}

function describeDomain(d: IRString['domain']): string {
  switch (d.type) {
    case 'number':
      return d.min !== undefined && d.max !== undefined ? `数值(${d.min}..${d.max})` : '数值';
    case 'boolean':
      return '布尔';
    case 'enum':
      return `枚举(${d.values.join('、')})`;
    case 'set':
      return d.elementKind ? `集合(${d.elementKind})` : '集合';
    case 'text':
      return '文本';
    case 'ref':
      return d.entityKind ? `引用(${d.entityKind})` : '引用';
  }
}

function comparable(a: TypeName, b: TypeName): boolean {
  if (a === 'any' || b === 'any') return true;
  if (a === b) return true;
  const textish: TypeName[] = ['text', 'enum', 'ref'];
  return textish.includes(a) && textish.includes(b);
}

function assignable(from: TypeName, to: TypeName): boolean {
  if (from === 'any' || to === 'any') return true;
  if (from === to) return true;
  const textish: TypeName[] = ['text', 'enum', 'ref'];
  return textish.includes(from) && textish.includes(to);
}

function evalConst(e: LExpr): Value | undefined {
  switch (e.k) {
    case 'const':
      return e.v;
    case 'read':
      return undefined;
    case 'un': {
      const v = evalConst(e.e);
      if (e.op === '非') return typeof v === 'boolean' ? !v : undefined;
      if (typeof v !== 'number') return undefined;
      return e.op === '-' ? -v : v;
    }
    case 'bin': {
      const l = evalConst(e.l);
      const r = evalConst(e.r);
      if (l === undefined || r === undefined) return undefined;
      switch (e.op) {
        case '+':
          return typeof l === 'number' && typeof r === 'number' ? l + r : undefined;
        case '-':
          return typeof l === 'number' && typeof r === 'number' ? l - r : undefined;
        case '*':
          return typeof l === 'number' && typeof r === 'number' ? l * r : undefined;
        case '/':
          return typeof l === 'number' && typeof r === 'number' ? (r === 0 ? undefined : l / r) : undefined;
        case '%':
          return typeof l === 'number' && typeof r === 'number' ? (r === 0 ? undefined : l % r) : undefined;
        case '==':
          return JSON.stringify(l) === JSON.stringify(r);
        case '!=':
          return JSON.stringify(l) !== JSON.stringify(r);
        case '<':
          return typeof l === 'number' && typeof r === 'number' ? l < r : undefined;
        case '<=':
          return typeof l === 'number' && typeof r === 'number' ? l <= r : undefined;
        case '>':
          return typeof l === 'number' && typeof r === 'number' ? l > r : undefined;
        case '>=':
          return typeof l === 'number' && typeof r === 'number' ? l >= r : undefined;
        case '且':
          return typeof l === 'boolean' && typeof r === 'boolean' ? l && r : undefined;
        case '或':
          return typeof l === 'boolean' && typeof r === 'boolean' ? l || r : undefined;
        default:
          return undefined;
      }
    }
    case 'call': {
      const args = e.args.map(evalConst);
      if (args.some((a) => a === undefined)) return undefined;
      switch (e.fn) {
        case '数量':
          return Array.isArray(args[0]) ? args[0].length : undefined;
        case '包含':
          return Array.isArray(args[0]) ? args[0].includes(String(args[1])) : undefined;
        case '空':
          if (Array.isArray(args[0])) return args[0].length === 0;
          if (typeof args[0] === 'string') return args[0].length === 0;
          return undefined;
        case '最小':
          return typeof args[0] === 'number' && typeof args[1] === 'number' ? Math.min(args[0], args[1]) : undefined;
        case '最大':
          return typeof args[0] === 'number' && typeof args[1] === 'number' ? Math.max(args[0], args[1]) : undefined;
        case '绝对值':
          return typeof args[0] === 'number' ? Math.abs(args[0]) : undefined;
        case '存在':
          return args[0] !== null;
        default:
          return undefined;
      }
    }
  }
}

function exprReads(e: LExpr, ids: Set<string>): boolean {
  switch (e.k) {
    case 'read':
      return ids.has(e.id);
    case 'bin':
      return exprReads(e.l, ids) || exprReads(e.r, ids);
    case 'un':
      return exprReads(e.e, ids);
    case 'call':
      return e.args.some((a) => exprReads(a, ids));
    default:
      return false;
  }
}

function collectReads(e: LExpr, out: Set<string>): void {
  switch (e.k) {
    case 'read':
      out.add(e.id);
      break;
    case 'bin':
      collectReads(e.l, out);
      collectReads(e.r, out);
      break;
    case 'un':
      collectReads(e.e, out);
      break;
    case 'call':
      for (const a of e.args) collectReads(a, out);
      break;
    default:
      break;
  }
}

function validateCycle(edges: IRCoupling[]): string | undefined {
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  for (const [n, d] of outDeg) if (d > 1) return `「${n}」有多条出边`;
  for (const [n, d] of inDeg) if (d > 1) return `「${n}」有多条入边`;
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  if (nodes.length !== edges.length) return '节点数和边数对不上，说明它不是一条单环';
  const next = new Map(edges.map((e) => [e.from, e.to]));
  const start = nodes[0]!;
  let cur = start;
  const seen = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    if (seen.has(cur)) return `在「${cur}」处提前回到了已经走过的弦`;
    seen.add(cur);
    const nxt = next.get(cur);
    if (!nxt) return `「${cur}」没有出边`;
    cur = nxt;
  }
  if (cur !== start) return `走完一圈停在「${cur}」，没有回到起点「${start}」`;
  return undefined;
}

function formatValue(v: Value): string {
  if (Array.isArray(v)) return `{${v.join(', ')}}`;
  if (v === null) return '空';
  return String(v);
}

export function compile(source: SourceFile): CompileResult {
  return new Compiler(source).compile();
}

export function compileText(text: string, path = '<inline>.nro'): CompileResult {
  return compile(new SourceFile(path, text));
}

export type { Diagnostic };
