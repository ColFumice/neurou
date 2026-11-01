/**
 * v1.53：外部游戏插件加载器（受限 API）。
 *
 * 约束：
 *   - 只允许同源 /plugins/ 下一层 .js；
 *   - 只暴露 GameModule + draw + commandFor 这一层接口；
 *   - 插件不得访问世界/引擎内部对象。
 */
import type { GameModule, GameParams } from './gameSdk.js';
import type { GameTheme } from './gameTheme.js';

export const EXTERNAL_MODULE_NAME = '外部';
export const EXTERNAL_SCRIPT_PATTERN = /^plugins\/[A-Za-z0-9._-]+\.js$/;

export interface ExternalViewport {
  width: number;
  height: number;
  dpr: number;
}

export interface ExternalGamePlugin extends GameModule<unknown, string> {
  moduleName: string;
  description: { zh: string; en: string };
  controls: { zh: string; en: string };
  script: string;
  draw(
    ctx: CanvasRenderingContext2D,
    state: unknown,
    viewport: ExternalViewport,
    phase: string,
    best: number,
    theme: GameTheme,
  ): void;
  commandFor(code: string, repeat: boolean): string | 'pause' | 'restart' | 'exit' | 'confirm' | null;
}

export interface ExternalValidation {
  ok: boolean;
  errors: string[];
}

export function isAllowedExternalScript(script: string): boolean {
  if (!EXTERNAL_SCRIPT_PATTERN.test(script)) return false;
  try {
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const url = new URL(script.startsWith('/') ? script : `/${script}`, origin);
    return url.origin === origin && url.pathname === `/${script}`;
  } catch {
    return false;
  }
}

function isPair(value: unknown): value is { zh: string; en: string } {
  if (!value || typeof value !== 'object') return false;
  const pair = value as { zh?: unknown; en?: unknown };
  return typeof pair.zh === 'string' && pair.zh.length > 0 && typeof pair.en === 'string' && pair.en.length > 0;
}

/** 校验插件导出的受限 API，不执行插件逻辑。 */
export function validateExternalPlugin(value: unknown): ExternalValidation {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { ok: false, errors: ['插件必须导出对象'] };
  const plugin = value as Partial<ExternalGamePlugin>;
  if (typeof plugin.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(plugin.id)) errors.push('id 必须是 kebab-case');
  if (typeof plugin.moduleName !== 'string' || !plugin.moduleName) errors.push('moduleName 必须是非空字符串');
  if (!isPair(plugin.title)) errors.push('title 需要 zh/en');
  if (!isPair(plugin.description)) errors.push('description 需要 zh/en');
  if (!isPair(plugin.controls)) errors.push('controls 需要 zh/en');
  for (const method of ['create', 'step', 'score', 'lines', 'level', 'isOver', 'draw', 'commandFor'] as const) {
    if (typeof plugin[method] !== 'function') errors.push(`${method} 必须是函数`);
  }
  return { ok: errors.length === 0, errors };
}

const cache = new Map<string, Promise<ExternalGamePlugin>>();

export async function loadExternalPlugin(script: string): Promise<ExternalGamePlugin> {
  if (!isAllowedExternalScript(script)) {
    throw new Error(`不允许的插件路径：${script}`);
  }
  const cached = cache.get(script);
  if (cached) return cached;
  const promise = (async (): Promise<ExternalGamePlugin> => {
    const href = new URL(script.startsWith('/') ? script : `/${script}`, window.location.origin).href;
    const module = (await import(/* @vite-ignore */ href)) as { default?: unknown };
    const validation = validateExternalPlugin(module.default);
    if (!validation.ok) throw new Error(`插件校验失败：${validation.errors.join('；')}`);
    return { ...(module.default as ExternalGamePlugin), script };
  })();
  cache.set(script, promise);
  try {
    return await promise;
  } catch (error) {
    cache.delete(script);
    throw error;
  }
}

export function clearExternalPluginCache(): void {
  cache.clear();
}

/** 把外部插件的命令返回值转换成 GameHost 的 HostInput 语义。 */
export function externalCommandSemantics(command: string): 'input' | 'pause' | 'restart' | 'exit' | 'confirm' {
  if (command === 'pause' || command === 'restart' || command === 'exit' || command === 'confirm') return command;
  return 'input';
}

export type ExternalParams = GameParams;
