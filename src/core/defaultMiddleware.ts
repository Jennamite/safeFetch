import type { Middleware } from '../types';
import type { SafeFetch } from './SafeFetch';
import { timeoutMiddleware } from '../timeout/TimeoutMiddleware';
import { concurrencyMiddleware } from '../concurrency/ConcurrencyMiddleware';
import { queryMiddleware } from '../query/QueryMiddleware';
import { bodyMiddleware } from '../body/BodyMiddleware';
import { dedupeMiddleware } from '../dedupe/DedupeMiddleware';
import { batchMiddleware } from '../batch/BatchMiddleware';
import { cacheMiddleware, mutationInvalidationMiddleware } from '../cache/CacheMiddleware';
import { fetchMiddleware } from '../fetch/FetchMiddleware';
import { responseMiddleware } from '../response/ResponseMiddleware';
import { telemetryMiddleware } from '../telemetry/TelemetryMiddleware';
import { pollingMiddleware } from '../polling/PollingMiddleware';

export function defaultMiddleware(instance: SafeFetch): Middleware[] {
  return [
    // 1. Сквозные глобальные обертки (Должны гарантированно перехватывать все ошибки и успехи сверху вниз)
    telemetryMiddleware(instance.telemetry),
    pollingMiddleware(instance),
    mutationInvalidationMiddleware(instance.cache),
    concurrencyMiddleware(instance.concurrencyController),

    // 2. Инфраструктурные слои подготовки данных (Таймауты вешаются до сборки тела)
    timeoutMiddleware(),
    queryMiddleware(),
    bodyMiddleware(),

    // 3. Оптимизационные слои (Дедупликация должна стоять ВЫШЕ кэша, чтобы перехватывать параллельные запросы)
    dedupeMiddleware(instance.dedupeManager),
    batchMiddleware(instance.batchProcessor, instance),
    cacheMiddleware(instance.cache, instance),

    // 4. Слой обработки ответов (Парсит JSON/текст ошибок и валидирует статус-коды)
    // Обязан стоять ВЫШЕ исполнителя запросов, чтобы обернуть его в свой try/catch!
    responseMiddleware(),

    // 5. Исполнитель (Конечная точка пайплайна, дальше которой прохода по цепочке next() нет)
    fetchMiddleware(),
  ];
}
