# 🚀 safe-fetch

> Легковесный, расширяемый и отказоустойчивый HTTP‑клиент на базе нативного Fetch с Onion-архитектурой middleware, встроенным SWR-кэшированием, дедупликацией, автоматическими повторами и RPC-батчингом.

[![npm version](https://shields.io)](https://npmjs.com)
[![License: MIT](https://shields.io)](https://opensource.org)

`safe-fetch` спроектирован как бескомпромиссная, безопасная и ультра-производительная альтернатива `axios` , `ky` и `ofetch` для сложных высоконагруженных SPA/SSR приложений. Вместо простых линейных хуков библиотека использует **Onion-архитектуру пайплайнов (как в Koa.js)**, позволяя полностью контролировать жизненный цикл запроса в рамках одного middleware.

## ✨ Ключевые особенности

* 🛡️ **Onion Middleware**: Мощная сквозная обработка `await next()` вместо жестких раздельных интерцепторов.
* 🧠 **Умный SWR-кэш**: Кэширование в памяти со стратегией *Stale-While-Revalidate* и гибкой инвалидацией по регулярным выражениям или тегам.
* 👯 **Авто-дедупликация**: Схлопывание параллельных идентичных `GET/HEAD`‑запросов в один сетевой поток.
* 📦 **RPC-Батчинг**: Автоматическое склеивание множества независимых `POST`‑запросов в один пакет для разгрузки сети.
* ⏳ **Контроль конкурентности (Concurrency)**: Ограничение пула одновременных сетевых соединений по ключам.
* 🔄 **Умные ретраи (Retry)**: Автоповторы при сбоях сети или 5xx ошибках с экспоненциальной задержкой, джиттером и аппаратной защитой от повторов при ручной отмене.
* 🛑 **Надежный Abort**: Мгновенное прерывание пайплайна через `ctx.cancel()` или нативный `AbortSignal` без утечек памяти.
* 📊 **Телеметрия и Хуки**: Сквозной мониторинг таймингов, событий кэша и ошибок из коробки.
* 🗺️ **Генерация REST‑клиента**: Рекурсивный типобезопасный `Proxy`-клиент с поддержкой бесконечной вложенности роутов.
* 🪶 **Строгая типизация**: Полная совместимость со строгим режимом TypeScript (`exactOptionalPropertyTypes: true`).

---

## 📦 Установка

```bash
npm install @jennamite/safe-fetch
# или
yarn add @jennamite/safe-fetch
# или
pnpm add @jennamite/safe-fetch
```

### Использование в Node.js (SSR / Next.js / Nuxt)

Библиотека использует нативный глобальный `fetch` . Если вы используете старые версии Node.js, где `fetch` отсутствует, прокиньте полифилл в дефолтные настройки:

```typescript
import fetch from 'node-fetch';
import { createSafeFetch } from '@jennamite/safe-fetch';

const api = createSafeFetch({ fetch: fetch as any });
```

---

## 🚀 Быстрый старт

```typescript
import safeFetch from '@jennamite/safe-fetch';

// Базовый GET (автоматический парсинг JSON)
const users = await safeFetch('/api/users');

// POST-запрос с автоматической сериализацией и Content-Type
const newUser = await safeFetch.post('/api/users', { name: 'John Doe' });

// Другие HTTP-методы
await safeFetch.put('/api/users/1', { name: 'Jane' });
await safeFetch.patch('/api/users/1', { age: 30 });
await safeFetch.del('/api/users/1');

// Получение сырого инстанса ответа Response
const response = await safeFetch.raw('/api/file.pdf');
```

## ⚙️ Настройка кастомного клиента

Вы можете инициализировать изолированные клиенты со своими базовыми параметрами:

```typescript
import { createSafeFetch } from '@jennamite/safe-fetch';

const api = createSafeFetch({
  baseUrl: 'https://example.com',
  timeout: 5000,
  retry: 3,
  retryDelay: (attempt) => attempt * 1000, // Линейная задержка
  headers: { 
    'X-API-Key': 'secret_token' 
  }
});
```

---

## 📚 Продвинутые возможности

### 🧠 SWR-Кэширование и Инвалидация

Стратегия `stale-while-revalidate` мгновенно возвращает устаревшие данные из памяти (если они есть) и прозрачно обновляет их на сервере в фоне.

```typescript
// Запрос кэшируется в памяти на 1 минуту
const data = await api('/dashboard/stats', {
  cache: 'memory',
  cacheTTL: 60000,
  staleWhileRevalidate: true,
  tags: ['analytics', 'charts']
});

// Гибкие методы инвалидации:
api.invalidate({ tags: ['analytics'] });       // По тегу
api.invalidate(/\/dashboard\/.*/);             // По регулярному выражению URL
api.invalidate('stats');                       // По подстроке в URL
api.invalidate();                              // Полный сброс кэша
```

### 👯 Автоматическая дедупликация

Включена по умолчанию для всех безопасных ( `GET/HEAD` ) методов. Предотвращает дублирование сетевых запросов, если они инициированы одновременно (например, при рендере нескольких независимых виджетов на одном экране).

```typescript
// Будет выполнен только ОДИН реальный сетевой запрос. Оба промиса получат общий результат.
const [widgets, sidebar] = await Promise.all([
  api('/api/config'),
  api('/api/config')
]);
```

### 📦 RPC-Батчинг запросов

Позволяет склеивать независимые параллельные `POST` -запросы, отправленные в одном тике Event Loop, в один составной пакет для снижения нагрузки на сервер.

```typescript
// Сервер получит один POST-запрос с телом { batch: [{ url: '...', body: { id: 1 } }, ...] }
// и должен вернуть массив результатов в аналогичном порядке.
const [res1, res2] = await Promise.all([
  api('/api/rpc', { method: 'POST', body: { id: 1 }, batch: true }),
  api('/api/rpc', { method: 'POST', body: { id: 2 }, batch: true })
]);
```

### 🛡️ Умные автоповторы (Retry)

Автоповторы срабатывают исключительно при ошибках сети или серверных сбоях (5xx). Они снабжены экспоненциальной задержкой, джиттером (рандомизацией для предотвращения DDoS своего сервера) и **аппаратным глушением**, если запрос отменяется пользователем.

```typescript
await api('/unstable-endpoint', {
  retry: 3,
  retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 15000), // Экспоненциальный бэкофф
});
```

---

## 🧅 Архитектура Middleware (Onion Pattern)

Пайплайн построен по принципу матрешки (как в Koa.js). Вызов `await next()` передает управление нижестоящим слоям, после чего код возвращается обратно вверх по стеку.

```typescript
// Слой сквозного логирования времени выполнения и ошибок
api.use(async (ctx, next) => {
  const start = Date.now();
  console.log(`→ Направлен запрос: ${ctx.options.method} ${ctx.url}`);
  
  try {
    await next(); // Уходим глубже в конвейер
    console.log(`← Успешный ответ за ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`💥 Ошибка конвейера за ${Date.now() - start}ms: ${err.message}`);
    throw err;
  }
});

