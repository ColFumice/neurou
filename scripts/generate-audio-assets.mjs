/**
 * 生成示例世界引用的确定性音频资产；不依赖外部下载。
 * 运行：node scripts/generate-audio-assets.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'audio');
mkdirSync(outDir, { recursive: true });

function wavHeader(sampleRate, samples) {
  const bytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(bytes, 40);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

function rainSamples(sampleRate, seconds) {
  const length = Math.floor(sampleRate * seconds);
  const samples = new Float32Array(length);
  let seed = 0x9e3779b9;
  let low = 0;
  for (let index = 0; index < length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    low += (noise - low) * 0.08;
    const edge = Math.min(1, index / 800, (length - index) / 800);
    samples[index] = low * 0.32 * edge;
  }
  return samples;
}

function clockSamples(sampleRate, seconds) {
  const length = Math.floor(sampleRate * seconds);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    const envelope = Math.exp(-t * 7);
    samples[index] = (Math.sin(2 * Math.PI * 880 * t) * 0.7 + Math.sin(2 * Math.PI * 1760 * t) * 0.2) * envelope * 0.45;
  }
  return samples;
}

const sampleRate = 22050;
writeFileSync(join(outDir, 'rain.wav'), wavHeader(sampleRate, rainSamples(sampleRate, 2)));
writeFileSync(join(outDir, 'clock.wav'), wavHeader(sampleRate, clockSamples(sampleRate, 0.6)));
console.log(`audio: ${outDir}`);
