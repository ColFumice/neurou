import type { TetrisAction } from './tetrisEngine.js';

/** 游戏层按键语义。 */
export type TetrisKeyCommand = TetrisAction | 'pause' | 'restart' | 'exit' | 'confirm';

/**
 * 键位映射。
 * 方向键 / WASD 双套；软降允许 repeat，其余方向/旋转忽略 repeat。
 */
export function commandForKey(code: string, repeat: boolean): TetrisKeyCommand | null {
  switch (code) {
    case 'ArrowLeft':
    case 'KeyA':
      return repeat ? null : 'left';
    case 'ArrowRight':
    case 'KeyD':
      return repeat ? null : 'right';
    case 'ArrowUp':
    case 'KeyW':
    case 'KeyX':
      return repeat ? null : 'rotateCW';
    case 'KeyZ':
    case 'ControlLeft':
      return repeat ? null : 'rotateCCW';
    case 'ArrowDown':
    case 'KeyS':
      return 'softDrop';
    case 'Space':
      return repeat ? null : 'hardDrop';
    case 'KeyP':
      return repeat ? null : 'pause';
    case 'KeyR':
      return repeat ? null : 'restart';
    case 'Escape':
      return repeat ? null : 'exit';
    case 'Enter':
    case 'NumpadEnter':
      return repeat ? null : 'confirm';
    default:
      return null;
  }
}

/** 游戏按键是否应阻止浏览器默认行为。 */
export function shouldPreventGameKey(code: string): boolean {
  return (
    code.startsWith('Arrow') ||
    code === 'Space' ||
    code === 'Enter' ||
    code === 'NumpadEnter' ||
    code === 'KeyP' ||
    code === 'KeyR' ||
    code === 'KeyZ' ||
    code === 'KeyX' ||
    code === 'KeyA' ||
    code === 'KeyS' ||
    code === 'KeyD' ||
    code === 'KeyW'
  );
}
