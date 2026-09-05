import { SoberError } from '@besober/core'

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

/** Every command that writes turns a refusal into a sentence, never a stack trace (§8.7). */
export const refuse = (error: unknown): never =>
	error instanceof SoberError
		? fail(error.message)
		: fail(String((error as Error).message ?? error))

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

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TICK = 80

/**
 * A run takes minutes and says nothing between tool calls, which reads as a
 * hang. The spinner lives on **stderr**, so a piped `sober run` still gets only
 * the lines — the CLI is the scriptable surface as well as a human one (§4).
 */
export const spinner = (label: string) => {
	if (plain) return { clear: () => {}, stop: () => {} }

	const started = Date.now()
	let frame = 0
	const draw = () => {
		const seconds = Math.floor((Date.now() - started) / 1000)
		process.stderr.write(
			`\r${dim(`${FRAMES[frame++ % FRAMES.length]} ${label} ${seconds}s`)}\u001b[K`,
		)
	}
	const timer = setInterval(draw, TICK)
	// Nothing should keep the process alive for a spinner.
	timer.unref?.()
	draw()

	const clear = () => process.stderr.write('\r\u001b[K')
	return {
		/** Wipe the line so a tail line can be printed over it, then it redraws. */
		clear,
		stop: () => {
			clearInterval(timer)
			clear()
		},
	}
}
