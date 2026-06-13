import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createSafeFetch, SafeFetchError } from '../src/index';

describe('Конвейер сохранения кастомных ошибок бэкенда', () => {
    const baseUrl = 'https://test-backend.local';
    let mockFetch: Mock;

    beforeEach(() => {
        // Подменяем глобальный fetch на мок перед каждым тестом
        mockFetch = vi.fn();
        globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        // Очищаем моки после каждого теста, чтобы изолировать их состояние
        vi.resetAllMocks();
    });

    it('1. Должен сохранить прямое поле "message" из JSON (400 Bad Request)', async () => {
        const errorResponse = { message: 'Неверный инвайт-код', code: 'INVALID_INVITE' };

        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify(errorResponse), {
                status: 400,
                statusText: 'Bad Request',
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const api = createSafeFetch({ baseUrl, retry: 0 });

        try {
            await api('/test-route');
            expect.fail('Запрос должен был упасть с ошибкой');
        } catch (err: any) {
            // Проверяем, что это наша кастомная ошибка, а не системный дженерик
            expect(err.name).toBe('SafeFetchError');

            // Самая главная проверка: сообщение бэкенда не затерлось строкой "HTTP 400: Bad Request"
            expect(err.message).toBe('Неверный инвайт-код');

            // Проверяем, что тело ответа также бережно сохранено в объекте
            expect(err.body).toBeDefined();
            expect(err.body.message).toBe('Неверный инвайт-код');
            expect(err.body.code).toBe('INVALID_INVITE');
            expect(err.status).toBe(400);
        }
    });

    it('2. Должен извлечь вложенный объект ошибки в стиле GraphQL/OAuth {"error": {"message": "..."}} (403)', async () => {
        const errorResponse = {
            error: {
                message: 'Доступ заблокирован безопасностью системы',
                code: 'FORBIDDEN_RESOURCE'
            }
        };

        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify(errorResponse), {
                status: 403,
                statusText: 'Forbidden',
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const api = createSafeFetch({ baseUrl, retry: 0 });

        try {
            await api('/admin-route');
            expect.fail('Запрос должен был упасть с ошибкой');
        } catch (err: any) {
            expect(err.name).toBe('SafeFetchError');
            // Проверяем глубокий парсинг вложенных объектов, который мы зашили в FetchMiddleware
            expect(err.message).toBe('Доступ заблокирован безопасностью системы');
            expect(err.body.error.code).toBe('FORBIDDEN_RESOURCE');
            expect(err.status).toBe(403);
        }
    });

    it('3. Должен извлечь поле "error", если бэкенд прислал плоский JSON без message {"error": "..."} (422)', async () => {
        const errorResponse = { error: 'Поле email заполнено некорректно' };

        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify(errorResponse), {
                status: 422,
                statusText: 'Unprocessable Entity',
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const api = createSafeFetch({ baseUrl, retry: 0 });

        try {
            await api('/register');
            expect.fail('Запрос должен был упасть с ошибкой');
        } catch (err: any) {
            expect(err.message).toBe('Поле email заполнено некорректно');
            expect(err.body.error).toBe('Поле email заполнено некорректно');
        }
    });

    it('4. Должен корректно прочитать сырой не-JSON текст ошибки с бэкенда (text/plain 400)', async () => {
        const rawTextError = 'Критический сбой валидации токена на сервере';

        mockFetch.mockResolvedValueOnce(
            new Response(rawTextError, {
                status: 400,
                statusText: 'Bad Request',
                headers: { 'Content-Type': 'text/plain' }
            })
        );

        const api = createSafeFetch({ baseUrl, retry: 0 });

        try {
            await api('/validate');
            expect.fail('Запрос должен был упасть с ошибкой');
        } catch (err: any) {
            // Если бэк прислал обычный текст, message может упасть в дефолтный HTTP 400: Bad Request,
            // но в свойстве err.body ОБЯЗАН лежать оригинальный текст с бэка для вывода на фронте!
            expect(err.body).toBe(rawTextError);
            expect(err.status).toBe(400);
        }
    });

    it('5. Должен вернуть дефолтный месседж HTTP 404, если бэкенд прислал пустой ответ (404 Empty Body)', async () => {
        mockFetch.mockResolvedValueOnce(
            new Response(null, {
                status: 404,
                statusText: 'Not Found'
            })
        );

        const api = createSafeFetch({ baseUrl, retry: 0 });

        try {
            await api('/not-exist');
            expect.fail('Запрос должен был упасть с ошибкой');
        } catch (err: any) {
            // Защита от падения парсера на пустых строках. Выдает стандартный заголовок
            expect(err.message).toBe('HTTP 404: Not Found');
            expect(err.body).toBe(''); // Тело пустое, но не undefined
            expect(err.status).toBe(404);
        }
    });

    it('6. Тест на "Матрешку": ResponseMiddleware НЕ должен перезаписывать кастомную ошибку из FetchMiddleware', async () => {
        const errorResponse = { message: 'Уникальный текст ошибки бизнес-логики' };

        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify(errorResponse), {
                status: 400,
                statusText: 'Bad Request',
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const api = createSafeFetch({ baseUrl, retry: 0 });

        // Добавляем шпиона в конвейер, чтобы убедиться, что ошибка идет снизу вверх без искажений
        api.use(async (ctx, next) => {
            await next();
            // Если ResponseMiddleware перезапишет ошибку, этот код зафиксирует поломку
        });

        try {
            await api('/submit');
            expect.fail('Запрос должен был упасть с ошибкой');
        } catch (err: any) {
            // Проверка жесткого фикса: ResponseMiddleware не применил свой дефолтный `HTTP 400: Bad Request`
            expect(err.message).toBe('Уникальный текст ошибки бизнес-логики');
            expect(err.body.message).toBe('Уникальный текст ошибки бизнес-логики');
        }
    });

    it('7. Должен корректно обрабатывать стандартную структуру ошибок Fastify', async () => {
        // Именно такую структуру отправляет Fastify при throw new Error() с кодом
        const fastifyError = {
            statusCode: 400,
            error: 'Bad Request',
            message: 'Неверный, заблокированный или просроченный инвайт-код 12'
        };

        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify(fastifyError), {
                status: 400,
                statusText: 'Bad Request',
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            })
        );

        const api = createSafeFetch({ baseUrl, retry: 0 });

        try {
            await api('/auth/invite');
            expect.fail('Запрос должен был упасть с ошибкой');
        } catch (err: any) {
            // Фронтенд должен получить чистый месседж из недр Fastify
            expect(err.message).toBe('Неверный, заблокированный или просроченный инвайт-код 12');
            expect(err.body.statusCode).toBe(400);
            expect(err.body.error).toBe('Bad Request');
        }
    });
});
