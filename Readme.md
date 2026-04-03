# 🚀 safe-fetch

> Type‑safe, расширяемый HTTP‑клиент с кэшированием, батчингом, повторными попытками и middleware.

[![npm version](https://img.shields.io/npm/v/safe-fetch.svg)](https://www.npmjs.com/package/safe-fetch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`safe-fetch` — Меня достали взломы, я сделал альтернативу для своих нужд. Дальше посмотрим.
 Это альтернатива `axios` , `ky` и `ofetch` . Он предлагает встроенные механизмы для оптимизации запросов и полностью типизирован на typescript.

## ✨ Особенности

* **Кэширование в памяти** с тегами и `stale-while-revalidate`
* **Дедупликация** одновременных одинаковых запросов (GET/HEAD)
* **Повторные попытки** (retry) с экспоненциальной задержкой
* **Батчинг** POST‑запросов для уменьшения числа обращений к серверу
* **Middleware** для перехвата и модификации запросов/ответов
* **Хуки** (onRequest, onResponse, onError)
* **Телеметрия** для мониторинга запросов
* **Отмена запросов** через `AbortSignal` или встроенный `cancel()`
* **Прогресс загрузки** (upload/download) через XHR
* **Генерация REST‑клиента** (`createClient`)
* **Плагины** для расширения функциональности
* Полная поддержка **```typescript** со строгой типизацией

## 📦 Установка

```bash
npm install safe-fetch
# или
yarn add safe-fetch
# или
pnpm add safe-fetch
```

## Node.js

В Node.js нет глобального fetch, поэтому передайте собственную реализацию (например, node-fetch):

```bash
npm install node-fetch
```

```typescript
import fetch from 'node-fetch';
import { createSafeFetch } from 'safe-fetch';

const api = createSafeFetch({ fetch });
```

## 🚀 Быстрый старт

```typescript
import safeFetch from 'safe-fetch';

// GET
const users = await safeFetch('/api/users');

// POST с JSON
const newUser = await safeFetch.post('/api/users', { name: 'John' });

// PUT, PATCH, DELETE
await safeFetch.put('/api/users/1', { name: 'Jane' });
await safeFetch.patch('/api/users/1', { age: 30 });
await safeFetch.del('/api/users/1');

// Сырой Response
const res = await safeFetch.raw('/api/file.pdf');
```

## ⚙️ Настройка экземпляра

Создайте собственный экземпляр с глобальными параметрами:

```typescript
import { createSafeFetch } from 'safe-fetch';

const api = createSafeFetch({
  baseUrl: 'https://api.example.com',
  timeout: 5000,
  retry: 2,
  retryDelay: (attempt) => 1000 * attempt,
  headers: { 'X-API-Key': 'secret' }
});
```

## 📚 Основные возможности

Кэширование

```typescript
// GET с кэшированием на 1 минуту
const data = await api('/slow-data', {
  cache: 'memory',
  cacheTTL: 60000,
  tags: ['dashboard']
});

// Инвалидация по тегам
api.invalidate({ tags: ['dashboard'] });
// или по паттерну URL
api.invalidate(/dashboard/);
// полная очистка кэша
api.invalidate();
```

## Повторные попытки
```typescript
await api('/unstable', {
  retry: 3,
  retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000),
  retryOn: (error) => error.status === 429 || error.status >= 500
});
```

## Дедупликация (включена по умолчанию)

```typescript
// Оба вызова получат результат одного запроса
const [a, b] = await Promise.all([
  api('/users'),
  api('/users')
]);
```

## Батчинг POST‑запросов

```typescript
const [r1, r2] = await Promise.all([
  api('/api/action', { method: 'POST', body: { id: 1 }, batch: true }),
  api('/api/action', { method: 'POST', body: { id: 2 }, batch: true })
]);
```

// Сервер должен вернуть массив результатов в том же порядке

## Middleware

```typescript
// Логирование всех запросов
api.use(async (ctx, next) => {
  console.log(`→ ${ctx.options.method} ${ctx.url}`);
  const start = Date.now();
  await next();
  console.log(`← ${ctx.options.method} ${ctx.url} - ${Date.now() - start}ms`);
});

// Добавление заголовка авторизации
api.prepend(async (ctx, next) => {
  ctx.options.headers = {
    ...ctx.options.headers,
    Authorization: `Bearer ${getToken()}`
  };
  await next();
});
```

## Хуки

```typescript
api.onRequest((ctx) => {
  console.log('Request started', ctx.url);
});

api.onResponse((ctx) => {
  console.log('Response status', ctx.response?.status);
});

api.onError((ctx, error) => {
  console.error('Request failed', error.message);
});
```

## Отмена запроса

```typescript
let cancel: () => void;
api.onRequest((ctx) => { cancel = ctx.cancel; });

const promise = api('/long-operation');
setTimeout(() => cancel('User cancelled'), 100);

try {
  await promise;
} catch (err) {
  if (err.isAbort) console.log('Request was cancelled');
}
```

## Прогресс загрузки (только браузер)

```typescript
await api('/upload', {
  method: 'POST',
  body: file,
  onUploadProgress: (p) => console.log(`Upload: ${p * 100}%`),
  onDownloadProgress: (p) => console.log(`Download: ${p * 100}%`)
});
```

## Генерация REST‑клиента

```typescript
import { createClient } from 'safe-fetch';

const client = createClient<{
  users: {
    get: (id?: string) => Promise<User>;
    post: (data: User) => Promise<User>;
  };
  posts: {
    get: (id?: string) => Promise<Post>;
  };
}>('https://api.example.com');

const user = await client.users.get('123');
const newPost = await client.posts.post({ title: 'Hello' });
```

## Плагины

```typescript
const loggerPlugin = {
  name: 'logger',
  setup(instance) {
    instance.use(async (ctx, next) => {
      console.log(`${ctx.options.method} ${ctx.url}`);
      await next();
    });
  }
};

api.plugin(loggerPlugin);
```

## Телеметрия

```typescript
api.onTelemetry((event) => {
  if (event.type === 'response') {
    console.log(`Request ${event.ctx.url} took ${event.duration}ms`);
  } else if (event.type === 'error') {
    console.error(`Error in ${event.duration}ms`, event.error);
  }
});
```

## 🛠️ API

* **`createSafeFetch(defaultOptions?)`** – создаёт новый экземпляр `safeFetch` с глобальными настройками.
  
* **`safeFetch(url, options?)`** – выполняет запрос, возвращает `Promise<T>` или `Promise<FetchResult<T>>` (при `returnMeta: true`).

## 📖 Основные опции

| Поле | Тип | По умолчанию | Описание |
|------|-----|--------------|----------|
| `method` | `string` | `'GET'` | HTTP-метод |
| `baseUrl` | `string` | – | Базовый URL (будет объединён с путём запроса) |
| `query` | `object` | – | Параметры строки запроса (добавляются к URL) |
| `timeout` | `number` | `10000` | Таймаут запроса в миллисекундах |
| `retry` | `number` | `2` | Количество повторных попыток при ошибке |
| `retryDelay` | `number \| (attempt) => number` | экспоненциальная | Задержка между попытками (мс или функция) |
| `cache` | `'memory' \| 'no-cache'` | `'no-cache'` | Режим кэширования ( `memory` – в памяти) |
| `cacheTTL` | `number` | `300000` | Время жизни кэша в миллисекундах (5 минут) |
| `staleWhileRevalidate` | `boolean` | `false` | Отдавать устаревший кэш и обновлять в фоне |
| `tags` | `string[]` | – | Теги для инвалидации кэша |
| `dedupe` | `boolean` | `true` | Дедупликация одинаковых GET/HEAD‑запросов |
| `batch` | `boolean` | `false` | Объединять несколько POST‑запросов в один |
| `parse` | `'auto' \| 'json' \| 'text' \| 'blob' \| 'arrayBuffer'` | `'auto'` | Способ парсинга тела ответа |
| `validateStatus` | `(status) => boolean` | `status >= 200 && status < 300` | Функция для проверки успешности ответа |
| `onUploadProgress` | `(progress) => void` | – | Прогресс загрузки (работает только в браузере через XHR) |
| `onDownloadProgress` | `(progress) => void` | – | Прогресс скачивания (только XHR) |
| `returnMeta` | `boolean` | `false` | Если `true` , возвращает объект с мета-информацией (статус, заголовки и т.д.) |

### Примечания

* При использовании `onUploadProgress` или `onDownloadProgress` запрос автоматически выполняется через `XMLHttpRequest` вместо `fetch`.
* Для работы кэша и дедупликации по умолчанию учитываются заголовки `authorization`,   `accept-language`,   `x-api-key`. Это можно изменить глобально через `includeHeaders` при создании экземпляра.
* `staleWhileRevalidate` при включённом `cache: 'memory'` возвращает устаревшие данные и одновременно обновляет кэш в фоне.
* Батчинг требует, чтобы сервер умел обрабатывать составные запросы и возвращал массив результатов в том же порядке, что и исходные запросы.

## 📄 Лицензия

MIT © [Jenamite]
