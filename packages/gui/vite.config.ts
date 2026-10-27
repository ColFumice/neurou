import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, sep } from 'node:path';
import { renameSync, readFileSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';

/**
 * 调律台写回（仅 dev）：POST /__neurou/save { file, text }
 * 只允许写 examples/ 下的 .nro。写完不热重载（server.watch.ignored 忽略 .nro），
 * 这样调律台运行时不会被刷新打断；刷新页面即回到刚写下的基线。
 */
function tunerSavePlugin(): Plugin {
  const root = resolve(__dirname, '../..');
  const examplesRoot = resolve(root, 'examples');

  const reply = (res: ServerResponse, status: number, payload: unknown): void => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  };

  return {
    name: 'neurou-tuner-save',
    apply: 'serve',
    configureServer(server) {
      // 读世界（dev 下 App 用 fetch 取源码，确保写回后刷新能拿到新文件）
      server.middlewares.use('/__neurou/world', (req, res) => {
        if (req.method !== 'GET') {
          reply(res, 405, { ok: false, error: 'GET only' });
          return;
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const file = url.searchParams.get('file') ?? 'examples/tuner.nro';
          const absolute = resolve(root, file);
          if (!absolute.startsWith(examplesRoot + sep) || !absolute.endsWith('.nro')) {
            throw new Error('只能读 examples/ 下的 .nro 文件');
          }
          const text = readFileSync(absolute, 'utf8');
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(text);
        } catch (error) {
          reply(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/__neurou/save', (req, res) => {
        if (req.method !== 'POST') {
          reply(res, 405, { ok: false, error: 'POST only' });
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.length > 4 * 1024 * 1024) req.destroy();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body) as { file?: unknown; text?: unknown };
            const file = typeof data.file === 'string' ? data.file : 'examples/tuner.nro';
            if (typeof data.text !== 'string') throw new Error('text 必须是字符串');
            const absolute = resolve(root, file);
            if (!absolute.startsWith(examplesRoot + sep) || !absolute.endsWith('.nro')) {
              throw new Error('只能写 examples/ 下的 .nro 文件');
            }
            const temp = `${absolute}.tmp`;
            writeFileSync(temp, data.text, 'utf8');
            renameSync(temp, absolute);
            reply(res, 200, { ok: true, file, bytes: Buffer.byteLength(data.text, 'utf8') });
          } catch (error) {
            reply(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tunerSavePlugin()],
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname, '../..')],
    },
    watch: {
      // 调律台写回 .nro 时不要刷新页面；下次手动刷新才读新基线。
      // 同时忽略编辑器/代理留下的临时文件；用 polling 避免 Windows 上
      // 临时文件被占用（EBUSY）时把 fs.watch 搞崩。
      usePolling: true,
      interval: 400,
      ignored: ['**/*.nro', '**/*.nro.tmp', '**/*.tmp', '**/.*.tmpdir/**', '**/*.tmpdir/**'],
    },
  },
});
