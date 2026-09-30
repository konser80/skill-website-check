#!/usr/bin/env node
// website-check: проверка сайта по URL (live) или по собранной папке (dist/).
// Usage: node check.mjs <url | path> [--site https://example.com] [--json] [--pages N]
// Exit: 0 — нет must-ошибок, 1 — есть must-ошибки, 2 — ошибка запуска.

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = { json: false, pages: 5, site: null };
let target = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') opt.json = true;
  else if (a === '--pages') opt.pages = Number(argv[++i]);
  else if (a === '--site') opt.site = argv[++i];
  else if (!target) target = a;
}
if (!target) {
  console.error('Usage: node check.mjs <url | path> [--site https://example.com] [--json] [--pages N]');
  process.exit(2);
}

const UA = 'Mozilla/5.0 (compatible; website-check/1.0)';
const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider', 'meta-externalagent', 'YandexAdditional'];

// ---------- results ----------
const results = [];
const add = (group, level, ok, msg, fix) => results.push({ group, level, ok, msg, ...(fix && !ok ? { fix } : {}) });
const info = (group, msg) => results.push({ group, level: 'info', ok: true, msg });

// ---------- source: live or folder ----------
const isLive = /^https?:\/\//i.test(target);
let origin, root, siteFromConfig = null, astroCfg = null, staleDist = null;

