# Рецепты исправлений (Astro)

Применять только по просьбе пользователя. После правок: `npm run build` → повторный `check.mjs` по папке.
Сначала посмотри, как это уже сделано в проекте (BaseLayout, `src/config/site.*`), и встраивайся в существующий стиль, а не добавляй параллельный.

## robots.txt

Один источник: либо `public/robots.txt`, либо `src/pages/robots.txt.ts`, не оба. Endpoint лучше: домен берётся из `site`.

```ts
// src/pages/robots.txt.ts
import type { APIRoute } from 'astro';
export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', site).href}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
```

## Единый /sitemap.xml

`@astrojs/sitemap` всегда пишет `sitemap-index.xml` + `sitemap-0.xml` (`filenameBase` меняет только префикс). Переименовываем после сборки — автообход страниц сохраняется. Проверено на Astro 5 + @astrojs/sitemap 3.7.

```js
// astro.config.mjs
import { rename, rm, access } from 'node:fs/promises';

// @astrojs/sitemap всегда пишет sitemap-index.xml + sitemap-0.xml; переименовываем в единый /sitemap.xml.
const sitemapXml = () => ({
  name: 'sitemap-xml',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      const has = (f) => access(new URL(f, dir)).then(() => true, () => false);
      if (await has('sitemap-1.xml')) return; // >45k URL — оставляем index
      await rename(new URL('sitemap-0.xml', dir), new URL('sitemap.xml', dir));
      await rm(new URL('sitemap-index.xml', dir));
    },
  },
});

export default defineConfig({
  site: 'https://example.com',            // обязателен, иначе URL в sitemap/canonical ломаются
  integrations: [sitemap(), sitemapXml()], // порядок важен: sitemapXml после sitemap
});
```

Затем: строка `Sitemap:` в robots → `/sitemap.xml`. Если сайт уже в GSC/Вебмастере со старым `sitemap-index.xml` — переотправить новый (скиллы `google-search-console`, `yandex-webmaster`).

`lastmod`: только если есть реальные даты (например `updated` в content collections) — через `serialize(item)` в `sitemap({...})`. Дата сборки на всех страницах бесполезна.

## Мета в `<head>` (BaseLayout)

```astro
---
const { title, description, image = '/og-image.jpg', type = 'website' } = Astro.props;
const canonical = new URL(Astro.url.pathname, Astro.site).href;
const ogImage = new URL(image, Astro.site).href; // og:image только абсолютный
---
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonical} />

  <meta property="og:type" content={type} />
  <meta property="og:site_name" content="Brand" />
  <meta property="og:locale" content="ru_RU" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={title} />
  <meta name="twitter:card" content="summary_large_image" />

  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content="#ffffff" />
</head>
```

Title/description — уникальные на каждой странице, передаются пропсами, не дефолтом из layout.

## Иконки

Набор в `public/`: `favicon.ico` (32×32), `favicon.svg`, `apple-touch-icon.png` (180×180, без прозрачности), `icon-192.png`, `icon-512.png`, `site.webmanifest`.
Из SVG-исходника (ImageMagick):

```bash
magick -background none favicon.svg -resize 32x32 favicon.ico
magick -background white favicon.svg -resize 180x180 -flatten apple-touch-icon.png
magick -background none favicon.svg -resize 192x192 icon-192.png
magick -background none favicon.svg -resize 512x512 icon-512.png
```

```json
{ "name": "Brand", "short_name": "Brand", "icons": [
  { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
], "theme_color": "#ffffff", "background_color": "#ffffff", "display": "standalone" }
```

## og:image

1200×630, JPG/PNG (не SVG, не AVIF), < 1 MB желательно. Сгенерировать — скилл `generate`. Посмотри картинку глазами (Read), прежде чем считать проверку пройденной.

## llms.txt

Формат llmstxt.org: `# Название` → `> одна-две фразы о сайте` → абзац фактов → `## Раздел` со списком `- [Страница](абсолютный URL): что там`.
Статичный `public/llms.txt` для одностраничника; `src/pages/llms.txt.ts` с `getCollection`, если страниц много. Content-Type: `text/plain; charset=utf-8`.

## JSON-LD на главной

```astro
<script type="application/ld+json" set:html={JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': `${Astro.site}#org`, name: 'Brand', url: Astro.site, logo: new URL('/icon-512.png', Astro.site).href },
    { '@type': 'WebSite', '@id': `${Astro.site}#website`, url: Astro.site, name: 'Brand', publisher: { '@id': `${Astro.site}#org` } },
  ],
})} />
```

## 404

`src/pages/404.astro` → `dist/404.html`. На nginx: `error_page 404 /404.html;` — иначе soft 404 или голая страница nginx.

## Trailing slash

`trailingSlash: 'always'` (+ `build.format: 'directory'`) или `'never'` в astro.config — и nginx должен 301-ить второй вариант на первый. URL в sitemap должны совпадать с выбранным вариантом.

## Сервер (nginx): редиректы, HSTS, сжатие

Правится на VPS — через скилл `vps-admin`, не вслепую.

```nginx
server { listen 80; listen [::]:80; server_name example.com www.example.com; return 301 https://example.com$request_uri; }
server { listen 443 ssl; server_name www.example.com; ssl_certificate ...; return 301 https://example.com$request_uri; }
# в основном server-блоке:
add_header Strict-Transport-Security "max-age=31536000" always;
gzip on; gzip_types text/plain text/css application/javascript application/json image/svg+xml application/xml;
```
