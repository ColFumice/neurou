/**
 * 单弦调律台的独立验证页：http://127.0.0.1:5188/string-demo.html
 *
 * 只有一张白纸 + StringField，不设任何演示工具栏（用户明确不要多余界面）。
 * 调试只用 URL query 或控制台里的 window.__neurouString。
 * 与主应用一样用 StrictMode，验证双挂载下音频单例与 effect 清理是幂等的。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StringField } from './StringField.js';
import './core.css';

function StringDemo() {
  return (
    <div className="ink-app" data-testid="ink-app">
      <StringField />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');
createRoot(root).render(
  <StrictMode>
    <StringDemo />
  </StrictMode>,
);
