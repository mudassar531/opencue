import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';

// Silero VAD assets shipped by @ricky0123/vad-web + onnxruntime-web's WASM
// runtime. Copied into the renderer build (and served by the Vite dev server)
// under `/vad/` so the renderer can load them with a stable, relative URL.
// Paths must be absolute because the renderer's vite root is `src/renderer/`
// and vite-plugin-static-copy resolves relative paths against that root.
const VAD_ASSETS = [
  {
    src: resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js'),
    dest: 'vad',
  },
  {
    src: resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx'),
    dest: 'vad',
  },
  {
    src: resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx'),
    dest: 'vad',
  },
  // onnxruntime-web ships several WASM variants — copy them all so the
  // runtime can pick the best one for the host CPU at load time.
  {
    src: resolve(__dirname, 'node_modules/onnxruntime-web/dist/*.wasm'),
    dest: 'vad',
  },
  {
    src: resolve(__dirname, 'node_modules/onnxruntime-web/dist/*.mjs'),
    dest: 'vad',
  },
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
      },
      rollupOptions: {
        output: {
          format: 'es',
          entryFileNames: '[name].js',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
      },
      rollupOptions: {
        output: {
          // CommonJS for the preload script so contextBridge runs in sandboxed context.
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    plugins: [react(), viteStaticCopy({ targets: VAD_ASSETS })],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    server: {
      port: 5173,
    },
  },
});
