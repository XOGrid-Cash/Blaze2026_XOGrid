// Serves the real frontend (frontend/vite.config.ts) on port 5190 with /api proxied to the production registry,
// so the promo recording shows real, read-only data. Nothing in frontend/ or server/ is changed.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '../frontend');
const { createServer } = await import(pathToFileURL(resolve(frontend, 'node_modules/vite/dist/node/index.js')).href);

export const PORT = Number(process.env.PROMO_PORT ?? 5190);
const API = process.env.PROMO_API ?? 'https://blaze2026-xogrid.onrender.com';

const server = await createServer({
    root: frontend,
    configFile: resolve(frontend, 'vite.config.ts'),
    server: {
        port: PORT,
        strictPort: true,
        proxy: { '/api': { target: API, changeOrigin: true, secure: true } },
    },
});

await server.listen();
console.log(`Promo frontend on http://localhost:${PORT} (API: ${API})`);
