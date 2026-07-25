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
                'yaml',
                'prettier',
                'express',
                'cors',
                '@modelcontextprotocol/sdk',
                /^@modelcontextprotocol\//
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
    // Force Vite to use a single copy of @codemirror/state to prevent
    // "Unrecognized extension value in extension set" errors caused by
    // duplicate instances (e.g. nested copies in @codemirror/theme-one-dark).
    dedupe: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/commands',
      '@codemirror/autocomplete',
      '@codemirror/search',
    ],
  },
  build: {
    // Enable code-splitting (Rolldown) to reduce the size of the main
    // renderer bundle. Without this, Vite emits a single ~1.2 MB chunk and
    // warns about chunks > 500 KB. `codeSplitting: true` enables Rolldown's
    // automatic splitting for shared code, and `manualChunks` splits large
    // vendor libraries into separate parallel-loadable assets. This doesn't
    // change runtime behavior since the app has no dynamic import() routes.
    rolldownOptions: {
      output: {
        codeSplitting: true,
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('@codemirror') ||
              id.includes('@lezer') ||
              id.includes('crelt')
            ) {
              return 'codemirror'
            }
            if (
              id.includes('framer-motion') ||
              id.includes('motion-dom') ||
              id.includes('motion-utils')
            ) {
              return 'framer'
            }
            if (id.includes('@dnd-kit') || id.includes('dnd-core')) {
              return 'dndkit'
            }
            if (id.includes('lucide-react')) {
              return 'lucide'
            }
            if (
              id.includes('react-dom') ||
              id.includes('react/') ||
              id.includes('/react\\') ||
              id.includes('scheduler')
            ) {
              return 'react'
            }
            return 'vendor'
          }
        },
      },
    },
  },
})
