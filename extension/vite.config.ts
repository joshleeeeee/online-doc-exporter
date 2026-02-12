import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        vue(),
        crx({ manifest }),
    ],
    server: {
        port: 5173,
        strictPort: true,
        hmr: {
            port: 5173,
        },
        cors: {
            origin: '*',
            methods: '*',
            allowedHeaders: '*',
        }
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                popup: 'popup.html',
                print: 'print.html',
            },
        },
    },
})
