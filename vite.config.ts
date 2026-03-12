import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // Keep native/Node packages external so they load via Node.js
              // where CJS require() works. Bundling them into ESM breaks
              // dynamic require() calls inside @grpc/grpc-js and protobufjs.
              external: [
                '@grpc/grpc-js',
                '@grpc/proto-loader',
                'protobufjs',
                'protobufjs/ext/descriptor',
                /^protobufjs\//,
              ],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
