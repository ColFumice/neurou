import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_SCRIPT_PATTERN,
  isAllowedExternalScript,
  validateExternalPlugin,
} from '../src/externalGame.js';

const valid = {
  id: 'reaction',
  moduleName: '反应',
  title: { zh: '反应', en: 'Reaction' },
  description: { zh: '敲击', en: 'Tap' },
  controls: { zh: 'Space', en: 'Space' },
  create: () => ({}),
  step: () => {},
  score: () => 0,
  lines: () => 0,
  level: () => 1,
  isOver: () => false,
  draw: () => {},
  commandFor: () => null,
};

describe('外部插件受限 API', () => {
  it('接受合法的受限插件', () => {
    expect(validateExternalPlugin(valid).ok).toBe(true);
  });

  it('拒绝缺失方法 / 错误 id', () => {
    expect(validateExternalPlugin(null).ok).toBe(false);
    expect(validateExternalPlugin({ ...valid, id: 'Bad Id' }).errors.some((e) => e.includes('kebab'))).toBe(true);
    const missing = { ...valid, draw: undefined };
    expect(validateExternalPlugin(missing).ok).toBe(false);
  });

  it('只允许 plugins/ 下一层 js', () => {
    expect(EXTERNAL_SCRIPT_PATTERN.test('plugins/reaction.js')).toBe(true);
    expect(EXTERNAL_SCRIPT_PATTERN.test('../plugins/reaction.js')).toBe(false);
    expect(EXTERNAL_SCRIPT_PATTERN.test('plugins/nested/reaction.js')).toBe(false);
    expect(EXTERNAL_SCRIPT_PATTERN.test('plugins/reaction.mjs')).toBe(false);
    expect(isAllowedExternalScript('plugins/reaction.js')).toBe(true);
    expect(isAllowedExternalScript('https://evil.example/plugins/reaction.js')).toBe(false);
  });
});
