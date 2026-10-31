export type Language = 'zh' | 'en';

const LANGUAGE_KEY = 'neurou.language';

export function loadLanguage(): Language {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

export function saveLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    /* 隐私模式 */
  }
  document.documentElement.dataset.lang = language;
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
}

export const START_TEXT = {
  zh: {
    tuner: '进入调律台',
    tunerNote: '八弦 · 默认',
    worlds: '世界',
    worldsNote: '世界库',
    graph: '章节路线',
    graphNote: 'Shift+F9',
    help: '操作说明',
    helpNote: '完整流程',
    settings: '设置',
    settingsNote: '语言 / 字体',
    testbed: '测试世界',
    testbedNote: '全能力试验场',
    game: '十分钟灯塔',
    gameNote: '可通关示例',
    local: '本机',
    footerFolder: '↑/↓ 选择 · ← 返回 · Enter 进入',
    footerTop: '↑/↓ 选择 · → 展开世界 · Esc 进入默认世界',
    rightHint: '弦 / 音乐',
  },
  en: {
    tuner: 'Enter Tuner',
    tunerNote: 'Eight strings · default',
    worlds: 'Worlds',
    worldsNote: 'World library',
    graph: 'Chapter Map',
    graphNote: 'Shift+F9',
    help: 'Guide',
    helpNote: 'Full workflow',
    settings: 'Settings',
    settingsNote: 'Language / Type',
    testbed: 'Test World',
    testbedNote: 'All engine features',
    game: 'Ten-Minute Lighthouse',
    gameNote: 'Playable example',
    local: 'Local',
    footerFolder: '↑/↓ choose · ← back · Enter open',
    footerTop: '↑/↓ choose · → worlds · Esc default world',
    rightHint: 'strings / music',
  },
} as const;

export const SETTINGS_TEXT = {
  zh: {
    title: '设置',
    language: '语言 / Language',
    zh: '中文',
    en: 'English',
    note: '选择后立即生效，并保存到本机。',
    back: '← 返回',
  },
  en: {
    title: 'Settings',
    language: 'Language / 语言',
    zh: '中文',
    en: 'English',
    note: 'Applies immediately and is remembered on this device.',
    back: '← Back',
  },
} as const;

/**
 * v1.24：全局 DOM 文案翻译。只覆盖 UI 文案，不碰世界数据/DSL 内容。
 * 英文模式下持续观察 DOM，动态面板（F10/F9/F7）也能立即翻译。
 */
const EN: Record<string, string> = {
  设置: 'Settings',
  操作说明: 'Guide',
  章节路线: 'Chapter Map',
  世界: 'Worlds',
  进入调律台: 'Enter Tuner',
  '声场半径': 'Space radius',
  '声场深度': 'Depth',
  '混响扩散': 'Diffusion',
  '滤波截止': 'Cutoff',
  '滤波共振': 'Resonance',
  '包络攻击': 'Attack',
  '包络衰减': 'Decay',
  '包络延持': 'Sustain',
  '包络释放': 'Release',
  'LFO 速率': 'LFO rate',
  'LFO 深度': 'LFO depth',
  'LoFi 位深': 'LoFi bits',
  'LoFi 采样率': 'LoFi sample rate',
  层级: 'Layer',
  '导出 .nrm': 'Export .nrm',
  '导入 .nrm': 'Import .nrm',
  '流场统一节点 · 声场 / 滤波 / ADSR / LFO / LoFi': 'Unified nodes · sound field / filter / ADSR / LFO / LoFi',
  混响: 'Reverb',
  低通: 'Low-pass',
  共振: 'Resonance',
  驱动: 'Drive',
  关闭: 'Close',
  应用声明: 'Apply declaration',
  '声场效果器': 'Sound-field effects',
  '↑/↓ 选参数 · ←/→ 调整 · F9/Esc 关闭': '↑/↓ field · ←/→ adjust · F9/Esc close',
  'F6 波形/资源 · F7 规则/动作 · Shift+F9 章节路线 · 弹窗内方向键直接选择。': 'F7 element DSL · Shift+F7 rules · Shift+F9 chapter map.',
};

const originalText = new WeakMap<Text, string>();
let observer: MutationObserver | null = null;

function translateTextNode(node: Text): void {
  const original = originalText.get(node) ?? node.nodeValue ?? '';
  if (!originalText.has(node)) originalText.set(node, original);
  const trimmed = original.trim();
  const translated = EN[trimmed];
  if (!translated) {
    if (node.nodeValue !== original) node.nodeValue = original;
    return;
  }
  const leading = original.match(/^\s*/)?.[0] ?? '';
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  node.nodeValue = `${leading}${translated}${trailing}`;
}

function translateRoot(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) translateTextNode(node as Text);
  if (root instanceof Element) {
    for (const el of [root, ...root.querySelectorAll('[title],[placeholder]')]) {
      for (const attr of ['title', 'placeholder']) {
        const value = el.getAttribute(attr);
        const translated = value ? EN[value.trim()] : undefined;
        if (translated) el.setAttribute(attr, translated);
      }
    }
  }
}

export function applyLanguageDom(language: Language): void {
  if (document.documentElement.dataset.lang !== language) {
    document.documentElement.dataset.lang = language;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (language === 'zh') {
    for (const node of Array.from(document.querySelectorAll('body *'))) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let text: Node | null;
      while ((text = walker.nextNode())) {
        const original = originalText.get(text as Text);
        if (original !== undefined) (text as Text).nodeValue = original;
      }
    }
    return;
  }
  translateRoot(document.body);
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) translateRoot(node);
      if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
        translateTextNode(mutation.target as Text);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
