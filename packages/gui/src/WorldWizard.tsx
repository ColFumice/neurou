import { useState } from 'react';

export type WorldTemplate = 'blank' | 'testbed' | 'game';

interface WorldWizardProps {
  onCreate: (name: string, template: WorldTemplate) => void;
  onClose: () => void;
}

const TEMPLATES: Array<{ id: WorldTemplate; label: string; note: string }> = [
  { id: 'blank', label: '空白世界', note: '最小可运行世界' },
  { id: 'testbed', label: '测试世界', note: '全部引擎能力' },
  { id: 'game', label: '十分钟小游戏', note: '可通关示例' },
];

/** 真·工程模板向导：命名 → 模板 → 确认。 */
export function WorldWizard({ onCreate, onClose }: WorldWizardProps): JSX.Element {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('新世界');
  const [template, setTemplate] = useState<WorldTemplate>('testbed');

  return (
    <div className="world-wizard" data-testid="world-wizard" data-step={step}>
      <div className="world-wizard__panel">
        <div className="world-wizard__head">
          <div>
            <div className="world-wizard__kicker">新建世界</div>
            <div className="world-wizard__title">{['命名', '选择模板', '确认'][step]}</div>
          </div>
          <span className="world-wizard__close" role="button" tabIndex={0} onClick={onClose}>
            关闭
          </span>
        </div>
        {step === 0 ? (
          <label className="world-wizard__field">
            <span>世界名称</span>
            <input
              autoFocus
              data-testid="world-wizard-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.code === 'Enter' && name.trim()) setStep(1);
              }}
            />
          </label>
        ) : null}
        {step === 1 ? (
          <div className="world-wizard__templates">
            {TEMPLATES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`world-wizard__template${template === item.id ? ' world-wizard__template--selected' : ''}`}
                data-template={item.id}
                onClick={() => setTemplate(item.id)}
              >
                <strong>{item.label}</strong>
                <span>{item.note}</span>
              </button>
            ))}
          </div>
        ) : null}
        {step === 2 ? (
          <div className="world-wizard__summary">
            <div>
              <span>名称</span>
              <strong>{name.trim()}</strong>
            </div>
            <div>
              <span>模板</span>
              <strong>{TEMPLATES.find((item) => item.id === template)?.label}</strong>
            </div>
            <div className="world-wizard__hint">创建后保存为本机世界，可立即进入并 F7 编辑 DSL。</div>
          </div>
        ) : null}
        <div className="world-wizard__foot">
          <button type="button" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
            {step === 0 ? '取消' : '上一步'}
          </button>
          {step < 2 ? (
            <button
              type="button"
              className="world-wizard__next"
              data-testid="world-wizard-next"
              disabled={step === 0 && !name.trim()}
              onClick={() => setStep(step + 1)}
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              className="world-wizard__next"
              data-testid="world-wizard-create"
              onClick={() => onCreate(name.trim(), template)}
            >
              创建并进入
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
