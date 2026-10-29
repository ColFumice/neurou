/**
 * v5.6：后端 DSL 适配契约。
 *
 * GLSL / Faust 编译器属于 Host 注入的服务；runtime 只提供类型化端口。
 * 这样后端不会把着色器图/音频图写回弦网络本体。
 */
import type { IRPort } from '@neurou/core';
import type { RuntimeValue } from '@neurou/runtime';

export interface BackendPortFrame {
  id: string;
  name: string;
  kind: IRPort['kind'];
  /** 参数名 → 当拍弦值；由 Engine.observe() 投影。 */
  params: Record<string, RuntimeValue>;
  /** v5.29：视觉端口的程序化纹理规格。 */
  texture?: IRPort['texture'];
  /** v5.30：视觉端口绑定的纹理资产。 */
  textureAsset?: IRPort['textureAsset'];
}

export type BackendCompileResult =
  | { ok: true; artifact?: unknown }
  | { ok: false; error: string; line?: number; column?: number };

export interface BackendAdapter {
  readonly id: string;
  readonly kind: IRPort['kind'];
  /** 接收端口帧，返回编译产物或诊断；禁止写回 WorldState。 */
  compile(port: BackendPortFrame): BackendCompileResult;
}
