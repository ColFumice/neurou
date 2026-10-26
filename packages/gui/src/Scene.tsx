import { useMemo, type CSSProperties } from 'react';
import type { WorldIR } from '@neurou/core';
import type { ViewSnapshot } from './types.js';
import { booleanOf, numeric } from './types.js';
import type { Tuning } from './tuning.js';
import { paletteOf } from './tuning.js';

interface SceneProps {
  world: WorldIR;
  snap: ViewSnapshot;
  tuning: Tuning;
  visuals: Record<string, number>;
  ghost?: boolean;
  pulseEntity?: string | null;
  onCharacterHover?: (entity: string | null, rect: DOMRect | null) => void;
}

/**
 * 现象层：这个世界看起来的样子。
 *
 * v0.1 没有真实的渲染 / 物理求解器，所以这里是一个「舞台」而不是引擎：
 * 雨、角色、房间、色调都在，但它们只是状态的投影。真正决定发生什么的是
 * 底下的弦网络。
 */
export function Scene({ world, snap, tuning, visuals, ghost, pulseEntity, onCharacterHover }: SceneProps) {
  const isRain = world.strings.some((s) => s.id === '蛞蝓猫.体力');
  const rain = Math.max(numeric(snap, '降雨强度'), (visuals['雨幕'] ?? 0) * 100);
  const palette = paletteOf(tuning, rain);
  const intensity = palette.rain;
  const sheltered = booleanOf(snap, '蛞蝓猫.在避难所');
  const phase = snap.phase;
  const warmth = Math.max(0, (visuals['烛光'] ?? 0) + 0.4);

  const drops = useMemo(() => {
    const count = Math.round(28 + intensity * 72);
    return Array.from({ length: count }, (_, i) => ({
      x: (i * 137.508) % 1000,
      y: (i * 83.3) % 620,
      len: 14 + (i % 5) * 9 + intensity * 12,
      delay: ((i % 17) / 17) * 1.4,
      opacity: 0.18 + ((i % 7) / 7) * 0.35,
    }));
  }, [intensity]);

  const style = {
    '--tint': palette.tint,
    '--darkness': palette.darkness,
    '--rain': intensity,
    '--warmth': warmth,
  } as CSSProperties;

  const hover = (entity: string) => (e: React.MouseEvent<SVGGElement>) => {
    onCharacterHover?.(entity, e.currentTarget.getBoundingClientRect());
  };
  const leave = () => onCharacterHover?.(null, null);

  return (
    <div className={`scene ${ghost ? 'scene--ghost' : ''}`} style={style} data-testid="scene" data-world={isRain ? 'rain' : 'room'}>
      <svg className="scene__sky" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0e1a20" />
            <stop offset="48%" stopColor="#1b2f35" />
            <stop offset="100%" stopColor="#2a3d3a" />
          </linearGradient>
          <linearGradient id="room" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#171513" />
            <stop offset="60%" stopColor="#221d18" />
            <stop offset="100%" stopColor="#12100e" />
          </linearGradient>
          <radialGradient id="lamp" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f3d9a4" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#f3d9a4" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9fc4bc" stopOpacity="0" />
            <stop offset="100%" stopColor="#9fc4bc" stopOpacity="0.16" />
          </linearGradient>
          <clipPath id="window-clip">
            <rect x="86" y="116" width="252" height="234" rx="4" />
          </clipPath>
        </defs>

        {isRain ? (
          <>
            <rect width="1000" height="620" fill="url(#sky)" />
            <ellipse cx="180" cy="230" rx="280" ry="220" fill="url(#lamp)" opacity="0.3" />
            <rect x="0" y="300" width="1000" height="180" fill="url(#mist)" opacity="0.5" />
            <path d="M0 470 L140 430 L260 462 L380 420 L520 470 L660 438 L820 472 L1000 430 L1000 620 L0 620 Z" fill="#152326" />
            <path d="M0 505 L1000 505 L1000 620 L0 620 Z" fill="#0e1719" />
            <path d="M0 505 L1000 505" stroke="#3c5657" strokeWidth="0.6" opacity="0.5" />
            <g opacity="0.9">
              <rect x="820" y="360" width="150" height="150" rx="6" fill="#1c2b2c" stroke="#31484a" strokeWidth="2" />
              <rect x="838" y="382" width="114" height="106" rx="4" fill="#0a1012" />
              <path d="M838 388 Q895 366 952 388" stroke="#40595b" strokeWidth="2" fill="none" />
            </g>
            <g className="rain" opacity={0.7 + intensity * 0.3}>
              {drops.map((d, i) => (
                <line
                  key={i}
                  x1={d.x}
                  y1={d.y}
                  x2={d.x - 4}
                  y2={d.y + d.len}
                  stroke="#cfe4e1"
                  strokeWidth={1 + intensity}
                  opacity={d.opacity + 0.15}
                  style={{ animationDelay: `${d.delay}s`, animationDuration: `${1.1 - intensity * 0.45}s` }}
                  className="rain__drop"
                />
              ))}
            </g>
            <ellipse cx="500" cy="560" rx="440" ry="34" fill="#7fb3ad" opacity={0.04 + intensity * 0.05} />

            <g
              className={`actor ${pulseEntity === '蛞蝓猫' ? 'actor--pulse' : ''}`}
              transform={sheltered ? 'translate(880, 455) scale(0.72)' : 'translate(318, 455)'}
              opacity={sheltered ? 0.85 : 1}
              onMouseEnter={hover('蛞蝓猫')}
              onMouseMove={hover('蛞蝓猫')}
              onMouseLeave={leave}
              data-actor="蛞蝓猫"
            >
              <ellipse cx="0" cy="34" rx="58" ry="12" fill="#000" opacity="0.35" />
              <path d="M-52 18 Q-96 34 -104 58" stroke="#e8e2d4" strokeWidth="10" fill="none" strokeLinecap="round" />
              <ellipse cx="0" cy="8" rx="52" ry="38" fill="#efe9dc" />
              <circle cx="34" cy="-26" r="26" fill="#f5f0e6" />
              <path d="M18 -48 L12 -70 L30 -54 Z" fill="#f5f0e6" />
              <path d="M48 -48 L54 -70 L60 -50 Z" fill="#f5f0e6" />
              <circle cx="42" cy="-28" r="3.4" fill="#1a2224" />
              <circle cx="26" cy="-28" r="3.4" fill="#1a2224" />
              <path d="M32 -16 Q36 -12 40 -16" stroke="#1a2224" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M-12 34 L-16 50 M14 34 L18 50" stroke="#cfc7b6" strokeWidth="6" strokeLinecap="round" />
              {sheltered && <circle cx="6" cy="0" r="62" fill="none" stroke="#9fe0c8" strokeWidth="1.5" opacity="0.5" />}
            </g>

            <g
              className={`actor ${pulseEntity === '蜥蜴' ? 'actor--pulse' : ''}`}
              transform="translate(690, 470)"
              onMouseEnter={hover('蜥蜴')}
              onMouseMove={hover('蜥蜴')}
              onMouseLeave={leave}
              data-actor="蜥蜴"
            >
              <ellipse cx="0" cy="28" rx="86" ry="12" fill="#000" opacity="0.3" />
              <path d="M-70 6 Q-130 -2 -170 26" stroke="#5c7a55" strokeWidth="12" fill="none" strokeLinecap="round" />
              <ellipse cx="-10" cy="0" rx="78" ry="26" fill="#6f8f61" transform="rotate(-6)" />
              <ellipse cx="62" cy="-14" rx="34" ry="22" fill="#789a69" />
              <circle cx="72" cy="-20" r="4" fill="#131a16" />
              <path d="M-40 22 L-44 40 M-6 24 L-8 42 M30 20 L28 38" stroke="#4f6a49" strokeWidth="6" strokeLinecap="round" />
              <path d="M86 -6 L104 8 L92 4 Z" fill="#4f6a49" />
            </g>
          </>
        ) : (
          <>
            <rect width="1000" height="620" fill="url(#room)" />
            <ellipse cx="500" cy="300" rx="520" ry="330" fill="#000" opacity="0.35" />

            {/* 窗与雨 */}
            <g clipPath="url(#window-clip)">
              <rect x="86" y="116" width="252" height="234" fill="#0b1518" />
              <rect x="86" y="116" width="252" height="234" fill="url(#mist)" opacity="0.5" />
              {drops.slice(0, 46).map((d, i) => (
                <line
                  key={i}
                  x1={100 + ((d.x * 0.24) % 240)}
                  y1={110 + ((d.y * 0.38) % 240)}
                  x2={100 + ((d.x * 0.24) % 240) - 3}
                  y2={110 + ((d.y * 0.38) % 240) + d.len * 0.8}
                  stroke="#bcd7d6"
                  strokeWidth="1.4"
                  opacity={0.25 + intensity * 0.4}
                  className="rain__drop"
                  style={{ animationDelay: `${d.delay}s` }}
                />
              ))}
            </g>
            <rect x="86" y="116" width="252" height="234" rx="4" fill="none" stroke="#3a332b" strokeWidth="3" />
            <line x1="212" y1="116" x2="212" y2="350" stroke="#3a332b" strokeWidth="2" />
            <line x1="86" y1="234" x2="338" y2="234" stroke="#3a332b" strokeWidth="2" />

            {/* 吊灯 */}
            <line x1="700" y1="0" x2="700" y2="96" stroke="#2b2520" strokeWidth="2" />
            <path d="M672 96 L728 96 L716 124 L684 124 Z" fill="#3a2f24" />
            <ellipse cx="700" cy="128" rx="30" ry="7" fill="#e8c78a" opacity="0.85" />
            <ellipse cx="700" cy="330" rx="360" ry="250" fill="url(#lamp)" opacity={0.55 + Math.min(0.35, warmth * 0.2)} />

            {/* 桌子 */}
            <ellipse cx="700" cy="486" rx="300" ry="44" fill="#000" opacity="0.4" />
            <rect x="410" y="444" width="580" height="14" rx="6" fill="#3a2c22" />
            <rect x="440" y="458" width="16" height="96" fill="#2a2019" />
            <rect x="944" y="458" width="16" height="96" fill="#2a2019" />
            <ellipse cx="700" cy="444" rx="290" ry="26" fill="#4a3729" />
            <ellipse cx="640" cy="438" rx="26" ry="7" fill="#6b543f" opacity="0.8" />
            <ellipse cx="760" cy="440" rx="20" ry="6" fill="#6b543f" opacity="0.6" />

            {/* 使者 */}
            <g
              className={`actor ${pulseEntity === '使者' ? 'actor--pulse' : ''}`}
              transform="translate(520, 400)"
              onMouseEnter={hover('使者')}
              onMouseMove={hover('使者')}
              onMouseLeave={leave}
              data-actor="使者"
            >
              <path d="M-34 64 Q-30 12 0 8 Q30 12 34 64 Z" fill="#2c333a" />
              <path d="M-26 26 Q0 34 26 26 L30 44 Q0 52 -30 44 Z" fill="#222a30" />
              <circle cx="0" cy="-6" r="19" fill="#cbb69b" />
              <path d="M-19 -10 Q0 -30 19 -10 Q10 -18 0 -18 Q-10 -18 -19 -10 Z" fill="#3a3129" />
              <path d="M-22 30 Q-44 40 -48 58" stroke="#2c333a" strokeWidth="8" fill="none" strokeLinecap="round" />
              <path d="M22 30 Q44 40 48 58" stroke="#2c333a" strokeWidth="8" fill="none" strokeLinecap="round" />
            </g>

            {/* 你 */}
            <g
              className={`actor ${pulseEntity === '你' ? 'actor--pulse' : ''}`}
              transform="translate(880, 400)"
              onMouseEnter={hover('你')}
              onMouseMove={hover('你')}
              onMouseLeave={leave}
              data-actor="你"
            >
              <path d="M-34 64 Q-30 12 0 8 Q30 12 34 64 Z" fill="#3a2f28" />
              <path d="M-26 26 Q0 34 26 26 L30 44 Q0 52 -30 44 Z" fill="#2c241f" />
              <circle cx="0" cy="-6" r="19" fill="#b9a58d" />
              <path d="M-19 -10 Q0 -30 19 -10 Q10 -18 0 -18 Q-10 -18 -19 -10 Z" fill="#2a231d" />
              <path d="M-22 30 Q-44 40 -48 58" stroke="#3a2f28" strokeWidth="8" fill="none" strokeLinecap="round" />
              <path d="M22 30 Q44 40 48 58" stroke="#3a2f28" strokeWidth="8" fill="none" strokeLinecap="round" />
            </g>
          </>
        )}
      </svg>

      <div className="scene__veil" />
      <div
        className="scene__tone"
        style={{
          opacity: Math.min(0.6, Math.abs(visuals['色调'] ?? 0) + Math.abs(visuals['烛光'] ?? 0) * 0.5),
          background:
            (visuals['色调'] ?? 0) + (visuals['烛光'] ?? 0) >= 0
              ? 'rgba(224, 163, 122, 0.35)'
              : 'rgba(70, 110, 140, 0.35)',
        }}
      />
      <div className="scene__vignette" style={{ opacity: Math.min(0.6, Math.abs(visuals['暗角'] ?? 0) * 0.8) }} />
      <div className="scene__grain" />

      {!ghost && phase && (
        <div className="scene__phase" aria-hidden="true">
          <span className="scene__phase-name">{phase}</span>
          <span className="scene__phase-bar">
            <i style={{ transform: `scaleX(${Math.max(0.02, snap.phaseProgress)})` }} />
          </span>
        </div>
      )}
    </div>
  );
}
