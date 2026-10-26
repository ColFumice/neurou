import { StringField } from './StringField.js';

/**
 * 调律台首屏：一张白纸 + 正中一根黑弦。
 * 视图之外的逻辑（世界、IR、运行时）不在这层；这里是乐器，不是仪表盘。
 */
export function App() {
  return (
    <div className="ink-app" data-testid="ink-app">
      <StringField />
    </div>
  );
}
