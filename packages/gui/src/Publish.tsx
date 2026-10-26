import { useState } from 'react';
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

/**
 * 发布：全屏覆盖，不是弹窗。
 *
 * 默认只留三行——分数、区、一句话诊断。命运分布、维度、死规则都折叠在「展开」里。
 */
export function Publish({ status, summary, error, onRun, onClose }: PublishProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="layer layer--publish" data-testid="publish">
      <button className="publish__close" onClick={onClose} data-testid="publish-close">
        关闭
      </button>

      {status === 'running' && (
        <div className="publish__running" data-testid="publish-running">
          <div className="spinner" />
          <div>正在跑 600 局…</div>
        </div>
      )}

      {status === 'error' && (
        <div className="publish__error">
          <div>模拟没有跑完：{error ?? '未知错误'}</div>
          <button className="ghost-btn" onClick={onRun}>
            再试一次
          </button>
        </div>
      )}

      {status === 'done' && summary && (
        <div className="publish__stage" data-testid="publish-result">
          <div className="publish__kicker" data-publish-line>
            音准仪
          </div>
          <div className="publish__scoreline" data-publish-line>
            <span className={`publish__score publish__score--${summary.grade}`}>{summary.score}</span>
            <span className="publish__den">/100</span>
            <span className={`publish__grade publish__grade--${summary.grade}`}>
              {summary.grade === '红' ? '红区 · 还站不稳' : summary.grade === '绿' ? '绿区 · 可以发布' : '黄区 · 过于均衡'}
            </span>
          </div>
          <p className="publish__verdict" data-publish-line>
            {summary.verdict}
          </p>

          <button className="publish__more" onClick={() => setExpanded((v) => !v)} data-testid="publish-more">
            {expanded ? '收起' : '展开'}
          </button>

          {expanded && (
            <div className="publish__detail" data-testid="publish-detail">
              <div className="publish__meta">
                {summary.runs} 局 · {Math.round(summary.elapsedMs)}ms · 平均 {summary.meanTicks} 拍 · 以作品本身模拟（本次调音不写入）
              </div>

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
                <button className="ghost-btn" onClick={onClose}>
                  回到世界
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