// Слой динамической инъекции токенов авторизации (prepend добавляет в начало очереди)
api.prepend(async (ctx, next) => {
  const headers = new Headers(ctx.options.headers);
  headers.set('Authorization', `Bearer ${authService.getAccessToken()}`);
  ctx.options.headers = headers;
  
  await next();
});
```

---

## 🪝 Хуки и Телеметрия

Для простых операций подписки на события предусмотрены хуки и изолированный слой телеметрии, не влияющие на ход выполнения пайплайна.

```typescript
// Регистрация хуков жизненного цикла
api.onRequest((ctx) => console.log('Инициализирован запрос:', ctx.url));
api.onResponse((ctx) => console.log('Получен HTTP Статус:', ctx.response?.status));
api.onError((ctx, error) => console.error('Зафиксирована ошибка:', error.message));

// Подписка на глобальную системную телеметрию инстанса
api.onTelemetry((event) => {
  if (event.type === 'response') {
    console.log(`[Telemetry] Метрика ${event.ctx.url} заняла ${event.duration}ms`);
  }
});
```

---

## 🛑 Отмена запросов и Обработка ошибок

Отменить запрос можно как с помощью нативного `AbortSignal` , так и через внутренний метод контекста `ctx.cancel()` . Ошибки гарантированно приводятся к классу `SafeFetchError` , сохраняя при этом вложенную JSON-структуру ответа сервера.

```typescript
// 1. Ручная отмена внутри хука или middleware
api.onRequest((ctx) => {
  if (isBlacklisted(ctx.url)) {
    ctx.cancel('Доступ к эндпоинту заблокирован безопасностью');
  }
});

