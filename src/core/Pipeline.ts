import type { Middleware, RequestContext } from '../types';

export class Pipeline {
    private middlewares: Middleware[] = [];

    /**
     * Добавляет middleware в конец цепочки.
     */
    use(...middlewares: Middleware[]): this {
        this.middlewares.push(...middlewares);
        return this;
    }

    /**
     * Добавляет middleware в начало цепочки.
     */
    prepend(...middlewares: Middleware[]): this {
        this.middlewares.unshift(...middlewares);
        return this;
    }

    /**
     * Вставляет middleware после указанного.
     * @param target - middleware, после которого вставить (по ссылке)
     */
    insertAfter(target: Middleware, ...middlewares: Middleware[]): this {
        const index = this.middlewares.findIndex(m => m === target);
        if (index === -1) throw new Error('Target middleware not found');
        this.middlewares.splice(index + 1, 0, ...middlewares);
        return this;
    }

    /**
     * Вставляет middleware перед указанным.
     * @param target - middleware, перед которым вставить
     */
    insertBefore(target: Middleware, ...middlewares: Middleware[]): this {
        const index = this.middlewares.findIndex(m => m === target);
        if (index === -1) throw new Error('Target middleware not found');
        this.middlewares.splice(index, 0, ...middlewares);
        return this;
    }

    /**
     * Удаляет middleware из цепочки.
     */
    remove(middleware: Middleware): this {
        const index = this.middlewares.findIndex(m => m === middleware);
        if (index !== -1) this.middlewares.splice(index, 1);
        return this;
    }

    /**
     * Выполняет цепочку middleware для контекста по стандарту Koa.
     */
    async run(ctx: RequestContext): Promise<void> {
        // Фиксируем максимальный индекс, который был вызван, для защиты от "double next"
        let lastCalledIndex = -1;

        const dispatch = async (i: number): Promise<void> => {
            // Если внутри одного middleware метод next() был вызван повторно
            if (i <= lastCalledIndex) {
                throw new Error('next() called multiple times in the same middleware');
            }

            lastCalledIndex = i;
            const middleware = this.middlewares[i];

            if (middleware) {
                console.log(`Pipeline: calling middleware #${i}`);
                // Передаем функцию next, которая жестко привязана к СЛЕДУЮЩЕМУ индексу (i + 1)
                await middleware(ctx, () => dispatch(i + 1));
            }
        };

        // Запускаем с нулевого индекса
        await dispatch(0);
    }

    /**
     * Создаёт копию текущего пайплайна (поверхностное копирование массива middleware).
     */
    clone(): Pipeline {
        const p = new Pipeline();
        p.middlewares = [...this.middlewares];
        return p;
    }
}
