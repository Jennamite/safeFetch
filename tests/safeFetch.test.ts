// tests/safeFetch.test.ts
import { describe, it, expect } from 'vitest';
import safeFetch from '../index1';
import './setup'; // подключаем сервер с моками

describe('safeFetch', () => {
  it('GET /users', async () => {
    const data = await safeFetch.get('/users');
    expect(data).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('POST /users', async () => {
    const data = await safeFetch.post('/users', { name: 'Bob' });
    expect(data).toEqual({ id: 2, name: 'Bob' });
  });
});