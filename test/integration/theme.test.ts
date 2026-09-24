import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATUSES } from '@besober/schema'
import { expect, test } from 'vitest'

/**
 * The design system, checked against the thing it describes (ADR 0039). It sits
 * in the integration project because it binds two packages: `schema` owns the
 * statuses and `apps/dashboard` owns their colours, and the guarantee worth
 * having is that neither can move without the other.
 */
const theme = readFileSync(
	fileURLToPath(new URL('../../apps/dashboard/src/theme.css', import.meta.url)),
	'utf8',
)

/** Everything between `[data-theme="light"] {` and its closing brace. */
const lightBlock = /\[data-theme=["']light["']\]\s*\{([\s\S]*?)\n\}/.exec(theme)?.[1] ?? ''

test('every status the schema names has a colour', () => {
	for (const status of STATUSES) {
		expect(theme, status).toContain(`--status-${status}:`)
	}
})

test('a ninth status cannot arrive without one — the light theme carries all eight too', () => {
	for (const status of STATUSES) {
		expect(lightBlock, status).toContain(`--status-${status}:`)
	}
})

test('the theme defines no colour the schema does not name', () => {
	const declared = [...theme.matchAll(/--status-([a-z-]+):/g)].map((m) => m[1])

	for (const name of new Set(declared)) {
		expect(STATUSES, name).toContain(name)
	}
})

test('colour is OKLCH throughout, so lightness stays comparable between themes', () => {
	// ADR 0039 rests on perceptual lightness: the greyscale gap between `ready`
	// and `held` is a number rather than a hope only while every colour is in
	// one space. A stray hex is that argument quietly ending.
	const hex = [...theme.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])

	expect(hex).toEqual([])
})

test('both themes carry the surfaces a screen needs', () => {
	for (const token of ['--bg', '--surface', '--raised', '--line', '--ink', '--ink-dim']) {
		expect(theme, `${token} (dark)`).toContain(`${token}:`)
		expect(lightBlock, `${token} (light)`).toContain(`${token}:`)
	}
})

const TX_TOKENS = [
	'--tx-tool',
	'--tx-result',
	'--tx-error',
	'--tx-think',
	'--tx-human',
	'--tx-pass',
]
const PROVIDER_TOKENS = [
	'--provider-anthropic',
	'--provider-openai',
	'--provider-google',
	'--provider-mistral',
	'--provider-other',
]

test('ADR 0064: the transcript and provider tokens exist in the dark root and the light theme', () => {
	for (const token of [...TX_TOKENS, ...PROVIDER_TOKENS]) {
		expect(theme, `${token} (dark)`).toContain(`${token}:`)
		expect(lightBlock, `${token} (light)`).toContain(`${token}:`)
	}
})

test('ADR 0064: no Google Fonts URL anywhere in the dashboard', () => {
	const srcDir = fileURLToPath(new URL('../../apps/dashboard/src', import.meta.url))
	const indexHtml = fileURLToPath(new URL('../../apps/dashboard/index.html', import.meta.url))
	const offenders: string[] = []

	const check = (path: string): void => {
		const contents = readFileSync(path, 'utf8')
		if (/@import|url\(|href=/.test(contents) && contents.includes('fonts.googleapis.com')) {
			offenders.push(path)
		}
	}

	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry)
			if (statSync(path).isDirectory()) {
				walk(path)
				continue
			}
			check(path)
		}
	}
	walk(srcDir)
	check(indexHtml)

	expect(offenders).toEqual([])
})

test('the glow reach is a fraction of a radius, not a pixel count', () => {
	// ADR 0039 §6: nodes are not one size — `done` renders smaller and the
	// canvas zooms — so a pixel value is a glow that is right once.
	const reach = /--glow-extent:\s*([\d.]+)\s*;/.exec(theme)?.[1]

	expect(reach, 'no --glow-extent in the theme').toBeDefined()
	expect(Number(reach)).toBeGreaterThan(0)
	expect(Number(reach)).toBeLessThan(2)
})
