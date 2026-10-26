/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite requires a default export for its config file.
export default defineConfig(({ mode }) => ({
  // `--mode phone`: HTTPS with a self-signed certificate, so a phone on the same
  // Wi-Fi can open the camera (browsers block it on plain http:// LAN addresses).
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}))
