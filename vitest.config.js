import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        testTimeout: 30000,
        hookTimeout: 15000,
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.js'],
            exclude: ['src/gateway.js'], // entry point, tested via e2e
        },
    },
});
