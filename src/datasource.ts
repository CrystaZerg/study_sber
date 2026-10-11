/**
 * Дополнительные источники данных (погода, новости) для MCP-сервера.
 *
 * Все инструменты — read-only, работают через открытые HTTP-эндпоинты без ключей:
 *   - wttr.in            — погода (JSON-формат j1, lang=ru);
 *   - Google News RU     — актуальные новости (RSS, hl=ru&gl=RU&ceid=RU:ru).
 *
 * Используется общий HTTP-хелпер timedRequest из ./yandex.js (не следует редиректам).
 */

import { timedRequest } from './yandex.ts';

const WTTR_ENDPOINT = 'https://wttr.in/{city}?format=j1&lang=ru';
const GOOGLE_NEWS_RU_RSS = 'https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru';

/**
 * Погода для заданного города через открытый сервис wttr.in (JSON j1, lang=ru).
 * Парсит текущие условия и краткий прогноз на сегодня; без API-ключа.
 */
export async function yandexWeather(city: string): Promise<Record<string, unknown>> {
  const q = city.trim();
  if (!q) {
    throw new Error('Поле city не должно быть пустым');
  }
  const url = WTTR_ENDPOINT.replace('{city}', encodeURIComponent(q));
  const res = await timedRequest(url, {
    headers: { Accept: 'application/json' },
  });

  const text = res.body.toString('utf8');

  // wttr.in при ошибке города возвращает HTTP 500 с текстом «location not found»
  // (или HTML-страницу «Unknown location») вместо JSON.
  if (res.status !== 200 || !text.trim().startsWith('{')) {
    const isNotFound =
      /location not found/i.test(text) || /Unknown location/i.test(text);
    if (isNotFound) {
      throw new Error(`Город «${q}» не найден на wttr.in`);
    }
    throw new Error(
      isJsonLike(text)
        ? `wttr.in вернул HTTP ${res.status}`
        : `wttr.in вернул HTTP ${res.status} — ответ не является JSON (город «${q}» не найден на wttr.in?)`,
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('Невозможно распарсить ответ wttr.in: ' + e);
  }

  const current = parsed?.current_condition?.[0];
  if (!current) {
    throw new Error('В ответе wttr.in отсутствует блок current_condition');
  }

  const today = parsed?.weather?.[0];

  return {
    city: q,
    tempC: current.temp_C,
    feelsLikeC: current.FeelsLikeC,
    humidity: current.humidity,
    wind: {
      kmph: current.windspeedKmph,
      dir: current.winddir16Point,
    },
    condition: (current.weatherDesc?.[0]?.value ?? '').trim() || null,
    observationTime: current.observation_time ?? null,
    forecastToday: today
      ? {
          date: today.date ?? null,
          minC: today.mintempC ?? null,
          maxC: today.maxtempC ?? null,
          condition: (today.hourly?.[0]?.weatherDesc?.[0]?.value ?? '').trim() || null,
        }
      : null,
  };
}

/** Проверяет, похоже ли тело ответа на JSON (начинается с '{' и парсится). */
function isJsonLike(text: string): boolean {
  const t = text.trim();
  return t.startsWith('{') || t.startsWith('[');
}

/**
 * Актуальные новости RU через Google News RSS.
 * В этой корпоративной сети российские новостные RSS (в т.ч. news.yandex.ru)
 * блокируются TLS-обрывами, поэтому используется рабочий открытый фид Google News RU.
 * Параметр region принимает «RU» и игнорирует прочие значения (regionApplied=false).
 */
export async function yandexNews(
  limit: number,
  region: string,
): Promise<Record<string, unknown>> {
  const regionApplied = region.trim().toUpperCase() === 'RU';
  const n = Math.min(Math.max(Math.floor(limit) || 8, 1), 20);

  const res = await timedRequest(GOOGLE_NEWS_RU_RSS, {
    headers: { Accept: 'application/xml, text/xml' },
  });

  if (res.status !== 200) {
    throw new Error(
      `Google News RSS вернул HTTP ${res.status}`,
    );
  }

  const xml = res.body.toString('utf8');
  const allItems = parseGoogleNewsItems(xml);
  const items = allItems.slice(0, n);

  return {
    queryRegion: region.trim() || 'RU',
    count: items.length,
    regionApplied,
    items,
  };
}

/**
 * Парсит RSS-ленту Google News regex-ом без внешних зависимостей.
 * Из каждого <item> извлекаются <title>, <link>, <pubDate>.
 * Заголовок Google News приходит как «Заголовок - Источник».
 */
function parseGoogleNewsItems(xml: string): Array<{
  title: string;
  source: string;
  link: string;
  pubDate: string;
}> {
  const items: Array<{ title: string; source: string; link: string; pubDate: string }> = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');

    if (title) {
      items.push({
        title,
        source: extractNewsSource(title),
        link,
        pubDate,
      });
    }
  }

  return items;
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  return decodeXmlEntities(m[1].trim());
}

/** Заголовок Google News приходит как «Заголовок - Источник» — отделяем источник. */
function extractNewsSource(title: string): string {
  const sep = title.lastIndexOf(' - ');
  if (sep > 0) return title.slice(sep + 3).trim();
  return '';
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/ /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, (m) => {
      try {
        return String.fromCodePoint(Number(m.slice(2, -1)));
      } catch {
        return m;
      }
    });
}