import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromServer = (name: string): string => fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url));

export default defineConfig({
    // Tests that import the frontend's voucher code (frontend/src/voucher) use the server's own copies of these packages:
    // the server install builds the SQLite module the XO engine loads, which the frontend install does not need to.
    resolve: { alias: { '@xo-cash/engine': fromServer('@xo-cash/engine'), '@xo-cash/utils': fromServer('@xo-cash/utils'), '@xo-cash/crypto': fromServer('@xo-cash/crypto') } },
    test: { include: ['test/**/*.test.ts'], testTimeout: 30000 },
});
