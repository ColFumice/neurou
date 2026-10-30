import { useEffect, useRef } from 'react';
import type { GlslArtifact } from './glslBackend.js';

/** v5.7/v5.27：全屏灰度片元；参数 uniform + uTime + 程序化纹理。 */
export function GlslCanvas({
  artifact,
  values,
  postLevel = 1,
  post,
}: {
  artifact: GlslArtifact;
  values: number[];
  postLevel?: number;
  post?: { vignette: number; grain: number; tint: number };
}): JSX.Element {
  const vignette = post?.vignette ?? 0.55;
  const grain = post?.grain ?? 0.035;
  const tint = post?.tint ?? 0;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false });
    if (!gl) return;

    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertex = compile(gl.VERTEX_SHADER, artifact.vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, artifact.fragmentSource);
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    if (texture) {
      const pixels = new Uint8Array(64 * 64);
      const scale = Math.max(1, Math.min(64, Math.round(artifact.textureScale)));
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          let value = 0;
          if (artifact.texturePattern === '条纹') {
            value = Math.floor((x * scale) / 64) % 2 === 0 ? 60 : 200;
          } else if (artifact.texturePattern === '渐变') {
            value = Math.round((x / 63) * 255);
          } else if (artifact.texturePattern === '噪点') {
            value = ((x * 73 + y * 151 + x * y * 17) >>> 0) % 256;
          } else {
            value = (Math.floor((x * scale) / 64) + Math.floor((y * scale) / 64)) % 2 === 0 ? 40 : 180;
          }
          pixels[y * 64 + x] = value;
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 64, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }

    const timeLocation = gl.getUniformLocation(program, artifact.timeUniform);
    const textureLocation = gl.getUniformLocation(program, artifact.textureUniform);
    const valueLocations = artifact.bindings.map((binding) => gl.getUniformLocation(program, binding.uniform));

    // v6.0：第二 pass——场景先渲染到 FBO，再做一个暗角/颗粒后处理。
    const postVertex = compile(
      gl.VERTEX_SHADER,
      `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`,
    );
    const postFragment = compile(
      gl.FRAGMENT_SHADER,
      `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform float uTime;
uniform float uPost;
uniform float uVignette;
uniform float uGrain;
uniform float uTint;
void main() {
  vec4 color = texture(uScene, vUv);
  vec2 d = vUv - 0.5;
  float vignette = 1.0 - dot(d, d) * uVignette * uPost;
  float grain = (fract(sin(dot(vUv * vec2(1024.0 + uTime, 768.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uGrain * uPost;
  vec3 tinted = mix(color.rgb, color.rgb * vec3(1.12, 0.96, 0.86), uTint);
  outColor = vec4(tinted * vignette + grain, color.a);
}`,
    );
    const postProgram = gl.createProgram();
    if (postVertex && postFragment && postProgram) {
      gl.attachShader(postProgram, postVertex);
      gl.attachShader(postProgram, postFragment);
      gl.linkProgram(postProgram);
    }
    const postSceneLocation = postProgram ? gl.getUniformLocation(postProgram, 'uScene') : null;
    const postTimeLocation = postProgram ? gl.getUniformLocation(postProgram, 'uTime') : null;
    const postLevelLocation = postProgram ? gl.getUniformLocation(postProgram, 'uPost') : null;
    const postVignetteLocation = postProgram ? gl.getUniformLocation(postProgram, 'uVignette') : null;
    const postGrainLocation = postProgram ? gl.getUniformLocation(postProgram, 'uGrain') : null;
    const postTintLocation = postProgram ? gl.getUniformLocation(postProgram, 'uTint') : null;
    const sceneTexture = gl.createTexture();
    const sceneFramebuffer = gl.createFramebuffer();
    let sceneWidth = 0;
    let sceneHeight = 0;
    const ensureSceneTarget = (width: number, height: number): void => {
      if (!sceneTexture || !sceneFramebuffer || (sceneWidth === width && sceneHeight === height)) return;
      sceneWidth = width;
      sceneHeight = height;
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTexture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    const start = performance.now();
    let raf = 0;
    let disposed = false;

    // v5.30：资产纹理异步加载；加载完成前保留程序化兜底纹理。
    if (texture && artifact.textureSrc) {
      const image = new Image();
      image.onload = (): void => {
        if (disposed || !texture) return;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      };
      image.src = /^data:/i.test(artifact.textureSrc) ? artifact.textureSrc : `/${artifact.textureSrc.replace(/^\/+/, '')}`;
    }

    const draw = (now: number): void => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      // pass 1：场景进 FBO
      ensureSceneTarget(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const scenePosition = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(scenePosition);
      gl.vertexAttribPointer(scenePosition, 2, gl.FLOAT, false, 0, 0);
      if (timeLocation) gl.uniform1f(timeLocation, (now - start) / 1000);
      if (textureLocation && texture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(textureLocation, 0);
      }
      for (let index = 0; index < valueLocations.length; index++) {
        const location = valueLocations[index];
        if (location) gl.uniform1f(location, valuesRef.current[index] ?? 0);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // pass 2：后处理到屏幕
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (postProgram && sceneTexture) {
        gl.useProgram(postProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const postPosition = gl.getAttribLocation(postProgram, 'aPosition');
        gl.enableVertexAttribArray(postPosition);
        gl.vertexAttribPointer(postPosition, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
        if (postSceneLocation) gl.uniform1i(postSceneLocation, 0);
        if (postTimeLocation) gl.uniform1f(postTimeLocation, (now - start) / 1000);
        if (postLevelLocation) gl.uniform1f(postLevelLocation, postLevel);
        if (postVignetteLocation) gl.uniform1f(postVignetteLocation, vignette);
        if (postGrainLocation) gl.uniform1f(postGrainLocation, grain);
        if (postTintLocation) gl.uniform1f(postTintLocation, tint);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
      if (texture) gl.deleteTexture(texture);
      if (sceneTexture) gl.deleteTexture(sceneTexture);
      if (sceneFramebuffer) gl.deleteFramebuffer(sceneFramebuffer);
      if (postProgram) gl.deleteProgram(postProgram);
      if (postVertex) gl.deleteShader(postVertex);
      if (postFragment) gl.deleteShader(postFragment);
    };
  }, [artifact, postLevel, vignette, grain, tint]);

  return (
    <canvas
      ref={canvasRef}
      className="preview-glsl"
      data-testid="preview-glsl"
      data-glsl-passes="2"
      data-post-level={postLevel}
      data-glsl-post={`${vignette},${grain},${tint}`}
      aria-hidden="true"
    />
  );
}
