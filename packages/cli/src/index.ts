import { createRequire } from 'node:module'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const [command] = process.argv.slice(2)

if (command === '--version' || command === '-v') {
	process.stdout.write(`${version}\n`)
} else {
	process.stdout.write(`sober ${version}\n\nusage: sober <command>\n`)
}
