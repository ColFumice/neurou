import { useEffect, useState } from 'react';
import type { PublishSummary } from './types.js';

interface PublishProps {
  status: 'idle' | 'running' | 'done' | 'error';
  summary?: PublishSummary;
  error?: string;
  onRun: () => void;
  onClose: () => void;
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

/** ≤20 字的一句诊断。 */
function shortDiagnosis(grade: PublishSummary['grade']): string {
  if (grade === '红') return '还站不稳，先修死局';
  if (grade === '黄') return '太均衡了，缺意外';
  return '站得住，也有分歧';
}

/**
 * 发布：全屏纯黑。
 *
 * 默认只有两样东西——大号分数、一句诊断。命运分布/维度/死规则在「＋」后面。
 * Esc 或点背景返回。
 */
export function Publish({ status, summary, error, onRun, onClose }: PublishProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="layer layer--publish" data-testid="publish" onClick={onClose}>
      {status === 'running' && (
        <div className="publish__running" data-testid="publish-running" onClick={(e) => e.stopPropagation()}>
          <div className="spinner" />
          <div>正在跑 600 局…</div>
        </div>
      )}

      {status === 'error' && (
        <div className="publish__error" onClick={(e) => e.stopPropagation()}>
          <div>模拟没有跑完：{error ?? '未知错误'}</div>
          <button className="ghost-btn" onClick={onRun}>
            再试一次
          </button>
        </div>
      )}

      {status === 'done' && summary && (
        <div className="publish__stage" data-testid="publish-result" onClick={(e) => e.stopPropagation()}>
          <div className={`publish__score publish__score--${summary.grade}`} data-publish-line>
            {summary.score}
          </div>
          <p className="publish__diagnosis" data-publish-line>
            {shortDiagnosis(summary.grade)}
          </p>

          <button
            className="publish__more"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? '收起' : '展开'}
            data-testid="publish-more"
          >
            {expanded ? '−' : '＋'}
          </button>

          {expanded && (
            <div className="publish__detail" data-testid="publish-detail">
              <div className="publish__zone">
                {summary.grade === '红' ? '红区 · 还站不稳' : summary.grade === '绿' ? '绿区 · 可以发布' : '黄区 · 过于均衡'}
                {' · '}
                {summary.runs} 局 · {Math.round(summary.elapsedMs)}ms · 平均 {summary.meanTicks} 拍
              </div>
              <p className="publish__long">{summary.verdict}</p>
              <p className="publish__long muted">以作品本身模拟（本次调音不写入）</p>

              <div className="publish__section">
                <div className="publish__section-title">命运分布</div>
                {Object.entries(summary.endings)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, count]) => (
                    <div className="publish__bar" key={name}>
                      <span className="publish__bar-name">{name}</span>
                      <span className="publish__bar-track">
                        <i style={{ width: `${pct(count, summary.total)}%` }} />
                      </span>
                      <span className="publish__bar-num">
                        {pct(count, summary.total)}% · {count}
                      </span>
                    </div>
                  ))}
              </div>

              <div className="publish__section">
                <div className="publish__section-title">维度</div>
                {summary.dimensions.map((d) => (
                  <div className="publish__dim" key={d.key}>
                    <span className={`publish__dot ${d.ratio >= 0.8 ? 'ok' : d.ratio >= 0.5 ? 'mid' : 'bad'}`} />
                    <span className="publish__dim-label">{d.label}</span>
                    <span className="publish__dim-value">{d.value}</span>
                    <span className="publish__dim-detail">{d.detail}</span>
                  </div>
                ))}
              </div>

              {(summary.notes.length > 0 || summary.violations > 0 || summary.deadStateRuns > 0) && (
                <div className="publish__section">
                  <div className="publish__section-title">文字诊断</div>
                  <ul className="publish__notes">
                    {summary.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                    {summary.violations > 0 && <li>公理违反 {summary.violations} 次——某个规则正在把世界推到自相矛盾。</li>}
                    {summary.deadStateRuns > 0 && <li>{summary.deadStateRuns} 局的玩家陷入「无事可做」。</li>}
                  </ul>
                </div>
              )}

              <div className="publish__actions">
                <button className="ghost-btn" onClick={onRun}>
                  再跑一次
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
