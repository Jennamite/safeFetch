import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSafeFetch, SafeFetchError } from '../src/index';

describe('Обработка ошибок safeFetch', () => {
    const baseUrl = 'https://api.example.com';
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn();
        globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('Ошибка 400 с JSON-телом', () => {
        it('должен извлечь message из JSON', async () => {
            const errorBody = JSON.stringify({ message: 'Некорректные данные', code: 400 });
            mockFetch.mockResolvedValueOnce(new Response(errorBody, { status: 400, statusText: 'Bad Request', headers: { 'Content-Type': 'application/json' } }));

            const api = createSafeFetch({ baseUrl });

            try {
                await api('/users');
                expect.fail('Должна быть ошибка');
            } catch (err) {
                expect(err).toBeInstanceOf(SafeFetchError);
                if (err instanceof SafeFetchError) {
                    expect(err.message).toBe('Некорректные данные');
                    expect(err.status).toBe(400);
                    expect(err.body.message).toBe('Некорректные данные');
                }
            }
        });

        it('должен извлечь поле error если нет message', async () => {
            const errorBody = JSON.stringify({ error: 'Ошибка валидации' });
            mockFetch.mockResolvedValueOnce(new Response(errorBody, { status: 400, headers: { 'Content-Type': 'application/json' } }));

            const api = createSafeFetch({ baseUrl });

            try {
                await api('/users');
                expect.fail('Должна быть ошибка');
            } catch (err) {
                if (err instanceof SafeFetchError) {
                    expect(err.message).toBe('Ошибка валидации');
                }
            }
        });
    });

    describe('Ошибка 400 с текстовым телом', () => {
        it('должен показать текст ошибки', async () => {
            const errorBody = 'Bad Request: некорректный email';
            mockFetch.mockResolvedValueOnce(new Response(errorBody, { status: 400, statusText: 'Bad Request' }));

            const api = createSafeFetch({ baseUrl });

            try {
                await api('/users');
                expect.fail('Должна быть ошибка');
            } catch (err) {
                expect(err).toBeInstanceOf(SafeFetchError);
                if (err instanceof SafeFetchError) {
                    expect(err.message).toBe('HTTP 400: Bad Request');
                    expect(err.body).toBe(errorBody);
                }
            }
        });
    });

    describe('Ошибка 500 (серверная)', () => {
        it('должна иметь isRetryable = true', async () => {
            mockFetch.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

            const api = createSafeFetch({ baseUrl, retry: 0 });

            try {
                await api('/unstable');
                expect.fail('Должна быть ошибка');
            } catch (err) {
                if (err instanceof SafeFetchError) {
                    expect(err.isRetryable).toBe(true);
                }
            }
        });
    });

    describe('Ошибка 404', () => {
        it('должна иметь isRetryable = false', async () => {
            const errorBody = JSON.stringify({ message: 'Ресурс не найден' });
            mockFetch.mockResolvedValueOnce(new Response(errorBody, { status: 404, headers: { 'Content-Type': 'application/json' } }));

            const api = createSafeFetch({ baseUrl });

            try {
                await api('/users/999');
                expect.fail('Должна быть ошибка');
            } catch (err) {
                if (err instanceof SafeFetchError) {
                    expect(err.isRetryable).toBe(false);
                    expect(err.status).toBe(404);
                }
            }
        });
    });

    describe('Ошибка сети (fetch rejected)', () => {
        it('должна быть помечена isAbort = false (обычная сетевая)', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network Error'));

            const api = createSafeFetch({ baseUrl });

            try {
                await api('/users');
                expect.fail('Должна быть ошибка');
            } catch (err) {
                expect(err).toBeInstanceOf(SafeFetchError);
                if (err instanceof SafeFetchError) {
                    expect(err.isAbort).toBe(false);
                    expect(err.message).toMatch(/Network Error/i);
                }
            }
        });
    });

    describe('Отмена запроса', () => {
        it('должна быть помечена isAbort = true', async () => {
            // 🔥 ИСПРАВЛЕНИЕ: Используем стандартный AbortController на уровне теста,
            // как это делает конечный пользователь библиотеки в реальном коде.
            const controller = new AbortController();
            const api = createSafeFetch({ baseUrl });

            // Мок fetch, который синхронно реагирует на отмену переданного сигнала
            mockFetch.mockImplementation((_, init) => {
                const signal = init?.signal;
                
                if (signal?.aborted) {
                    return Promise.reject(new DOMException('Aborted', 'AbortError'));
                }

                return new Promise((_, reject) => {
                    signal?.addEventListener('abort', () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    }, { once: true });
                });
            });

            // Передаем сигнал отмены явно в опциях запроса
            const promise = api('/long', { signal: controller.signal });
            
            // Отменяем контроллер синхронно в микрозадаче
            queueMicrotask(() => {
                controller.abort();
            });

            try {
                await promise;
                expect.fail('Должна быть ошибка');
            } catch (err) {
                expect(err).toBeInstanceOf(SafeFetchError);
                if (err instanceof SafeFetchError) {
                    expect(err.isAbort).toBe(true);
                    // Нативный AbortError от нативного контроллера вернет стандартный месседж
                    expect(err.message).toMatch(/abort|cancel/i);
                }
            }
        });
    });







    describe('Пустой ответ при ошибке', () => {
        it('должен корректно обработать пустое тело', async () => {
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 400, statusText: 'Bad Request' }));

            const api = createSafeFetch({ baseUrl });

            try {
                await api('/users');
                expect.fail('Должна быть ошибка');
            } catch (err) {
                if (err instanceof SafeFetchError) {
                    expect(err.status).toBe(400);
                    expect(err.body).toBe('');
                }
            }
        });
    });

    describe('Ошибка с вложенным объектом ошибки', () => {
        it('должен извлечь вложенное сообщение', async () => {
            const errorBody = JSON.stringify({
                error: {
                    message: 'Недостаточно прав',
                    code: 'FORBIDDEN'
                }
            });
            mockFetch.mockResolvedValueOnce(
                new Response(errorBody, {
                    status: 403,
                    statusText: 'Forbidden',
                    headers: { 'Content-Type': 'application/json' }
                })
            );

            const api = createSafeFetch({ baseUrl });

            try {
                await api('/admin');
                expect.fail('Должна быть ошибка');
            } catch (err) {
                if (err instanceof SafeFetchError) {
                    // ✅ Проверяем, что тело ошибки содержит вложенный объект
                    expect(err.body).toBeDefined();
                    expect(typeof err.body).toBe('object');
                    expect(err.body.error.message).toBe('Недостаточно прав');
                    expect(err.body.error.code).toBe('FORBIDDEN');
                }
            }
        });
    });
});