/**
 * 示例外部插件：反应。
 *
 * 受限 API 示例：
 *   - 只实现 GameModule + draw + commandFor；
 *   - 不访问世界/引擎；
 *   - 脚本位于 public/plugins/，只能通过 /plugins/reaction.js 加载。
 */
export default {
  id: 'reaction',
  moduleName: '反应',
  title: { zh: '反应', en: 'Reaction' },
  description: { zh: '在 5 次敲击内尽快得分。', en: 'Tap five times to finish.' },
  controls: { zh: 'Space 敲击 · P 暂停 · R 重开 · Esc 返回', en: 'Space tap · P pause · R restart · Esc back' },

  create() {
    return { score: 0, taps: 0, over: false };
  },

  step(state, command) {
    if (state.over) return;
    if (command === 'tap') {
      state.taps += 1;
      state.score = state.taps * 10;
      if (state.taps >= 5) state.over = true;
    }
  },

  score(state) {
    return state.score;
  },
  lines(state) {
    return state.taps;
  },
  level() {
    return 1;
  },
  isOver(state) {
    return state.over;
  },

  serialize(state) {
    return { ...state };
  },
  deserialize(data) {
    if (!data || typeof data !== 'object') return null;
    const value = data;
    return {
      score: Number(value.score) || 0,
      taps: Number(value.taps) || 0,
      over: Boolean(value.over),
    };
  },

  commandFor(code) {
    switch (code) {
      case 'Space':
        return 'tap';
      case 'KeyP':
        return 'pause';
      case 'KeyR':
        return 'restart';
      case 'Escape':
        return 'exit';
      case 'Enter':
      case 'NumpadEnter':
        return 'confirm';
      default:
        return null;
    }
  },

  draw(ctx, state, viewport, phase, best, theme) {
    const { width, height } = viewport;
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    const size = Math.min(width * 0.46, height * 0.46);
    const left = (width - size) / 2;
    const top = (height - size) / 2;
    ctx.fillStyle = theme.boardFill;
    ctx.strokeStyle = theme.line;
    ctx.fillRect(left, top, size, size);
    ctx.strokeRect(left + 0.5, top + 0.5, size - 1, size - 1);
    ctx.fillStyle = theme.ink;
    ctx.font = `300 ${Math.round(size * 0.18)}px ${theme.titleFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(state.score), width / 2, height / 2);
    ctx.font = `300 12px ${theme.monoFont}`;
    ctx.fillStyle = theme.dim;
    ctx.fillText(`${state.over ? '完成' : 'Space 敲击'} · ${state.taps}/5`, width / 2, height / 2 + size * 0.18);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (best > 0) {
      ctx.fillStyle = theme.dim;
      ctx.fillText(`BEST ${best}`, 44, height - 52);
    }
    if (phase === 'ready') {
      ctx.fillStyle = theme.dim;
      ctx.fillText('Enter 开始', 44, height - 74);
    }
  },
};
