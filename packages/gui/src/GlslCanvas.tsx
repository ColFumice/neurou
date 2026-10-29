import { useEffect, useRef } from 'react';
import type { GlslArtifact } from './glslBackend.js';

/** v5.7/v5.27：全屏灰度片元；参数 uniform + uTime + 程序化纹理。 */
export function GlslCanvas({
  artifact,
  values,
}: {
  artifact: GlslArtifact;
  values: number[];
}): JSX.Element {
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
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          pixels[y * 64 + x] = ((x >> 3) + (y >> 3)) % 2 === 0 ? 40 : 180;
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
    const start = performance.now();
    let raf = 0;

    const draw = (now: number): void => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
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
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
      if (texture) gl.deleteTexture(texture);
    };
  }, [artifact]);

  return <canvas ref={canvasRef} className="preview-glsl" data-testid="preview-glsl" aria-hidden="true" />;
}
