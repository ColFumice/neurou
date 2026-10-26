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
 * 发布：在 Worker 里跑快速模拟，再把音准仪结果用文字摊开。
 * 不做裂缝式诊断——这一轮只要一句能读懂的结论。
 */
export function Publish({ status, summary, error, onRun, onClose }: PublishProps) {
  return (
    <div className="layer layer--modal" data-testid="publish">
      <div className="publish">
        <div className="publish__head">
          <div>
            <div className="publish__kicker">发布前检查</div>
            <h2 className="publish__title">音准仪</h2>
          </div>
          <button className="ghost-btn" onClick={onClose} data-testid="publish-close">
            关闭
          </button>
        </div>

        {status === 'running' && (
          <div className="publish__running" data-testid="publish-running">
            <div className="spinner" />
            <div>
              <div>正在跑快速模拟…</div>
              <div className="muted">随机 / 贪心 / 学习 三种玩家 · 约 600 局 · 每局最多 120 拍</div>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="publish__error">
            模拟没有跑完：{error ?? '未知错误'}
            <button className="ghost-btn" onClick={onRun}>
              再试一次
            </button>
          </div>
        )}

        {status === 'done' && summary && (
          <div data-testid="publish-result">
            <div className="publish__score-row">
              <div className={`publish__score publish__score--${summary.grade}`}>
                <span>{summary.score}</span>
                <small>/100</small>
              </div>
              <div className="publish__score-meta">
                <div className={`publish__grade publish__grade--${summary.grade}`}>
                  {summary.grade === '红' ? '红区 · 还站不稳' : summary.grade === '绿' ? '绿区 · 可以发布' : '黄区 · 过于均衡'}
                </div>
                <div className="publish__verdict">{summary.verdict}</div>
                <div className="muted">
                  {summary.runs} 局 · {Math.round(summary.elapsedMs)}ms · 平均 {summary.meanTicks} 拍 · 以作品本身模拟（本次调音不写入）
                </div>
              </div>
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

            {(summary.notes.length > 0 || summary.deadForcings.length > 0 || summary.deadSignals.length > 0) && (
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
              <button className="primary-btn" onClick={onClose}>
                回到世界
              </button>
            </div>
          </div>
        )}

        {status === 'idle' && (
          <div className="publish__actions">
            <button className="primary-btn" onClick={onRun} data-testid="publish-run">
              开始检查
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
