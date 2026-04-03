import type { Middleware } from '../types';
import type { SafeFetch } from './SafeFetch';
import { retryMiddleware } from '../retry/RetryMiddleware';
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

/**
 * Возвращает массив middleware, используемых по умолчанию.
 * Порядок важен!
 */
export function defaultMiddleware(instance: SafeFetch): Middleware[] {
  return [
    retryMiddleware(),
    timeoutMiddleware,
    concurrencyMiddleware(instance.concurrencyController),
    queryMiddleware,
    bodyMiddleware,
    dedupeMiddleware(instance.dedupeManager),
    batchMiddleware(instance.batchProcessor, instance),
    cacheMiddleware(instance.cache, instance),
    fetchMiddleware,
    responseMiddleware,
    telemetryMiddleware(instance.telemetry),
    mutationInvalidationMiddleware(instance.cache),
    pollingMiddleware(instance),
  ];
}