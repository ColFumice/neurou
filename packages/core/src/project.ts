/**
 * v5.9：多文件模块编译。
 *
 * 语法上只有一条新声明：
 *   引入 "相对路径.nro"
 *
 * 模块文件里不能声明 `世界`；入口文件负责世界声明。当前实现是
 * “按依赖顺序合并声明后编译”，因此诊断行号指向合并后的文本，
 * 不是各模块原始行号——这是第一个版本明确的限制。
 */
import { SourceFile } from './source.js';
import { compile, type CompileResult } from './compiler.js';
import { parse } from './parser.js';
import { patchWorldText, type PatchResult } from './patch.js';
import { DiagnosticBag } from './diagnostics.js';
import type { Decl, EntityDecl, NamespaceDecl, StringDecl } from './ast.js';
import type { IRString, WorldIR } from './ir.js';

export interface ProjectSources {
  /** 路径 → 源码；路径使用 `/`，相对当前工作目录。 */
  [path: string]: string;
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

const IMPORT_RE = /^[ \t]*引入[ \t]+"([^"]+)"[ \t]*(?:#.*)?$/gm;
const WORLD_RE = /^[ \t]*世界[ \t]+/m;

export function normalizeProjectPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new ProjectError(`模块路径越界：${path}`);
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function resolveImport(from: string, spec: string): string {
  if (spec.startsWith('/')) return normalizeProjectPath(spec);
  return normalizeProjectPath(`${dirname(from)}/${spec}`);
}

function importsOf(source: string): string[] {
  return [...source.matchAll(IMPORT_RE)].map((match) => match[1] ?? '').filter(Boolean);
}

function withoutImports(source: string): string {
  return source.replace(IMPORT_RE, '');
}

export function compileProjectFromFiles(entryPath: string, files: ProjectSources): CompileResult {
  const entry = normalizeProjectPath(entryPath);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const chunks: string[] = [];

  const visit = (path: string): void => {
    if (visiting.has(path)) throw new ProjectError(`模块循环引入：${path}`);
    if (visited.has(path)) return;
    visiting.add(path);
    const source = files[path];
    if (source === undefined) throw new ProjectError(`找不到模块：${path}`);
    for (const spec of importsOf(source)) visit(resolveImport(path, spec));
    visiting.delete(path);
    visited.add(path);
    if (path !== entry && WORLD_RE.test(source)) {
      throw new ProjectError(`模块「${path}」不能声明世界；世界只能写在入口文件。`);
    }
    chunks.push(`# 模块 ${path}\n${withoutImports(source)}`);
  };

  visit(entry);
  const combined = chunks.join('\n');
  return compile(new SourceFile(entry, combined));
}

/** v5.9：带文件读取回调的版本，给 CLI 用；core 本身不做文件 I/O。 */
export function compileProject(
  entryPath: string,
  readFile: (path: string) => string,
): CompileResult {
  const entry = normalizeProjectPath(entryPath);
  const files: ProjectSources = {};
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (path: string): void => {
    if (visiting.has(path)) throw new ProjectError(`模块循环引入：${path}`);
    if (visited.has(path)) return;
    visiting.add(path);
    let source: string;
    try {
      source = readFile(path);
    } catch {
      throw new ProjectError(`读不到模块：${path}`);
    }
    files[path] = source;
    for (const spec of importsOf(source)) visit(resolveImport(path, spec));
    visiting.delete(path);
    visited.add(path);
  };

  visit(entry);
  return compileProjectFromFiles(entry, files);
}

export interface ProjectModule {
  path: string;
  imports: string[];
}

/** v5.15：模块依赖图；入口在前，按深度优先顺序。 */
export function projectGraph(
  entryPath: string,
  readFile: (path: string) => string,
): ProjectModule[] {
  const entry = normalizeProjectPath(entryPath);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const out: ProjectModule[] = [];

  const visit = (path: string): void => {
    if (visiting.has(path)) throw new ProjectError(`模块循环引入：${path}`);
    if (visited.has(path)) return;
    visiting.add(path);
    let source: string;
    try {
      source = readFile(path);
    } catch {
      throw new ProjectError(`读不到模块：${path}`);
    }
    const imports = importsOf(source).map((spec) => resolveImport(path, spec));
    for (const imported of imports) visit(imported);
    visiting.delete(path);
    visited.add(path);
    out.push({ path, imports });
  };

  visit(entry);
  return out;
}

/**
 * v5.47：入口文件里的弦声明（带入口文本 span）。
 * 只用于入口弦字段写回；模块弦不会进入结果。
 */
export function projectEntryStrings(entryPath: string, source: string, ir: WorldIR): IRString[] {
  let program;
  try {
    program = parse(new SourceFile(entryPath, source), new DiagnosticBag());
  } catch {
    return [];
  }
  const spans = new Map<string, StringDecl['span']>();
  const visit = (decls: Decl[], prefix = ''): void => {
    for (const decl of decls) {
      if (decl.k === 'string') {
        const id = prefix ? `${prefix}.${decl.name}` : decl.name;
        spans.set(id, decl.span);
      } else if (decl.k === 'entity') {
        const entity = decl as EntityDecl;
        const owner = prefix ? `${prefix}.${entity.name}` : entity.name;
        for (const string of entity.strings) spans.set(`${owner}.${string.name}`, string.span);
      } else if (decl.k === 'namespace') {
        const namespace = decl as NamespaceDecl;
        visit(namespace.decls, prefix ? `${prefix}.${namespace.name}` : namespace.name);
      }
    }
  };
  visit(program.decls);
  const out: IRString[] = [];
  for (const [id, span] of spans) {
    const string = ir.strings.find((candidate) => candidate.id === id);
    if (string) out.push({ ...string, span });
  }
  return out;
}

/** 仅对入口弦字段做行级 patch，用入口文本自己的 span。 */
export function patchProjectEntry(
  entryText: string,
  baseStrings: readonly IRString[],
  editedStrings: readonly IRString[],
): PatchResult {
  const mini = (strings: readonly IRString[]): WorldIR =>
    ({
      format: 'neurou/ir-0.1',
      name: 'entry',
      meta: {},
      entities: [],
      strings,
      spectra: [],
      matrices: [],
      couplings: [],
      rules: [],
      actions: [],
      forcings: [],
      endings: [],
      phases: [],
      axioms: [],
      loops: [],
    }) as unknown as WorldIR;
  return patchWorldText(entryText, mini(baseStrings), mini(editedStrings));
}
