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
     * Выполняет цепочку middleware для контекста.
     */
    async run(ctx: RequestContext): Promise<void> {
        let index = -1;
        const next = async (): Promise<void> => {
            index++;
            const middleware = this.middlewares[index];
            if (middleware) {
                console.log(`Pipeline: calling middleware #${index}`);
                await middleware(ctx, next);
            }
        };
        await next();
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