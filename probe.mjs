// Проверка международных/Google News RSS (последняя попытка найти рабочий источник).
import https from 'node:https';

function get(url, redirects = 0) {
  return new Promise((resolve) => {
    try {
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (mcp-yandex news probe)', Accept: 'application/rss+xml,text/xml,*/*' }, timeout: 20000 }, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
          if (redirects < 5) { res.resume(); return get(loc, redirects + 1).then(resolve); }
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), ct: res.headers['content-type'], redir: redirects }));
      });
      req.on('error', (e) => resolve({ err: e.message }));
      req.on('timeout', () => req.destroy(new Error('timeout')));
    } catch (e) { resolve({ err: e.message }); }
  });
}

const targets = [
  ['google news RU rss', 'https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru'],
  ['google news top rss', 'https://news.google.com/rss'],
  ['bbc world rss', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['theguardian world rss', 'https://www.theguardian.com/world/rss'],
  ['reuters rss', 'https://feeds.reuters.com/reuters/worldNews'],
  ['cnn rss', 'http://rss.cnn.com/rss/edition_world.rss'],
  ['yahoo news rss', 'https://news.yahoo.com/rss'],
  ['lenta.ru http rss', 'http://lenta.ru/rss'],
];

for (const [name, url] of targets) {
  const r = await get(url);
  if (r.err) { console.log(`[${name}] -> ОШИБКА: ${r.err}`); }
  else {
    const isXml = r.body.trim().startsWith('<?xml') || r.body.includes('<rss') || r.body.includes('<feed');
    const items = (r.body.match(/<item>/g) || []).length;
    const titles = isXml ? (r.body.match(/<title>(.*?)<\/title>/g) || []).slice(0,3).map(t=>t.replace(/<\/?title>/g,'').slice(0,50)) : [];
    console.log(`[${name}] -> HTTP ${r.status} (redir ${r.redir}), ${r.ct}, ${r.body.length}б, XML:${isXml} items:${items}`);
    if (isXml && items) titles.slice(0,2).forEach(t=>console.log(`     «${t}»`));
  }
}