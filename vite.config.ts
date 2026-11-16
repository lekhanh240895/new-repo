/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Content-Security-Policy for production builds only (SPEC §14.1): Vite's dev
 * server injects inline scripts and styles that a strict policy would block.
 * 'wasm-unsafe-eval' lets MediaPipe compile its WebAssembly; nothing else may
 * run code from strings, and the page may only connect to itself.
 *
 * A <meta> CSP only covers the page. The vision worker takes its CSP from the
 * HTTP headers of its own script, so the policy is also sent as a header:
 * by `vite preview` (replay + CI) and by hosts that read public/_headers.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

/** Extra headers for hosts that read a `_headers` file (Cloudflare Pages, Netlify). */
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()',
}

function contentSecurityPolicy(): Plugin {
  return {
    name: 'biomonitor-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
    // Generated from the same constants, so the header and the meta tag never drift apart.
    // GitHub Pages ignores this file: there only the page (not the worker) gets the CSP.
    generateBundle() {
      const lines = Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`)
      this.emitFile({ type: 'asset', fileName: '_headers', source: `/*\n${lines.join('\n')}\n` })
    },
  }
}

/** The model cache name changes whenever a self-hosted asset changes, so phones never keep a stale model. */
const assetsVersion = createHash('sha256').update(readFileSync('assets.lock.json')).digest('hex').slice(0, 8)
const MODEL_CACHE = `biomonitor-model-${assetsVersion}`

/** Download size for offline use, shown before asking on mobile data: the worker's wasm + the model. */
function modelDownloadMb(): number {
  const files = ['public/mediapipe/wasm/vision_wasm_module_internal.js', 'public/mediapipe/wasm/vision_wasm_module_internal.wasm', 'public/models/face_landmarker.task']
  try {
    return Math.round(files.reduce((sum, f) => sum + statSync(f).size, 0) / 1e6)
  } catch {
    // Assets not fetched yet (fresh clone before `npm run assets`): a close estimate.
    return 18
  }
}

// Vite requires a default export for its config file.
export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  // The app reads these to download the model ahead of the first trip (offline use).
  define: {
    __MODEL_CACHE__: JSON.stringify(MODEL_CACHE),
    __MODEL_DOWNLOAD_MB__: JSON.stringify(modelDownloadMb()),
  },
  plugins: [
    react(),
    contentSecurityPolicy(),
    VitePWA({
      // Never auto-reload: a reload mid-trip would silently stop monitoring.
      // Updates are offered on the start screen only (src/app/pwa.ts).
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'BioMonitor DMS',
        short_name: 'BioMonitor',
        // Vietnamese first (decision 2026-11): this text shows in the system install dialog.
        description: 'Cảnh báo ngủ gật và mất tập trung khi lái xe, chạy ngay trên điện thoại. Không có video nào rời khỏi máy.',
        lang: 'vi',
        dir: 'ltr',
        categories: ['utilities', 'navigation'],
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // With screenshots, Android shows the richer install dialog. App screens only: no faces.
        screenshots: [
          { src: 'screenshots/start.png', sizes: '1080x2340', type: 'image/png', form_factor: 'narrow', label: 'Màn hình bắt đầu' },
          { src: 'screenshots/ready.png', sizes: '1080x2340', type: 'image/png', form_factor: 'narrow', label: 'Sẵn sàng lái xe' },
          { src: 'screenshots/wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide', label: 'Màn hình bắt đầu' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The model and wasm (~30 MB) are cached on first use instead of at install.
        // Store screenshots are only for the install dialog: not needed offline.
        globIgnores: ['mediapipe/**', 'models/**', 'screenshots/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/mediapipe/wasm/') || url.pathname.includes('/models/'),
            handler: 'CacheFirst',
            options: {
              cacheName: MODEL_CACHE,
              expiration: { maxEntries: 20 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
    // `--mode phone`: HTTPS with a self-signed certificate, so a phone on the same
    // Wi-Fi can open the camera (browsers block it on plain http:// LAN addresses).
    ...(mode === 'phone' ? [basicSsl()] : []),
  ],
  worker: { format: 'es' },
  preview: { headers: SECURITY_HEADERS },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}))
