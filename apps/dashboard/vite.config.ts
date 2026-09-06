import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The dev port `sober dashboard --port 4173` is expected on. Vite serves the
 * client and forwards the wire, so one address is the whole app in
 * development too — which is what lets the client's reads stay relative.
 */
const SERVER = 'http://127.0.0.1:4173'

export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		// The server hands these over by path (packages/server/src/client.ts), so
		// the names have to be stable enough for the bundler to key a map by.
		assetsDir: 'assets',
		// No sourcemap. This build is inlined into the `sober` binary, where the
		// map would be four times the size of everything else it ships — and
		// anybody debugging the dashboard is running `vite dev`, which has one.
		sourcemap: false,
		// Cytoscape is most of the bundle and there is no network here: the page
		// is served from loopback by the process that printed its address.
		chunkSizeWarningLimit: 1024,
	},
	server: {
		proxy: { '/read': SERVER, '/op': SERVER },
	},
})
