import { execFileSync } from 'node:child_process'

/**
 * Everything the CLI prints goes through here. Colour is off when the output is
 * not a terminal, so a pipe gets text and a person gets a readable screen — the
 * CLI is the scriptable surface as well as a human one (§4).
 */
const plain = process.env.NO_COLOR !== undefined || !process.stdout.isTTY

const wrap = (code: string) => (text: string) => (plain ? text : `[${code}m${text}[0m`)

export const bold = wrap('1')
export const dim = wrap('2')
export const red = wrap('31')
export const green = wrap('32')
export const yellow = wrap('33')
export const blue = wrap('34')
export const magenta = wrap('35')
export const cyan = wrap('36')

export const say = (line = ''): void => {
	process.stdout.write(`${line}\n`)
}

/**
 * A failure names what failed and what to do about it (§8.7). It goes to
 * stderr, so a script that reads `sober status` never has to filter one out of
 * the data.
 */
export const fail = (message: string): never => {
	process.stderr.write(`${red('×')} ${message}\n`)
	process.exit(1)
}

/** Whoever git says is committing here: SOBER never asks for a second identity. */
export const whoami = (root: string): string => {
	try {
		return execFileSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' }).trim()
	} catch {
		return 'unknown'
	}
}

export const columns = (rows: readonly (readonly string[])[]): string[] => {
	const widths = rows.reduce<number[]>((widest, row) => {
		row.forEach((cell, index) => {
			widest[index] = Math.max(widest[index] ?? 0, visible(cell).length)
		})
		return widest
	}, [])
	return rows.map((row) =>
		row
			.map((cell, index) =>
				index === row.length - 1
					? cell
					: cell + ' '.repeat((widths[index] ?? 0) - visible(cell).length),
			)
			.join('  ')
			.trimEnd(),
	)
}

/** Colour codes take no width on screen and must not take any in a column. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: measuring what colour codes do not print
const ESCAPES = /\[\d+m/g
const visible = (text: string): string => text.replace(ESCAPES, '')
