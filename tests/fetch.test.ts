import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSafeFetch, SafeFetchError } from '../src/index';

import fetch from 'node-fetch';

const safeFetch = createSafeFetch({ fetch: fetch as any });
const api = createSafeFetch({ baseUrl: 'https://jsonplaceholder.typicode.com' });

describe('safeFetch integration with JSONPlaceholder', () => {
    const BASE_URL = 'https://jsonplaceholder.typicode.com';

    it('GET /posts/1 returns post with id 1', async () => {
        const post = await safeFetch(`${BASE_URL}/posts/1`);
        expect(post).toHaveProperty('id', 1);
        expect(post).toHaveProperty('title');
        expect(post).toHaveProperty('body');
    });

    it('GET /posts returns array of posts', async () => {
        const posts = await safeFetch(`${BASE_URL}/posts`);
        expect(Array.isArray(posts)).toBe(true);
        expect(posts.length).toBeGreaterThan(0);
        expect(posts[0]).toHaveProperty('id');
    });

    it('POST /posts creates a new post', async () => {
        const newPost = {
            title: 'foo',
            body: 'bar',
            userId: 1,
        };
        const created = await safeFetch.post(`${BASE_URL}/posts`, newPost);
        expect(created).toHaveProperty('id');
        expect(created.title).toBe(newPost.title);
    });

    it('PUT /posts/1 updates a post', async () => {
        const updatedData = {
            id: 1,
            title: 'updated title',
            body: 'updated body',
            userId: 1,
        };
        const updated = await safeFetch.put(`${BASE_URL}/posts/1`, updatedData);
        expect(updated).toMatchObject(updatedData);
    });

    it('PATCH /posts/1 partially updates a post', async () => {
        const patch = { title: 'patched title' };
        const patched = await safeFetch.patch(`${BASE_URL}/posts/1`, patch);
        expect(patched.title).toBe(patch.title);
    });

    it('DELETE /posts/1 returns empty object', async () => {
        const result = await safeFetch.del(`${BASE_URL}/posts/1`);
        expect(result).toEqual({});
    });

    it('GET with query parameters (userId=1)', async () => {
        const posts = await safeFetch(`${BASE_URL}/posts`, { query: { userId: 1 } });
        expect(Array.isArray(posts)).toBe(true);
        if (posts.length) {
            expect(posts[0].userId).toBe(1);
        }
    });

    it('Handles 404 error', async () => {
        await expect(safeFetch(`${BASE_URL}/posts/99999`)).rejects.toThrow();
    });
})