import { useEffect, useRef } from 'react';
import type { IRRule } from '@neurou/core';

export interface RuleEditorRule {
  id: string;
  name: string;
  kind: IRRule['kind'];
  cost: number;
  priority: number;
  cooldown: number;
}

export interface RuleEditorProps {
  rules: RuleEditorRule[];
  onAdjust: (id: string, field: 'cost' | 'priority' | 'cooldown', delta: number) => void;
  onClose: () => void;
}

export function RuleEditor({ rules, onAdjust, onClose }: RuleEditorProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  return (
    <div
      className="waveform-editor rule-editor"
      data-testid="rule-editor"
      data-rule-count={rules.length}
      tabIndex={-1}
      ref={rootRef}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.code === 'Escape' || event.code === 'F7') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="waveform-editor__title">规则 / 动作</div>
      <div className="rule-editor__list">
        {rules.length === 0 ? <span className="waveform-editor__empty">无可编辑规则</span> : null}
        {rules.map((rule) => (
          <div className="rule-editor__row" key={rule.id} data-rule-id={rule.id}>
            <span className="rule-editor__name">{rule.name}</span>
            <em>{rule.kind === 'action' ? '动作' : rule.kind === 'forcing' ? '力迫' : '和弦'}</em>
            {rule.kind === 'action' ? (
              <span className="rule-editor__field" data-rule-field="cost">
                <span>耗时</span>
                <button type="button" data-rule-step="-1" onClick={() => onAdjust(rule.id, 'cost', -1)}>−</button>
                <strong data-rule-value={rule.cost}>{rule.cost}</strong>
                <button type="button" data-rule-step="1" onClick={() => onAdjust(rule.id, 'cost', 1)}>+</button>
              </span>
            ) : null}
            {rule.kind === 'forcing' ? (
              <>
                <span className="rule-editor__field" data-rule-field="priority">
                  <span>优先级</span>
                  <button type="button" data-rule-step="-1" onClick={() => onAdjust(rule.id, 'priority', -1)}>−</button>
                  <strong data-rule-value={rule.priority}>{rule.priority}</strong>
                  <button type="button" data-rule-step="1" onClick={() => onAdjust(rule.id, 'priority', 1)}>+</button>
                </span>
                <span className="rule-editor__field" data-rule-field="cooldown">
                  <span>每</span>
                  <button type="button" data-rule-step="-1" onClick={() => onAdjust(rule.id, 'cooldown', -1)}>−</button>
                  <strong data-rule-value={rule.cooldown}>{rule.cooldown}</strong>
                  <button type="button" data-rule-step="1" onClick={() => onAdjust(rule.id, 'cooldown', 1)}>+</button>
                </span>
              </>
            ) : null}
          </div>
        ))}
      </div>
      <div className="waveform-editor__actions">
        <span data-rule-close="true" onClick={onClose}>关闭</span>
      </div>
    </div>
  );
}
