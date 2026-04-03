// tests/setup.ts
import { setupServer } from 'msw/node'; // сервер для Node
import { rest } from 'msw';             // rest-обработчики

// создаём сервер с моками
export const server = setupServer(
  rest.get('/users', (req, res, ctx) => {
    return res(ctx.status(200), ctx.json([{ id: 1, name: 'Alice' }]));
  }),
  rest.post('/users', (req, res, ctx) => {
    return res(ctx.status(201), ctx.json({ id: 2, ...(req.body as any) }));
  })
);

// Vitest hooks
import { beforeAll, afterAll, afterEach } from 'vitest';
beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());