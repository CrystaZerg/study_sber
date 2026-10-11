/**
 * Smoke-тест MCP-сервера через stdio-транспорт (JSON-RPC по pipes).
 * Стартует dist/index.js, проходит initialize → tools/list → tools/call.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, 'dist/index.js');

const child = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
let seq = 0;

function send(method, params, id = ++seq) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }
});

async function main() {
  const started = Date.now();
  const init = await send('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '1.0.0' },
  });
  const cap = init.capabilities?.tools ?? {};
  console.log(`\n[initialize] ок (${(Date.now() - started)}мс)`);
  if (cap.listChanged) console.log('  tools.listChanged =', cap.listChanged);

  const tools = await send('tools/list', {});
  console.log(`\n[tools/list] найдено инструментов: ${tools.tools.length}`);
  for (const t of tools.tools) {
    console.log(`  - ${t.name}${t.inputSchema && t.inputSchema.required ? ' (required: ' + t.inputSchema.required.join(', ') + ')' : ''}`);
  }

  // Инструмент 1: yandex_ping
  const ping = await send('tools/call', {
    name: 'yandex_ping',
    arguments: {},
  });
  const pingText = ping.content?.[0]?.text ?? '';
  console.log(`\n[yandex_ping] ${pingText.split('\n')[0]}`);
  console.log(pingText.slice(0, 400));

  // Инструмент 2: yandex_homepage_meta
  const meta = await send('tools/call', {
    name: 'yandex_homepage_meta',
    arguments: {},
  });
  console.log(`\n[yandex_homepage_meta]`);
  console.log((meta.content?.[0]?.text ?? '').slice(0, 400));

  // Инструмент 3: yandex_search_suggest
  const sug = await send('tools/call', {
    name: 'yandex_search_suggest',
    arguments: { query: 'погода в', limit: 5 },
  });
  console.log(`\n[yandex_search_suggest]`);
  console.log((sug.content?.[0]?.text ?? '').slice(0, 400));

  // Инструмент 4: yandex_weather
  const weather = await send('tools/call', {
    name: 'yandex_weather',
    arguments: { city: 'moscow' },
  });
  const weatherText = weather.content?.[0]?.text ?? '';
  console.log(`\n[yandex_weather]`);
  console.log(weatherText.slice(0, 600));

  // Инструмент 5: yandex_news
  const news = await send('tools/call', {
    name: 'yandex_news',
    arguments: { limit: 3 },
  });
  const newsText = news.content?.[0]?.text ?? '';
  console.log(`\n[yandex_news]`);
  console.log(newsText.slice(0, 600));

  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('\nSMOKE FAIL:', e.message);
  child.kill();
  process.exit(1);
});