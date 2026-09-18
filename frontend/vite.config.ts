import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at /aerostat/, not /. Only applied to
  // `vite build` (used by the Pages deploy workflow) so `npm run dev` keeps
  // serving at http://localhost:5173/ unaffected.
  base: command === 'build' ? '/aerostat/' : '/',
  plugins: [react()],
}))
