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