// 2. Использование нативного AbortController
const controller = new AbortController();
const promise = api('/heavy-reporting', { signal: controller.signal });

setTimeout(() => controller.abort(), 500);

try {
  await promise;
} catch (err) {
  if (err instanceof SafeFetchError) {
    console.log('HTTP Статус:', err.status);         // e.g. 400
    console.log('Это отмена запроса?:', err.isAbort); // true
    console.log('Ошибка ретраится?:', err.isRetryable); // false
    console.log('Тело JSON ошибки:', err.body);        // Распарсенный объект ошибки от сервера
  }
}
```

---

## 🗺️ Рекурсивный REST‑клиент ( `createClient` )

Утилита генерирует динамический `Proxy` -клиент, поддерживающий **бесконечную вложенность эндпоинтов**. Он полностью совместим с `async/await` и корректно изолирован от служебных вызовов JavaScript.

```typescript
import { createClient } from '@jennamite/safe-fetch';

interface MyApiSchema {
  api: {
    v1: {
      users: {
        get: (path?: string) => Promise<User[]>;
        profile: {
          get: () => Promise<UserProfile>;
          patch: (data: Partial<UserProfile>) => Promise<UserProfile>;
        }
      }
    }
  }
}

const client = createClient<MyApiSchema>(safeFetch, 'https://api.example.com');

// Автоматически соберет URL: https://example.com
const allUsers = await client.api.v1.users.get();

// Автоматически соберет URL: https://example.com/profile
const profile = await client.api.v1.users.profile.get();
```

---

## 🛠️ API

* **`createSafeFetch(defaultOptions?)`** – Создаёт новый изолированный экземпляр `safeFetch` с глобальными настройками по умолчанию.
* **`safeFetch(url, options?)`** – Основной callable-экземпляр по умолчанию. Выполняет запрос, возвращает `Promise<T>` (или `Promise<FetchResult<T>>` при выставленном флаге `returnMeta: true`).
* **`api.use(...middlewares)`** / **`api.prepend(...middlewares)`** – Регистрация пользовательских слоев в Onion-конвейер.
* **`api.invalidate(patternOrOptions)`** – Ручной сброс SWR-кэша по тегам, строке или регулярному выражению.
* **`api.revalidate(pattern, options)`** – Принудительный фоновый перезапрос и обновление данных в кэше.

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
* Для работы кэша и дедупликации по умолчанию учитываются заголовки `authorization`,      `accept-language`,      `x-api-key`. Это можно изменить глобально через `includeHeaders` при создании экземпляра.
* `staleWhileRevalidate` при включённом `cache: 'memory'` возвращает устаревшие данные и одновременно обновляет кэш в фоне.
* Батчинг требует, чтобы сервер умел обрабатывать составные запросы и возвращал массив результатов в том же порядке, что и исходные запросы.

## 📄 Лицензия

MIT © [Jenamite]
