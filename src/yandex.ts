/**
 * Низкоуровневый клиент к публичным возможностям Яндекса (ya.ru).
 *
 * Все инструменты — read-only: сервер НЕ изменяет состояние ни на Яндексе,
 * ни на стороне клиента. Используются только открытые HTTP-эндпоинты без
 * авторизации:
 *   - https://ya.ru            — главная страница (HTTP-статус, тайминги, метаданные);
 *   - https://suggest.yandex.ru/suggest-ff.cgi — публичные поисковые подсказки.
 */

import { performance } from 'node:perf_hooks';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export const YA_RU = 'https://ya.ru';
export const SUGGEST_ENDPOINT =
  'https://suggest.yandex.ru/suggest-ff.cgi?part={q}&v=4&lr=213&search_domain=ya.ru';

/** HTTP(S)-клиент с таймингами этапов соединения. */
export function timedRequest(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  timings: {
    dns: number;
    connect: number;
    tls: number;
    wait: number;
    total: number;
    remoteIp?: string;
  };
}> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const timings = { dns: 0, connect: 0, tls: 0, wait: 0, total: 0 };
    const start = performance.now();
    let settled = false;

    const done = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const req = lib.request(
      u,
      {
        method: 'GET',
        headers: {
          'User-Agent':
            'mcp-yandex/1.0 (+MCP server; contact: local dev tooling)',
          Accept: '*/*',
          ...opts.headers,
        },
        timeout: opts.timeoutMs ?? 10000,
      },
      (res) => {
        timings.wait = performance.now() - start;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          timings.total = performance.now() - start;
          done(() =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
              timings: { ...timings, remoteIp: res.socket?.remoteAddress },
            }),
          );
        });
      },
    );

    req.on('socket', (socket) => {
      const t0 = performance.now();
      socket.on('lookup', () => (timings.dns = performance.now() - t0));
      socket.on('connect', () => (timings.connect = performance.now() - t0));
      socket.on('secureConnect', () => (timings.tls = performance.now() - t0));
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${opts.timeoutMs ?? 10000}ms`));
    });
    req.on('error', (err) => done(() => reject(err)));
    req.end();
  });
}

/** Проверка доступности ya.ru: статус, заголовки и тайминги. */
export async function pingYandex(): Promise<Record<string, unknown>> {
  const res = await timedRequest(YA_RU);
  return {
    ok: res.status >= 200 && res.status < 300,
    url: YA_RU,
    statusCode: res.status,
    statusMessage: statusCodeMessage(res.status),
    server: res.headers.server ?? null,
    contentType: res.headers['content-type'] ?? null,
    cacheControl: res.headers['cache-control'] ?? null,
    remoteIp: res.timings.remoteIp ?? null,
    timingsMs: {
      dns: Math.round(res.timings.dns),
      connect: Math.round(res.timings.connect),
      tls: Math.round(res.timings.tls),
      wait: Math.round(res.timings.wait),
      total: Math.round(res.timings.total),
    },
    bodyBytes: res.body.length,
  };
}

function statusCodeMessage(code: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    301: 'Moved Permanently',
    302: 'Found',
    403: 'Forbidden',
    404: 'Not Found',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return map[code] ?? `HTTP ${code}`;
}

/** Читает <title> и мета-описание из HTML-ответа. */
function extractTitleAndDescription(html: string):{
  title?: string;
  description?: string;
} {
  const result: { title?: string; description?: string } = {};
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) result.title = decodeEntities(titleMatch[1].trim());
  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  );
  if (descMatch) result.description = decodeEntities(descMatch[1]);
  return result;
}

function decodeEntities(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/'/g, "'");
}

/** Читает метаданные главной страницы ya.ru (title, описание, редиректы). */
export async function homepageMeta(): Promise<Record<string, unknown>> {
  const res = await timedRequest(YA_RU);
  const html = res.body.toString('utf8');
  const { title, description } = extractTitleAndDescription(html);

  return {
    url: YA_RU,
    statusCode: res.status,
    finalUrl: res.headers.location ?? YA_RU,
    redirected: Boolean(res.headers.location),
    title: title ?? null,
    description: description ?? null,
    htmlBytes: html.length,
  };
}

/**
 * Поисковые подсказки Яндекса для заданной строки.
 * Публичный эндпоинт suggest-yandex, работает без ключа.
 */
export async function searchSuggest(
  part: string,
  limit: number,
): Promise<Record<string, unknown>> {
  const q = part.trim();
  if (!q) {
    return { query: '', suggestions: [], note: 'Пустой запрос' };
  }
  const url = SUGGEST_ENDPOINT.replace('{q}', encodeURIComponent(q));
  const res = await timedRequest(url, {
    headers: {
      'X-Yandex-Request': '1',
      connection: 'close',
    },
  });
  if (res.status !== 200) {
    throw new Error(
      `suggest.yandex.ru вернул HTTP ${res.status} (${statusCodeMessage(res.status)})`,
    );
  }

  // Формат ответа suggest-ff.cgi: JSON вида ["запрос", [["подсказка1",...],...],...]
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body.toString('utf8'));
  } catch (e) {
    throw new Error('Невозможно распарсить ответ подсказок Яндекса: ' + e);
  }

  const suggestions = extractSuggestions(parsed, limit);
  return { query: q, suggestions, count: suggestions.length };
}

function extractSuggestions(payload: unknown, limit: number): string[] {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  const rows = payload[1];
  if (!Array.isArray(rows)) return [];
  return Array.from(rows)
    .slice(0, limit)
    .map((row) => {
      if (Array.isArray(row) && typeof row[0] === 'string') return row[0];
      if (typeof row === 'string') return row;
      return '';
    })
    .filter((s) => s.length > 0);
}
