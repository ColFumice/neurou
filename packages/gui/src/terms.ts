/**
 * L1 术语：只暴露五个词。
 *
 * 规则：
 *   · 术语不教，术语出现——在用户做那件事的时候轻轻浮出；
 *   · 每个词最多自动浮现三次；
 *   · 卡片只在悬停/长按时出现，不自动弹；
 *   · 锚点是一句人话，不用术语解释术语。
 */

export type TermId = '弦' | '回路' | '调性' | '力迫' | '和弦';

export interface TermDef {
  id: TermId;
  /** 一句人话锚：不出现任何 neurou 术语 */
  anchor: string;
  example: string;
  detail: string;
}

export const TERMS: Record<TermId, TermDef> = {
  弦: {
    id: '弦',
    anchor: '世界的一根神经。',
    example: '「体力」就是一根：它一直在动；快到底时，世界会变。',
    detail:
      '你能看见的每一样会变的东西，背后都有一根这样的线。它们不只会涨会跌，还会互相牵动——你动一根，别处会跟着响。',
  },
  回路: {
    id: '回路',
    anchor: '几件事互相牵着，一件变了，别的也跟着变。',
    example: '你越虚弱，就越想躲；躲久了，体力又回来。',
    detail: '牵成一个圈，就会自己转起来：有的越转越紧，有的转回原处。故事常常就发生在它转得最紧的那一刻。',
  },
  调性: {
    id: '调性',
    anchor: '这个世界现在是冷还是暖。',
    example: '同一句台词，放进更冷的世界里，听起来就像威胁。',
    detail: '它不改变发生了什么，改变的是所有事听起来的样子。',
  },
  力迫: {
    id: '力迫',
    anchor: '你推了世界一下，它再也回不到刚才。',
    example: '信任跌破底线的那一下——之后做什么，关系都不一样了。',
    detail: '有些变化可以反悔，有些不能。不能反悔的那些，就是故事的转折点。',
  },
  和弦: {
    id: '和弦',
    anchor: '几件事同时发生，像一只手按下好几个琴键。',
    example: '「摊牌」一按下去，信任、筹码、局势一起变。',
    detail: '它们总是同进同退，所以可以被命名、被记住，也可以被再次使用。',
  },
};

const STORAGE_KEY = 'neurou.terms.v1';

function readCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCounts(counts: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // 隐私模式 / 存储被禁用时，术语浮现会退化为「本页最多三次」，不影响功能。
  }
}

export function exposedCount(id: TermId): number {
  return readCounts()[id] ?? 0;
}

/** 记录一次自动浮现；返回是否应该真的显示。 */
export function registerExposure(id: TermId, limit = 3): boolean {
  const counts = readCounts();
  const count = counts[id] ?? 0;
  if (count >= limit) return false;
  counts[id] = count + 1;
  writeCounts(counts);
  return true;
}

export function resetTerms(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
