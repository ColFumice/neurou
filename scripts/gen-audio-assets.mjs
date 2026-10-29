/**
 * 生成 v3.7 的最小音频资产（无外部依赖）：
 *   packages/gui/public/audio/clock.wav  —— 钟声
 *   packages/gui/public/audio/rain.wav   —— 雨声
 *
 * 运行：node scripts/gen-audio-assets.mjs
 * 生成后可直接被 `音频资产 名字 "audio/clock.wav"` 引用。
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 22050;

function wav(samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(1, 22); // mono
  data.writeUInt32LE(RATE, 24);
  data.writeUInt32LE(RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => {
    const clamped = Math.max(-1, Math.min(1, value));
    data.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  });
  return data;
}

function normalize(samples) {
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  return samples.map((value) => (value / peak) * 0.82);
}

// 钟声：三个泛音 + 指数衰减 + 极轻的起音噪声。
const clock = [];
for (let i = 0; i < Math.floor(RATE * 1.15); i++) {
  const t = i / RATE;
  const env = Math.exp(-t * 3.2) * (1 - Math.exp(-t * 180));
  const tone =
    Math.sin(2 * Math.PI * 523.25 * t) * 0.55 +
    Math.sin(2 * Math.PI * 1046.5 * t + 0.3) * 0.28 +
    Math.sin(2 * Math.PI * 1567.98 * t + 0.8) * 0.12 +
    Math.sin(2 * Math.PI * 2093 * t) * 0.05;
  clock.push(tone * env);
}

// 雨声：粉噪近似 + 缓慢起伏，低通。
const rain = [];
let state = 0;
let seed = 0x9e3779b9;
for (let i = 0; i < Math.floor(RATE * 1.6); i++) {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  const white = seed / 0xffffffff * 2 - 1;
  state = state * 0.94 + white * 0.06;
  const t = i / RATE;
  const env = Math.min(1, t / 0.08) * Math.min(1, (1.6 - t) / 0.3);
  rain.push(state * env * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.7 * t)));
}

mkdirSync('packages/gui/public/audio', { recursive: true });
writeFileSync('packages/gui/public/audio/clock.wav', wav(normalize(clock)));
writeFileSync('packages/gui/public/audio/rain.wav', wav(normalize(rain)));
console.log('wrote packages/gui/public/audio/clock.wav');
console.log('wrote packages/gui/public/audio/rain.wav');
