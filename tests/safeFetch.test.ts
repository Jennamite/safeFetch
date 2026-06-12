import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSafeFetch, SafeFetchError } from '../src/index';
import type { Mock } from 'vitest';

describe('safeFetch', () => {
  let originalFetch: typeof fetch;
  let mockFetch: Mock;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetAllMocks();
  });

  const sf = createSafeFetch({ baseUrl: 'https://api.example.com' });

  it('GET запрос возвращает данные', async () => {

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const result = await sf('/users/1');
    // Или
    // mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    // const result = await sf('/users/1', { parse: 'json' });
    expect(result).toEqual({ id: 1 });
    expect(mockFetch).toHaveBeenCalled();
    const callArg = mockFetch.mock.calls[0]?.[0];
    // Если передан Request, берём его url, иначе считаем, что строка
    const actualUrl = callArg instanceof Request ? callArg.url : callArg;
    expect(actualUrl).toBe('https://api.example.com/users/1');
  });

  it('POST с JSON телом', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ created: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await sf.post('/users', { name: 'John' });
    expect(result).toEqual({ created: true });
    const call = mockFetch.mock.calls[0];
    expect(call?.[1]?.body).toBe(JSON.stringify({ name: 'John' }));
    expect(call?.[1]?.headers?.get('Content-Type')).toBe('application/json');
  });

  it('Ошибка при статусе 404', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    );

    const promise = sf('/missing');

    await expect(promise).rejects.toThrow(SafeFetchError);
    await expect(promise).rejects.toMatchObject({ status: 404 });
  });

  it('Параметры query добавляются в URL', async () => {
    mockFetch.mockResolvedValueOnce(new Response('[]', { status: 200 }));

    await sf('/search', { query: { q: 'test', page: 1 } });
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/search?q=test&page=1', expect.any(Object));
  });

  it('Таймаут прерывает запрос', async () => {
    vi.useFakeTimers();

    let rejectFetch: ((reason?: any) => void) | undefined;
    const fetchPromise = new Promise<Response>((_, reject) => {
      rejectFetch = reject;
    });

    mockFetch.mockImplementationOnce((_, init) => {
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        signal.addEventListener('abort', () => {
          rejectFetch?.(new DOMException('Aborted', 'AbortError'));
        });
      }
      return fetchPromise;
    });

    const promise = sf('/slow', { timeout: 50 });
    // Продвигаем время на 60 мс (больше таймаута)
    vi.advanceTimersByTime(60);

    await expect(promise).rejects.toThrow(SafeFetchError);
    await expect(promise).rejects.toMatchObject({ isAbort: true });

    vi.useRealTimers();
  });

  it('Повторные попытки (retry) при ошибке сервера', async () => {
    console.log('🧪 test: starting');
    mockFetch
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    try {
      const result = await sf('/unstable', { retry: 2, retryDelay: 0 });
      console.log('🧪 result:', result);
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    } catch (err) {
      console.error('🧪 test caught error:', err);
      throw err;
    }
  });
  it('Дедупликация одинаковых GET запросов', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 20));
      return new Response(JSON.stringify({ data: callCount }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const [res1, res2] = await Promise.all([sf('/dup'), sf('/dup')]);
    expect(res1).toEqual({ data: 1 });
    expect(res2).toEqual({ data: 1 });
    expect(callCount).toBe(1);
  });

  it('Кэширование (memory cache)', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ value: callCount }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' } // ✅ добавить заголовок
      });
    });

    const first = await sf('/cached', { cache: 'memory', cacheTTL: 1000 });
    const second = await sf('/cached', { cache: 'memory' });
    expect(first).toEqual({ value: 1 });
    expect(second).toEqual({ value: 1 });
    expect(callCount).toBe(1);
  });

  it('Инвалидация кэша по тегу', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      return new Response(JSON.stringify({ v: callCount }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    // ✅ Добавляем baseUrl, чтобы относительные пути корректно резолвились
    const sf2 = createSafeFetch({ baseUrl: 'https://api.example.com', cache: 'memory' });

    await sf2('/data', { tags: ['user'] });
    await sf2('/data'); // из кэша
    sf2.invalidate(() => true, { tags: ['user'] }); // инвалидируем по тегу
    await sf2('/data'); // новый запрос

    expect(callCount).toBe(2);
  });

  // // TODO не работает
  // it('Отмена запроса через cancel (реальный)', async () => {
  //   const sf3 = createSafeFetch({ fetch }); // передаём node-fetch
  //   let cancelFn: (reason?: string) => void = () => { };
  //   sf3.onRequest((ctx) => { cancelFn = ctx.cancel; });
  //   const promise = sf3('https://httpbin.org/delay/1');
  //   setTimeout(() => cancelFn('User cancelled'), 50);
  //   await expect(promise).rejects.toThrow(SafeFetchError);
  //   await expect(promise).rejects.toMatchObject({ isAbort: true });
  // }, 10000);


  it('Middleware может изменять контекст', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const sf4 = createSafeFetch({ baseUrl: 'https://api.example.com' });
    sf4.prepend(async (ctx, next) => {
      ctx.options.headers = { ...ctx.options.headers, 'X-Test': 'foo' };
      await next();
    });
    await sf4('/test');
    const call = mockFetch.mock.calls[0];
    expect(call?.[1]?.headers?.get('X-Test')).toBe('foo');
  });

  it('createClient генерирует правильные пути', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const api = sf.createClient<{ users: { get: (id: string) => Promise<any> } }>('https://api.com');
    await api.users.get('123');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.com/users/123'),
      expect.any(Object)
    );
  });

  it('Батчинг (batch) объединяет несколько POST', async () => {
    mockFetch.mockImplementation(async (url, init) => {
      const body = JSON.parse(init?.body as string);
      if (url === 'https://api.example.com/batch') {
        const results = body.batch.map((_: any, i: number) => ({ id: i }));
        // ✅ обязательно используем JSON.stringify
        const responseBody = JSON.stringify({ data: results });
        console.log('🔍 response body:', responseBody);
        return new Response(responseBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    // ✅ Создаём экземпляр БЕЗ baseUrl, используем полные URL в запросах
    const sf5 = createSafeFetch();
    const [r1, r2] = await Promise.all([
      sf5('https://api.example.com/batch', { method: 'POST', body: { a: 1 } as any, batch: true }),
      sf5('https://api.example.com/batch', { method: 'POST', body: { b: 2 } as any, batch: true }),
    ]);
    expect(r1).toEqual({ id: 0 });
    expect(r2).toEqual({ id: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });


  // ==========================================
  // 🔥 ДОПОЛНИТЕЛЬНЫЕ ТЕСТЫ БАЗОВОГО ФУНКЦИОНАЛА
  // ==========================================

  describe('Базовый функционал и Оптимизация ядра', () => {

    it('Должен возвращать метаданные при returnMeta = true', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' }
      }));

      const result: any = await sf('/posts/1', { returnMeta: true });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('status', 200);
      expect(result).toHaveProperty('statusText', 'OK');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('requestId');
      expect(result.data).toHaveProperty('id', 1);
    });

    it('Должен успешно дедуплицировать параллельные GET-запросы', async () => {
      sf.invalidate();

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));

      const [res1, res2, res3] = await Promise.all([
        sf('/posts/2'),
        sf('/posts/2'),
        sf('/posts/2')
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(res1).toHaveProperty('id', 2);
      expect(res1).toEqual(res2);
      expect(res2).toEqual(res3);
    });

    it('Должен корректно кэшировать запросы в памяти и инвалидировать их', async () => {
      sf.invalidate();

      mockFetch.mockImplementation(() => {
        return Promise.resolve(new Response(JSON.stringify({ id: 3 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      });

      const first = await sf('/posts/3', { cache: 'memory', cacheTTL: 5000, tags: ['test-tag'] });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const second = await sf('/posts/3', { cache: 'memory' });
      expect(first).toEqual(second);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      sf.invalidate({ tags: ['test-tag'] });

      await sf('/posts/3', { cache: 'memory' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('Рекурсивный REST-клиент должен поддерживать глубокую вложенность эндпоинтов', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 4 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));

      interface TargetSchema {
        posts: {
          get: (path?: string) => Promise<any>;
        }
      }

      const client = sf.createClient<TargetSchema>();

      const post = await client.posts.get('4');
      expect(post).toHaveProperty('id', 4);

      // 🔥 ИСПРАВЛЕНИЕ: Заменили 'https://example.com' на реальный ожидаемый URL 'https://api.example.com/posts/4'
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/posts/4', expect.any(Object));
    });

    it('Должен пропускать запросы через цепочку кастомных Onion-middleware', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));

      const trackingApi = createSafeFetch({ baseUrl: 'https://api.example.com' });
      const executionOrder: string[] = [];

      trackingApi.use(async (ctx, next) => {
        executionOrder.push('mw1-before');
        await next();
        executionOrder.push('mw1-after');
      });

      trackingApi.prepend(async (ctx, next) => {
        executionOrder.push('mw2-before');
        await next();
        executionOrder.push('mw2-after');
      });

      await trackingApi('/posts/5');

      expect(executionOrder).toEqual([
        'mw2-before',
        'mw1-before',
        'mw1-after',
        'mw2-after'
      ]);
    });

    it('Должен корректно отрабатывать хуки onRequest, onResponse и onError', async () => {
      const hookApi = createSafeFetch({ baseUrl: 'https://example.com' });
      let requestTriggered = false;
      let responseTriggered = false;
      let errorTriggered = false;

      hookApi.onRequest(() => { requestTriggered = true; });
      hookApi.onResponse(() => { responseTriggered = true; });
      hookApi.onError(() => { errorTriggered = true; });

      // 1. Успешный сценарий
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await hookApi('/posts/1');
      expect(requestTriggered).toBe(true);
      expect(responseTriggered).toBe(true);

      // 2. Сценарий ошибки
      mockFetch.mockRejectedValueOnce(new Error('Network Error'));

      try {
        await hookApi('/error-route');
      } catch {
        // Игнорируем ошибку, проверяем триггер хука
      }

      expect(errorTriggered).toBe(true);
    });


    it('Должен отправлять корректные события в модуль телеметрии', async () => {
      const telemetryApi = createSafeFetch({ baseUrl: 'https://example.com' });
      const events: string[] = [];

      telemetryApi.onTelemetry((event) => {
        events.push(event.type);
      });

      // Имитируем успешный ответ
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await telemetryApi('/telemetry-success');

      // Даем макротаску setTimeout(..., 0) внутри Telemetry.emit выполниться
      await new Promise(resolve => setTimeout(resolve, 5));

      expect(events).toContain('request');
      expect(events).toContain('response');
    });
  });
});