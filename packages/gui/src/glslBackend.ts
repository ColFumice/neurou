/**
 * v5.7：最小 GLSL 后端。
 *
 * 只做「端口 → WebGL2 片元着色器」闭环：
 *   参数 → uniform → 纯灰度片元 → Host 预览 canvas。
 * GLSL 编译器属于 Host；runtime 仍只提供端口帧。
 */
import type { BackendAdapter, BackendCompileResult, BackendPortFrame } from '@neurou/engine';

export interface GlslBinding {
  uniform: string;
  param: string;
  string: string;
}

export interface GlslArtifact {
  vertexSource: string;
  fragmentSource: string;
  bindings: GlslBinding[];
}

const VERTEX_SOURCE = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/** 纯函数：端口参数 → GLSL ES 3.0 片元源码；参数名转成 u0/u1，避免标识符问题。 */
export function buildGlslArtifact(port: BackendPortFrame): GlslArtifact {
  const params = Object.entries(port.params);
  const uniforms = params.map((_, index) => `u${index}`);
  const lines = [
    '#version 300 es',
    'precision highp float;',
    ...uniforms.map((uniform) => `uniform float ${uniform};`),
    'out vec4 outColor;',
    'void main() {',
    '  float v = 0.0;',
    ...uniforms.map((uniform, index) => (index === 0 ? `  v += ${uniform};` : `  v += ${uniform} * 0.35;`)),
    '  v = clamp(v, 0.0, 1.0);',
    '  outColor = vec4(vec3(0.09 + v * 0.26), 0.55);',
    '}',
    '',
  ];
  return {
    vertexSource: VERTEX_SOURCE,
    fragmentSource: lines.join('\n'),
    bindings: params.map(([param, value], index) => ({
      uniform: uniforms[index]!,
      param,
      string: typeof value === 'string' ? value : '',
    })),
  };
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): string | null {
  const shader = gl.createShader(type);
  if (!shader) return '无法创建着色器';
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '着色器编译失败';
    gl.deleteShader(shader);
    return log;
  }
  gl.deleteShader(shader);
  return null;
}

/** 浏览器内编译；没有 WebGL2 时返回明确原因，不使 Engine 崩溃。 */
export function compileGlsl(port: BackendPortFrame): { result: BackendCompileResult; artifact?: GlslArtifact } {
  const artifact = buildGlslArtifact(port);
  if (typeof document === 'undefined') {
    return { result: { ok: false, error: '当前 Host 没有 DOM / WebGL2' }, artifact };
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    return { result: { ok: false, error: '当前浏览器没有 WebGL2' }, artifact };
  }
  const vertexError = compileShader(gl, gl.VERTEX_SHADER, artifact.vertexSource);
  if (vertexError) return { result: { ok: false, error: vertexError }, artifact };
  const fragmentError = compileShader(gl, gl.FRAGMENT_SHADER, artifact.fragmentSource);
  if (fragmentError) return { result: { ok: false, error: fragmentError }, artifact };
  return { result: { ok: true, artifact }, artifact };
}

export function createGlslBackend(): BackendAdapter {
  return {
    id: 'glsl-webgl2',
    kind: '视觉',
    compile(port) {
      return compileGlsl(port).result;
    },
  };
}
