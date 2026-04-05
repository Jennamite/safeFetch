// import { describe, it, expect } from 'vitest';

// describe('Native fetch integration with JSONPlaceholder', () => {
//   const BASE_URL = 'https://jsonplaceholder.typicode.com';

//   it('GET /posts/1 returns post with id 1', async () => {
//     const response = await fetch(`${BASE_URL}/posts/1`);
//     expect(response.status).toBe(200);
//     const post = await response.json();
//     expect(post).toHaveProperty('id', 1);
//     expect(post).toHaveProperty('title');
//     expect(post).toHaveProperty('body');
//   });

//   it('GET /posts returns array of posts', async () => {
//     const response = await fetch(`${BASE_URL}/posts`);
//     expect(response.status).toBe(200);
//     const posts = await response.json();
//     expect(Array.isArray(posts)).toBe(true);
//     expect(posts.length).toBeGreaterThan(0);
//     expect(posts[0]).toHaveProperty('id');
//   });

//   it('POST /posts creates a new post', async () => {
//     const newPost = {
//       title: 'foo',
//       body: 'bar',
//       userId: 1,
//     };
//     const response = await fetch(`${BASE_URL}/posts`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(newPost),
//     });
//     expect(response.status).toBe(201);
//     const created = await response.json();
//     expect(created).toHaveProperty('id');
//     expect(created.title).toBe(newPost.title);
//   });

//   it('PUT /posts/1 updates a post', async () => {
//     const updatedData = {
//       id: 1,
//       title: 'updated title',
//       body: 'updated body',
//       userId: 1,
//     };
//     const response = await fetch(`${BASE_URL}/posts/1`, {
//       method: 'PUT',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(updatedData),
//     });
//     expect(response.status).toBe(200);
//     const updated = await response.json();
//     expect(updated).toMatchObject(updatedData);
//   });

//   it('PATCH /posts/1 partially updates a post', async () => {
//     const patch = { title: 'patched title' };
//     const response = await fetch(`${BASE_URL}/posts/1`, {
//       method: 'PATCH',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(patch),
//     });
//     expect(response.status).toBe(200);
//     const patched = await response.json();
//     expect(patched.title).toBe(patch.title);
//   });

//   it('DELETE /posts/1 returns status 200', async () => {
//     const response = await fetch(`${BASE_URL}/posts/1`, {
//       method: 'DELETE',
//     });
//     expect(response.status).toBe(200);
//     const body = await response.json();
//     expect(body).toEqual({});
//   });

//   it('GET with query parameters (userId=1)', async () => {
//     const url = new URL(`${BASE_URL}/posts`);
//     url.searchParams.set('userId', '1');
//     const response = await fetch(url);
//     expect(response.status).toBe(200);
//     const posts = await response.json();
//     expect(Array.isArray(posts)).toBe(true);
//     if (posts.length) {
//       expect(posts[0].userId).toBe(1);
//     }
//   });

//   it('Handles 404 error', async () => {
//     const response = await fetch(`${BASE_URL}/posts/99999`);
//     expect(response.status).toBe(404);
//     // не выбрасывает исключение, просто статус 404
//   });
// });

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSafeFetch, SafeFetchError } from '../src/index';
import type { Mock } from 'vitest';

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