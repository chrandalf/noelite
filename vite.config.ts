import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5175,
    // /mnt/c is a Windows mount. WSL gets no inotify events across it, so without
    // polling Vite silently serves a stale module and you debug a file you already fixed.
    watch: { usePolling: true, interval: 200 },
  },
})
