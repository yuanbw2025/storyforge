import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/storyforge/',
  server: {
    port: 5175,
    open: true,
  },
  build: {
    outDir: 'dist',
  },
})
