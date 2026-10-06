/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages serves the app from /Aus-lap/; locally it's served from /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  test: { environment: 'node' },
})
