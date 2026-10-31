import { useEffect, useRef, useState } from 'react';

export interface ContextDslEditorProps {
  context: string;
  hint: string;
  source: string;
  readOnly?: boolean;
  error?: string;
  onApply: (next: string) => void;
  onClose: () => void;
}

/** F7：当前界面元素的 DSL 声明式编辑层。 */
export function ContextDslEditor({
  context,
  hint,
  source,
  readOnly = false,
  error = '',
  onApply,
  onClose,
}: ContextDslEditorProps): JSX.Element {
  const [draft, setDraft] = useState(source);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setDraft(source), [source]);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  return (
    <div
      className="context-dsl"
      data-testid="context-dsl-editor"
      data-context={context}
      data-read-only={readOnly ? 'true' : 'false'}
      tabIndex={-1}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.code === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="context-dsl__panel">
        <div className="context-dsl__head">
          <div>
            <div className="context-dsl__kicker">F7 · DSL</div>
            <div className="context-dsl__title">{context}</div>
          </div>
          <span className="context-dsl__close" role="button" tabIndex={0} onClick={onClose}>
            关闭
          </span>
        </div>
        <div className="context-dsl__hint">{hint}</div>
        <textarea
          className="context-dsl__source"
          data-testid="context-dsl-source"
          spellCheck={false}
          readOnly={readOnly}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {error ? <div className="context-dsl__error">{error}</div> : null}
        <div className="context-dsl__foot">
          <span>{readOnly ? '当前界面暂不支持直接写回 DSL' : '只修改当前元素声明 · 编译通过才写回'}</span>
          <button
            type="button"
            className="context-dsl__apply"
            data-testid="context-dsl-apply"
            disabled={readOnly}
            onClick={() => onApply(draft)}
          >
            应用声明
          </button>
        </div>
      </div>
    </div>
  );
}