if (isLive) {
  origin = new URL(target).origin;
} else {
  let p = path.resolve(target);
  if (!fs.existsSync(p)) { console.error(`Нет такого пути: ${p}`); process.exit(2); }
  const cfg = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.mts']
    .map(f => path.join(p, f)).find(f => fs.existsSync(f));
  if (cfg) {
    const m = fs.readFileSync(cfg, 'utf8').match(/\bsite\s*:\s*['"`]([^'"`]+)['"`]/);
    if (m) siteFromConfig = m[1];
    const dist = path.join(p, 'dist');
    if (!fs.existsSync(dist)) { console.error(`Это Astro-проект, но нет dist/. Сначала: npm run build`); process.exit(2); }
    astroCfg = cfg;
    // SSR/hybrid: статика лежит в dist/client
    const out = fs.existsSync(path.join(dist, 'client')) ? path.join(dist, 'client') : dist;
    // dist старше исходников → проверяем не то, что в коде
    const newest = d => !fs.existsSync(d) ? 0 : Math.max(0, ...fs.readdirSync(d, { recursive: true })
      .map(f => fs.statSync(path.join(d, f))).filter(s => s.isFile()).map(s => s.mtimeMs));
    const srcTime = Math.max(newest(path.join(p, 'src')), newest(path.join(p, 'public')), fs.statSync(cfg).mtimeMs);
    const distTime = fs.existsSync(path.join(out, 'index.html')) ? fs.statSync(path.join(out, 'index.html')).mtimeMs : 0;
    if (srcTime > distTime) staleDist = new Date(distTime).toISOString().slice(0, 16).replace('T', ' ');
    p = out;
  } else if (fs.existsSync(path.join(p, 'dist', 'index.html'))) {
    p = path.join(p, 'dist');
  }
  if (!fs.existsSync(path.join(p, 'index.html'))) { console.error(`Не нашёл index.html в ${p}`); process.exit(2); }
  root = p;
}

async function get(url, { redirect = 'follow', method = 'GET', binary = false } = {}) {
  if (isLive) {
    try {
      const r = await fetch(url, { redirect, method, headers: { 'user-agent': UA, 'accept-encoding': 'br, gzip' }, signal: AbortSignal.timeout(15000) });
      const body = method === 'HEAD' ? '' : binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
      return { status: r.status, headers: r.headers, body, url: r.url, redirected: r.redirected };
    } catch (e) {
      return { status: 0, headers: new Headers(), body: binary ? Buffer.alloc(0) : '', url, error: e.cause?.code || e.message };
    }
  }
  // folder: map URL path to file
  const u = new URL(url, origin || 'http://local');
  let rel = decodeURIComponent(u.pathname);
  const cands = rel.endsWith('/') ? [rel + 'index.html'] : [rel, rel + '.html', rel + '/index.html'];
  for (const c of cands) {
    const f = path.join(root, c);
    if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      return { status: 200, headers: new Headers(), body: binary ? fs.readFileSync(f) : fs.readFileSync(f, 'utf8'), url: u.href, file: f };
    }
  }
  return { status: 404, headers: new Headers(), body: binary ? Buffer.alloc(0) : '', url: u.href };
}

// ---------- tiny HTML helpers ----------
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)]
  .map(m => [m[1].toLowerCase(), (m[3] ?? m[4] ?? m[5] ?? '').trim()]));
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(m => attrs(m[0]));
const meta = (html, key) => tags(html, 'meta').find(a => (a.property || a.name || '').toLowerCase() === key)?.content;
const links = (html, rel) => tags(html, 'link').filter(a => (a.rel || '').toLowerCase().split(/\s+/).includes(rel));
const decode = s => s?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const titleOf = html => decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim());

function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const k = buf.toString('ascii', 12, 16);
    if (k === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), type: 'webp' };
    if (k === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, type: 'webp' };
    if (k === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, type: 'webp' }; }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'jpeg' };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// ---------- main ----------
const G = { idx: 'Индексация', sm: 'Sitemap', meta: 'Мета', og: 'Соцсети / OG', ico: 'Иконки', llm: 'LLM', ld: 'Структурированные данные', tech: 'Техника', an: 'Аналитика' };

const home = await get(isLive ? target : '/');
if (isLive && home.status !== 200) {
  console.error(`Главная отдала ${home.status || home.error}`); process.exit(2);
}
const html = home.body;
if (isLive) origin = new URL(home.url).origin;
else {
  const canon = links(html, 'canonical')[0]?.href;
  origin = opt.site || siteFromConfig || (canon && /^https?:/.test(canon) ? new URL(canon).origin : null);
  if (!origin) info(G.idx, 'Не знаю домен сайта (нет site в astro.config и canonical) — проверки абсолютных URL ограничены. Передай --site');
  origin = (origin || 'https://example.invalid').replace(/\/$/, '');
}
if (staleDist) add(G.idx, 'must', false, `dist/ (${staleDist}) старше src/, public/ или astro.config — результат может не соответствовать коду`, 'npm run build и повторить');
if (astroCfg) add(G.idx, 'should', !!siteFromConfig, siteFromConfig ? `astro.config site: ${siteFromConfig}` : `в ${path.basename(astroCfg)} нет site — домен взят из ${opt.site ? '--site' : 'canonical'}`, "добавить site: 'https://…' — от него зависят sitemap, canonical, og:image");
const host = new URL(origin).host;
const sameHost = u => { try { return new URL(u).host === host; } catch { return false; } };

// ---- robots.txt ----
const robots = await get(`${origin}/robots.txt`);
const robotsOk = robots.status === 200 && !/<html/i.test(robots.body);
add(G.idx, 'must', robotsOk, `robots.txt ${robotsOk ? 'есть' : 'не найден (' + robots.status + ')'}`, 'создать robots.txt');
let robotSitemaps = [];
if (robotsOk) {
  const lines = robots.body.split(/\r?\n/).map(l => l.replace(/#.*/, '').trim());
  robotSitemaps = lines.filter(l => /^sitemap\s*:/i.test(l)).map(l => l.replace(/^sitemap\s*:\s*/i, ''));
  // блоки User-agent: *
  let inStar = false, star = [], prevUA = false;
  for (const l of lines) {
    const ua = l.match(/^user-agent\s*:\s*(.+)$/i);
    if (ua) { inStar = (prevUA && inStar) || ua[1].trim() === '*'; prevUA = true; continue; }
    prevUA = false;
    if (inStar) star.push(l);
  }
  const blockAll = star.some(l => /^disallow\s*:\s*\/\s*$/i.test(l));
  add(G.idx, 'must', !blockAll, blockAll ? 'robots.txt: Disallow: / для User-agent: * — сайт закрыт от индексации' : 'robots.txt не закрывает сайт целиком', 'убрать Disallow: / (остаток от стейджинга?)');
  add(G.idx, 'should', robotSitemaps.length > 0, robotSitemaps.length ? `robots.txt → Sitemap: ${robotSitemaps.join(', ')}` : 'в robots.txt нет строки Sitemap:', `добавить Sitemap: ${origin}/sitemap.xml`);
  const badAbs = robotSitemaps.filter(s => !/^https?:\/\//.test(s));
  if (badAbs.length) add(G.idx, 'must', false, `Sitemap в robots.txt не абсолютный: ${badAbs.join(', ')}`, 'указать полный URL');
  const aiMentioned = AI_BOTS.filter(b => new RegExp(`^user-agent\\s*:\\s*${b}\\s*$`, 'im').test(robots.body));
  info(G.llm, aiMentioned.length ? `robots.txt явно упоминает AI-ботов: ${aiMentioned.join(', ')}` : 'robots.txt не упоминает AI-ботов (GPTBot, ClaudeBot…) — для них действует правило *');
}

// ---- noindex / canonical на главной ----
const metaRobots = (meta(html, 'robots') || '') + ' ' + (home.headers.get('x-robots-tag') || '');
add(G.idx, 'must', !/noindex/i.test(metaRobots), /noindex/i.test(metaRobots) ? `главная помечена noindex (${metaRobots.trim()})` : 'нет noindex на главной', 'убрать noindex из meta robots / X-Robots-Tag');
const canonical = links(html, 'canonical')[0]?.href;
add(G.idx, 'should', !!canonical && /^https?:\/\//.test(canonical), canonical ? `canonical: ${canonical}` : 'нет <link rel="canonical">', 'добавить абсолютный canonical на каждую страницу');
if (canonical && /^https?:/.test(canonical) && !sameHost(canonical)) add(G.idx, 'must', false, `canonical указывает на чужой хост: ${canonical}`, 'поправить site / canonical');

// ---- sitemap ----
const isSitemap = r => r.status === 200 && /<(urlset|sitemapindex)\b/.test(r.body);
let smUrl = null;
for (const s of robotSitemaps.filter(sameHost)) {
  const r = await get(s);
  if (isSitemap(r)) { smUrl ??= s; continue; }
  add(G.sm, 'must', false, `robots.txt указывает на ${s}, а он отдаёт ${r.status} / не sitemap`, 'поправить строку Sitemap: или генерацию');
}
const foreignSm = robotSitemaps.filter(s => /^https?:/.test(s) && !sameHost(s));
if (foreignSm.length) add(G.sm, 'must', false, `Sitemap в robots.txt на чужом хосте: ${foreignSm.join(', ')}`);
const directOk = isSitemap(await get(`${origin}/sitemap.xml`));
const existing = directOk ? [`${origin}/sitemap.xml`] : [];
for (const n of ['sitemap-index.xml', 'sitemap_index.xml']) if (isSitemap(await get(`${origin}/${n}`))) existing.push(`${origin}/${n}`);
if (!smUrl && existing.length) {
  smUrl = existing[0];
  if (robotsOk) add(G.sm, robotSitemaps.length ? 'must' : 'should', false, `реально sitemap лежит по ${existing.map(u => new URL(u).pathname).join(', ')} — robots.txt на него не ссылается`, `Sitemap: ${smUrl}`);
}
let pageUrls = [];
if (!smUrl) add(G.sm, 'must', false, 'sitemap не найден (ни по robots.txt, ни /sitemap.xml, /sitemap-index.xml)', 'сгенерировать /sitemap.xml');
else {
  const sm = await get(smUrl);
  const valid = sm.status === 200 && /<(urlset|sitemapindex)\b/.test(sm.body);
  add(G.sm, 'must', valid, valid ? `sitemap: ${smUrl}` : `sitemap ${smUrl} → ${sm.status}, не XML-sitemap`, 'починить генерацию sitemap');
  if (valid) {
    const locs = x => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => decode(m[1]));
    let lastmods = (sm.body.match(/<lastmod>/g) || []).length;
    if (/<sitemapindex\b/.test(sm.body)) {
      const children = locs(sm.body);
      info(G.sm, `это sitemap-index, дочерних: ${children.length}`);
      for (const c of children.slice(0, 10)) {
        const r = await get(c);
        if (r.status !== 200) add(G.sm, 'must', false, `дочерний sitemap ${c} → ${r.status}`);
        else { pageUrls.push(...locs(r.body)); lastmods += (r.body.match(/<url>[\s\S]*?<lastmod>/g) || []).length; }
      }
    } else pageUrls = locs(sm.body);
    add(G.sm, 'must', pageUrls.length > 0, `URL в sitemap: ${pageUrls.length}`);
    const rel = pageUrls.filter(u => !/^https?:\/\//.test(u));
    const foreign = pageUrls.filter(u => /^https?:\/\//.test(u) && !sameHost(u));
    add(G.sm, 'must', rel.length === 0 && foreign.length === 0,
      rel.length || foreign.length ? `в sitemap ${rel.length} относительных и ${foreign.length} чужих URL (напр. ${[...rel, ...foreign][0]})` : 'все URL абсолютные и на своём домене',
      'проверить site в astro.config');
    const httpUrls = pageUrls.filter(u => u.startsWith('http://'));
    if (isLive && home.url.startsWith('https:') && httpUrls.length) add(G.sm, 'must', false, `в sitemap ${httpUrls.length} URL с http://`, 'site должен быть https://');
    add(G.sm, 'nice', lastmods > 0, lastmods ? 'lastmod указан' : 'нет <lastmod>', 'добавить lastmod');
    // проверяем, что URL отдают 200 без редиректа
    const sample = pageUrls.slice(0, isLive ? 20 : 500);
    const bad = [];
    for (const u of sample) {
      const r = await get(u, { redirect: 'manual', method: isLive ? 'HEAD' : 'GET' });
      if (r.status !== 200) bad.push(`${u} → ${r.status}${r.headers.get('location') ? ' ' + r.headers.get('location') : ''}`);
    }
    add(G.sm, 'must', bad.length === 0, bad.length ? `из ${sample.length} URL sitemap не 200: ${bad.length}\n      ${bad.slice(0, 5).join('\n      ')}` : `проверено ${sample.length} URL из sitemap — все 200`, 'в sitemap только канонические URL без редиректов');
  }
}
// имя sitemap — пожелание унификации
if (smUrl) add(G.sm, 'nice', directOk && smUrl === `${origin}/sitemap.xml`,
  directOk && smUrl === `${origin}/sitemap.xml` ? 'sitemap называется /sitemap.xml'
    : directOk ? `/sitemap.xml есть, но основной — ${new URL(smUrl).pathname}` : `sitemap называется ${new URL(smUrl).pathname}, а не /sitemap.xml`,
  'унифицировать: единый /sitemap.xml (см. astro-fixes.md)');

// ---- 404 ----
const rnd = `/__website-check-${Date.now()}`;
const nf = await get(`${origin}${rnd}`, { redirect: 'manual' });
if (isLive) add(G.idx, 'should', nf.status === 404, `несуществующая страница → ${nf.status}${nf.status === 200 ? ' (soft 404)' : ''}`, 'сервер должен отдавать 404');
const page404 = await get(`${origin}/404`);
if (!isLive) add(G.idx, 'should', page404.status === 200, page404.status === 200 ? 'есть 404.html' : 'нет 404.html', 'создать src/pages/404.astro');

// ---- редиректы (live) ----
if (isLive) {
  const hops = async start => {
    let u = start, chain = [];
    for (let i = 0; i < 6; i++) {
      const r = await get(u, { redirect: 'manual', method: 'HEAD' });
      if (r.status === 0) return { chain, status: 0, error: r.error };
      if (![301, 302, 303, 307, 308].includes(r.status)) return { chain, final: u, status: r.status };
      const next = new URL(r.headers.get('location'), u).href; chain.push(`${r.status}→${next}`); u = next;
    }
    return { chain, final: u, status: 'loop' };
  };
  const bare = host.replace(/^www\./, '');
  const alt = host.startsWith('www.') ? bare : `www.${bare}`;
  const variants = [`http://${host}/`, `http://${alt}/`, `https://${alt}/`];
  for (const v of variants) {
    const r = await hops(v);
    if (r.status === 0) { info(G.tech, `${v} недоступен (${r.error})`); continue; }
    const good = r.final === `${origin}/` && r.status === 200;
    add(G.tech, 'should', good && r.chain.length <= 1, `${v} ${r.chain.length ? r.chain.join(' ') : '→ без редиректа'}${good && r.chain.length > 1 ? ' (цепочка)' : ''}`,
      'один 301 на канонический https-хост');
  }
  // trailing slash: вариант внутренней страницы
  const inner = pageUrls.find(u => new URL(u).pathname !== '/');
  if (inner) {
    const alt2 = inner.endsWith('/') ? inner.slice(0, -1) : inner + '/';
    const r = await get(alt2, { redirect: 'manual', method: 'HEAD' });
    const loc = r.headers.get('location') && new URL(r.headers.get('location'), alt2).href;
    const ok = ([301, 308].includes(r.status) && loc === inner) || r.status === 404;
    add(G.tech, 'should', ok, `${alt2} → ${r.status}${loc ? ' ' + loc : ''}${r.status === 200 ? ' (дубль страницы)' : ''}`, 'единый trailing slash: 301 на вариант из sitemap');
  }
  add(G.tech, 'must', home.url.startsWith('https://'), `итоговый URL главной: ${home.url}`);
  const hsts = home.headers.get('strict-transport-security');
  add(G.tech, 'should', !!hsts, hsts ? `HSTS: ${hsts}` : 'нет заголовка Strict-Transport-Security', 'add_header Strict-Transport-Security "max-age=31536000" always;');
  const enc = home.headers.get('content-encoding');
  add(G.tech, 'should', /br|gzip|zstd/.test(enc || ''), enc ? `сжатие: ${enc}` : 'HTML отдаётся без сжатия', 'gzip on / brotli в nginx');
}
const mixed = [...html.matchAll(/\b(?:src|href|srcset|content)\s*=\s*["']http:\/\/[^"']+/gi)]
  .map(m => m[0]).filter(s => !/^(href|content)/i.test(s) || /\.(js|css|png|jpe?g|webp|svg|gif|woff2?)/i.test(s));
add(G.tech, 'should', mixed.length === 0, mixed.length ? `http://-ресурсы на странице: ${mixed.slice(0, 3).join(', ')}` : 'нет http://-ресурсов (mixed content)');

// ---- мета на главной ----
const title = titleOf(html);
add(G.meta, 'must', !!title, title ? `title (${title.length}): ${title}` : 'нет <title>');
if (title) add(G.meta, 'should', title.length >= 10 && title.length <= 70, `длина title ${title.length} (норма 10–70)`);
const desc = decode(meta(html, 'description'));
add(G.meta, 'should', !!desc, desc ? `description (${desc.length}): ${desc.slice(0, 90)}${desc.length > 90 ? '…' : ''}` : 'нет meta description');
if (desc) add(G.meta, 'nice', desc.length >= 50 && desc.length <= 170, `длина description ${desc.length} (норма 50–170)`);
const lang = tags(html, 'html')[0]?.lang;
add(G.meta, 'must', !!lang, lang ? `<html lang="${lang}">` : 'нет <html lang>', 'Layout: <html lang="ru">');
add(G.meta, 'must', !!meta(html, 'viewport'), meta(html, 'viewport') ? 'viewport есть' : 'нет meta viewport');
add(G.meta, 'should', /<meta\s+charset=/i.test(html), /<meta\s+charset=/i.test(html) ? 'charset есть' : 'нет <meta charset>');
const h1 = (html.match(/<h1\b/gi) || []).length;
add(G.meta, 'should', h1 === 1, `h1 на главной: ${h1}`);

// ---- выборка страниц: уникальность title/description ----
const others = pageUrls.filter(u => sameHost(u) && new URL(u).pathname !== '/').slice(0, opt.pages);
if (others.length) {
  const seen = { title: new Map(), desc: new Map() };
  const note = (m, k, u) => k && m.set(k, [...(m.get(k) || []), u]);
  note(seen.title, title, '/'); note(seen.desc, desc, '/');
  const probs = [];
  for (const u of others) {
    const r = await get(u); const p = new URL(u).pathname;
    if (r.status !== 200) continue;
    const t = titleOf(r.body), d = decode(meta(r.body, 'description'));
    note(seen.title, t, p); note(seen.desc, d, p);
    if (!t) probs.push(`${p}: нет title`);
    if (!d) probs.push(`${p}: нет description`);
    if (!links(r.body, 'canonical')[0]) probs.push(`${p}: нет canonical`);
    if (!meta(r.body, 'og:image')) probs.push(`${p}: нет og:image`);
    if ((r.body.match(/<h1\b/gi) || []).length !== 1) probs.push(`${p}: h1 ≠ 1`);
  }
  add(G.meta, 'should', probs.length === 0, probs.length ? `проблемы на внутренних страницах:\n      ${probs.join('\n      ')}` : `${others.length} внутренних страниц: title/description/canonical/og:image/h1 на месте`);
  const dupT = [...seen.title].filter(([, v]) => v.length > 1), dupD = [...seen.desc].filter(([, v]) => v.length > 1);
  add(G.meta, 'should', !dupT.length && !dupD.length,
    dupT.length || dupD.length ? `дубли: ${[...dupT.map(([k, v]) => `title «${k.slice(0, 40)}» на ${v.join(', ')}`), ...dupD.map(([, v]) => `description на ${v.join(', ')}`)].join('; ')}` : 'title и description уникальны на проверенных страницах',
    'уникальные title/description для каждой страницы');
}

// ---- OG / Twitter ----
for (const k of ['og:title', 'og:description', 'og:url', 'og:type'])
  add(G.og, 'should', !!meta(html, k), meta(html, k) ? `${k}: ${decode(meta(html, k)).slice(0, 80)}` : `нет ${k}`);
const ogImg = meta(html, 'og:image');
if (!ogImg) add(G.og, 'must', false, 'нет og:image', 'сделать 1200×630 и прописать абсолютным URL');
else {
  const abs = /^https?:\/\//.test(ogImg);
  add(G.og, 'must', abs, abs ? `og:image: ${ogImg}` : `og:image не абсолютный: ${ogImg}`, 'использовать new URL(img, Astro.site)');
  const src = abs ? ogImg : new URL(ogImg, origin).href;
  const r = await get(src, { binary: true });
  const ok = r.status === 200 && r.body.length > 0;
  add(G.og, 'must', ok, ok ? `og:image скачивается (${Math.round(r.body.length / 1024)} KB)` : `og:image → ${r.status || r.error}`);
  if (ok) {
    add(G.og, 'should', r.body.length < 5 * 1024 * 1024, `вес og:image ${Math.round(r.body.length / 1024)} KB (лимит ~5 MB)`);
    const sz = imageSize(r.body);
    if (sz) add(G.og, 'nice', Math.abs(sz.w / sz.h - 1.91) < 0.06 && sz.w >= 1200, `og:image ${sz.w}×${sz.h} ${sz.type}${sz.w >= 1200 ? '' : ' (меньше 1200 по ширине)'}`, 'рекомендовано 1200×630');
    else info(G.og, 'формат og:image не распознан (svg/avif?) — соцсети часто не берут SVG');
  }
  add(G.og, 'nice', !!meta(html, 'og:image:width') && !!meta(html, 'og:image:height'), 'og:image:width/height', 'ускоряет первый рендер превью');
  add(G.og, 'nice', !!meta(html, 'og:image:alt'), 'og:image:alt');
}
const tw = meta(html, 'twitter:card');
add(G.og, 'should', !!tw, tw ? `twitter:card: ${tw}` : 'нет twitter:card', '<meta name="twitter:card" content="summary_large_image">');
add(G.og, 'nice', !!meta(html, 'og:site_name') && !!meta(html, 'og:locale'), 'og:site_name + og:locale');

// ---- иконки ----
const fav = await get(`${origin}/favicon.ico`, { binary: true });
add(G.ico, 'should', fav.status === 200 && fav.body.length > 0, `/favicon.ico → ${fav.status}`, 'положить favicon.ico (32×32) в public/ — Яндекс и старые клиенты берут его из корня');
const icons = links(html, 'icon');
add(G.ico, 'must', icons.length > 0, icons.length ? `<link rel="icon">: ${icons.map(i => i.href).join(', ')}` : 'нет <link rel="icon">');
for (const i of icons) {
  const r = await get(new URL(i.href, origin).href, { method: isLive ? 'HEAD' : 'GET' });
  if (r.status !== 200) add(G.ico, 'must', false, `иконка ${i.href} → ${r.status}`);
}
add(G.ico, 'nice', icons.some(i => /svg/.test(i.type || '') || /\.svg(\?|$)/.test(i.href)), 'SVG-иконка');
const ati = links(html, 'apple-touch-icon')[0];
if (ati) {
  const r = await get(new URL(ati.href, origin).href, { binary: true });
  const sz = imageSize(r.body);
  add(G.ico, 'should', r.status === 200, `apple-touch-icon ${ati.href} → ${r.status}${sz ? ` ${sz.w}×${sz.h}` : ''}`);
  if (sz) add(G.ico, 'nice', sz.w === 180 && sz.h === 180, `apple-touch-icon ${sz.w}×${sz.h} (нужно 180×180)`);
} else add(G.ico, 'should', false, 'нет apple-touch-icon', '180×180 PNG, <link rel="apple-touch-icon" href="/apple-touch-icon.png">');
const man = links(html, 'manifest')[0];
if (man) {
  const r = await get(new URL(man.href, origin).href);
  let j = null; try { j = JSON.parse(r.body); } catch {}
  const sizes = (j?.icons || []).map(i => i.sizes).join(' ');
  add(G.ico, 'nice', !!j && /192/.test(sizes) && /512/.test(sizes), j ? `manifest: name=${j.name || '—'}, icons: ${sizes || '—'}` : `manifest ${man.href} → ${r.status}, не JSON`, 'иконки 192 и 512 в manifest');
} else add(G.ico, 'nice', false, 'нет web manifest', 'site.webmanifest с иконками 192/512');
add(G.ico, 'nice', !!meta(html, 'theme-color'), meta(html, 'theme-color') ? `theme-color: ${meta(html, 'theme-color')}` : 'нет theme-color');

// ---- LLM ----
const llms = await get(`${origin}/llms.txt`);
const llmsOk = llms.status === 200 && !/<html/i.test(llms.body);
add(G.llm, 'should', llmsOk, llmsOk ? 'llms.txt есть' : `llms.txt → ${llms.status}`, 'создать public/llms.txt');
if (llmsOk) {
  add(G.llm, 'should', /^#\s+\S/.test(llms.body.trimStart()), /^#\s+\S/.test(llms.body.trimStart()) ? 'llms.txt начинается с # H1' : 'llms.txt должен начинаться с «# Название»');
  add(G.llm, 'nice', /^>\s+\S/m.test(llms.body), 'llms.txt: есть > краткое описание');
  if (isLive) { const ct = llms.headers.get('content-type') || ''; add(G.llm, 'nice', /text\/(plain|markdown)/.test(ct), `llms.txt content-type: ${ct || '—'}`); }
}
const llmsFull = await get(`${origin}/llms-full.txt`, { method: isLive ? 'HEAD' : 'GET' });
add(G.llm, 'nice', llmsFull.status === 200, `llms-full.txt → ${llmsFull.status}`);

// ---- JSON-LD ----
const ld = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
add(G.ld, 'should', ld.length > 0, ld.length ? `JSON-LD блоков: ${ld.length}` : 'нет JSON-LD', 'Organization + WebSite на главной');
const types = [];
ld.forEach((s, i) => {
  try {
    const j = JSON.parse(s);
    const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o['@type']) types.push([].concat(o['@type']).join('/')); walk(o['@graph']); } };
    walk(j);
  } catch (e) { add(G.ld, 'must', false, `JSON-LD #${i + 1} не парсится: ${e.message}`); }
});
if (types.length) info(G.ld, `типы: ${types.join(', ')}`);
if (ld.length) add(G.ld, 'nice', types.some(t => /Organization|LocalBusiness|Person/.test(t)) && types.includes('WebSite'), 'на главной есть Organization (или Person/LocalBusiness) и WebSite');

// ---- аналитика / верификация ----
const hasYM = /mc\.yandex\.(ru|com)\/(metrika|watch)|ym\(\s*\d+/.test(html);
const hasGA = /googletagmanager\.com\/(gtag|gtm)|gtag\(\s*['"]config/.test(html);
add(G.an, 'should', hasYM || hasGA, `счётчики: ${[hasYM && 'Яндекс.Метрика', hasGA && 'Google Analytics/GTM'].filter(Boolean).join(', ') || 'не найдено'}`, 'поставить Метрику (скилл yandex-metrika)');
const ver = [meta(html, 'yandex-verification') && 'yandex-verification', meta(html, 'google-site-verification') && 'google-site-verification'].filter(Boolean);
info(G.an, ver.length ? `meta-верификация: ${ver.join(', ')}` : 'meta-верификации нет (ок, если подтверждено через DNS)');

// ---------- output ----------
const fails = results.filter(r => !r.ok);
const count = l => fails.filter(r => r.level === l).length;
if (opt.json) {
  console.log(JSON.stringify({ target, mode: isLive ? 'live' : 'folder', origin, root, results }, null, 2));
} else {
  const icon = r => r.level === 'info' ? 'ℹ️ ' : r.ok ? '✅' : r.level === 'must' ? '❌' : r.level === 'should' ? '⚠️ ' : '💡';
  console.log(`website-check · ${isLive ? 'live' : 'folder ' + root} · ${origin}\n`);
  for (const g of Object.values(G)) {
    const rs = results.filter(r => r.group === g);
    if (!rs.length) continue;
    console.log(`## ${g}`);
    for (const r of rs) console.log(`  ${icon(r)} ${r.msg}${r.fix ? `  → ${r.fix}` : ''}`);
    console.log();
  }
  console.log(`Итого: ❌ must ${count('must')} · ⚠️ should ${count('should')} · 💡 nice ${count('nice')} · ✅ ${results.filter(r => r.ok && r.level !== 'info').length}`);
}
process.exit(count('must') ? 1 : 0);
