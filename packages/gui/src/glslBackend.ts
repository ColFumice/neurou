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
  timeUniform: string;
  textureUniform: string;
  texturePattern: string;
  textureScale: number;
  textureSrc?: string;
}

const VERTEX_SOURCE = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/** 纯函数：端口参数 → GLSL ES 3.0 片元源码；参数名转成 u0/u1，避免标识符问题。 */
export function buildGlslArtifact(port: BackendPortFrame): GlslArtifact {
  const params = Object.entries(port.params);
  const uniforms = params.map((_, index) => `u${index}`);
  const flow = port.texture?.pattern === '流场';
  const speed = uniforms[0] ?? '0.5';
  const hue = uniforms[1] ?? '0.5';
  const detail = uniforms[2] ?? '0.5';
  const common = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform float uTime;',
    ...uniforms.map((uniform) => `uniform float ${uniform};`),
    'out vec4 outColor;',
  ];
  const flowLines = [
    ...common,
    'float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise21(vec2 p) {',
    '  vec2 i = floor(p); vec2 f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash21(i);',
    '  float b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0));',
    '  float d = hash21(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'float fbm(vec2 p) {',
    '  float v = 0.0; float a = 0.5;',
    '  for (int i = 0; i < 4; i++) { v += a * noise21(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }',
    '  return v;',
    '}',
    'void main() {',
    '  vec2 uv = vUv; uv.x *= 1.55;',
    `  float speed = 0.45 + (${speed}) * 0.012;`,
    `  float hue = clamp((${hue}) * 0.01, 0.0, 1.0);`,
    `  float detail = 0.7 + (${detail}) * 0.006;`,
    '  float t = uTime * 0.04 * speed;',
    '  vec2 p = uv * 3.0 * detail + vec2(t * 0.24, -t * 0.17);',
    '  float warp = fbm(p * 0.8 + vec2(t * 0.16, sin(t * 0.21) * 0.45));',
    '  float field = fbm(p + vec2(warp * 1.15, -warp * 0.85) + vec2(0.0, t * 0.12));',
    '  float contour = abs(fract(field * 7.0 + t * 0.18) - 0.5);',
    '  float line = smoothstep(0.115, 0.0, contour);',
    '  float second = fbm(p * 1.35 + vec2(1.7, 4.2) - t * 0.09);',
    '  float contour2 = abs(fract(second * 9.0 - t * 0.12) - 0.5);',
    '  float line2 = smoothstep(0.075, 0.0, contour2) * 0.55;',
    '  vec3 bg = vec3(0.008, 0.011, 0.022);',
    '  vec3 c1 = mix(vec3(0.25, 0.85, 0.95), vec3(0.88, 0.45, 0.95), hue);',
    '  vec3 c2 = mix(vec3(0.45, 0.55, 1.0), vec3(0.95, 0.72, 0.45), hue);',
    '  vec3 col = bg + line * c1 * (0.6 + 0.7 * warp) + line2 * c2;',
    '  col += 0.06 * vec3(0.18, 0.28, 0.38) * warp;',
    '  outColor = vec4(col, 0.94);',
    '}',
    '',
  ];
  const lines = flow
    ? flowLines
    : [
        ...common,
        'uniform sampler2D uTexture;',
        'void main() {',
        '  float v = 0.0;',
        ...uniforms.map((uniform, index) => (index === 0 ? `  v += ${uniform};` : `  v += ${uniform} * 0.35;`)),
        '  float tex = texture(uTexture, vec2(vUv.x + uTime * 0.02, vUv.y)).r;',
        '  v = clamp(v * 0.75 + tex * 0.25, 0.0, 1.0);',
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
    timeUniform: 'uTime',
    textureUniform: 'uTexture',
    texturePattern: port.texture?.pattern ?? '棋盘',
    textureScale: port.texture?.scale ?? 8,
    ...(port.textureAsset ? { textureSrc: port.textureAsset.src } : {}),
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
