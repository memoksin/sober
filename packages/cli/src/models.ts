import {
	applySetting,
	type Candidate,
	claudeModels,
	codexModels,
	installed,
	openRouterModels,
} from '@besober/core'
import { openBoard, settingsOf } from './board.js'
import { bold, columns, cyan, dim, fail, say } from './out.js'

/**
 * What the installed hosts can reach, plus OpenRouter's catalogue, ready to
 * become `dispatch.models` entries. OpenRouter's catalogue is a few hundred lines, so only its free
 * models print unless asked; the range is left to the person, because it is a
 * budget decision (ADR 0061).
 */
export const models = async ({ all }: { readonly all: boolean }): Promise<void> => {
	const found: Candidate[] = []
	if (installed('claude')) found.push(...claudeModels())
	if (installed('codex')) found.push(...(await codexModels()))
	// OpenRouter's catalogue is public and its host is SOBER itself, so it
	// needs nothing installed (ADR 0062).
	const router = await openRouterModels().catch((error: Error) =>
		fail(`OpenRouter could not be read: ${error.message}`),
	)
	found.push(...router.filter((m) => all || m.free))
	if (found.length === 0) return fail('none of claude, codex or openrouter listed a model')

	for (const host of ['claude', 'codex', 'openrouter'] as const) {
		const mine = found.filter((m) => m.host === host)
		if (mine.length === 0) continue
		say(
			bold(
				host === 'openrouter'
					? all
						? 'openrouter · OpenRouter'
						: 'openrouter · OpenRouter, free'
					: host,
			),
		)
		for (const line of columns(
			mine.map((m) => [`  ${cyan(m.name)}`, m.run, dim(m.about.slice(0, 90))]),
		))
			say(line)
		say()
	}
	say(dim('add one:  sober models add <name> "<run>" --complexity 1-3 [--about "…"]'))
	if (!all) say(dim('every OpenRouter model:  sober models --all'))
}

/** One entry appended to `dispatch.models`, comments and all around it kept. */
export const addModel = async (
	name: string,
	run: string,
	options: { readonly complexity?: string; readonly about?: string },
): Promise<void> => {
	const paths = await openBoard()
	const range = /^(\d+)-(\d+)$/.exec(options.complexity ?? '')
	if (range === null) return fail('which scores? --complexity 1-3')
	const complexity = [Number(range[1]), Number(range[2])]
	const [low, high] = complexity as [number, number]
	if (low < 1 || high > 10 || low > high) return fail('a range runs from 1 to 10, low end first')
	const config = await settingsOf(paths)
	if (config.dispatch.models.some((m) => m.name === name))
		return fail(`${name} is already in dispatch.models`)
	await applySetting(paths, ['dispatch', 'models', config.dispatch.models.length], {
		name,
		run,
		complexity,
		about: options.about ?? '',
	})
	say(`${name} added to dispatch.models, for scores ${complexity[0]}–${complexity[1]}`)
}
