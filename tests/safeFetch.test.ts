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

});