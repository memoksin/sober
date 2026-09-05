import {
	addContributor,
	assignNode,
	claimNode,
	type Overlap,
	readContributors,
	releaseNode,
	removeContributor,
	whoami,
} from '@besober/core'
import { openBoard } from './board.js'
import { bold, columns, cyan, dim, fail, green, refuse, say, yellow } from './out.js'

export interface Person {
	name?: string
	role?: string
	focus?: string
}

/**
 * The team is board state, not configuration (DESIGN §3.3): it travels with the
 * graph, because who is on the project is a property of the project rather than
 * of one machine.
 */
export const contributors = async (
	action: string | undefined,
	handle: string | undefined,
	person: Person,
): Promise<void> => {
	const paths = await openBoard()

	if (action === undefined) return list(await readContributors(paths).catch(refuse))
	if (action !== 'add' && action !== 'remove')
		return fail(`there is no \`sober contributors ${action}\` — try \`add\` or \`remove\``)
	if (handle === undefined) return fail(`who? \`sober contributors ${action} <handle>\``)

	if (action === 'remove') {
		const gone = await removeContributor(paths, handle).catch(refuse)
		if (!gone) return fail(`${handle} is not on this project — \`sober contributors\` lists who is`)
		say(`${green('✓')} ${handle} is off the project`)
		say()
		say(dim('Nodes they were assigned keep the handle until someone assigns them again.'))
		return
	}

	await addContributor(paths, {
		handle,
		name: person.name ?? '',
		role: person.role ?? '',
		focus: person.focus ?? '',
	}).catch(refuse)
	say(`${green('✓')} ${handle} is on the project`)
	say()
	say(dim(`Next: ${bold(`sober assign <node> ${handle}`)}, or edit .sober/contributors.json.`))
}

const list = (team: readonly { handle: string; name: string; role: string; focus: string }[]) => {
	if (team.length === 0) {
		say(dim('Nobody is on this project yet.'))
		say()
		say(`Add someone with ${bold('sober contributors add <handle> --role … --focus …')}`)
		return
	}
	say(
		columns(
			team.map((person) => [
				`  ${cyan(person.handle)}`,
				person.name,
				dim(person.role),
				dim(person.focus),
			]),
		).join('\n'),
	)
}

/** Assignment is a plan — a human handing a node to someone ahead of time. */
export const assign = async (node: string, handle: string | null): Promise<void> => {
	const paths = await openBoard()
	await assignNode(paths, node, handle).catch(refuse)
	say(
		handle === null
			? `${green('✓')} ${node} is assigned to nobody`
			: `${green('✓')} ${node} is assigned to ${handle}`,
	)
}

/**
 * Claim is a fact — whoever actually starts it. It is a signal, not a lock
 * (D23): taking a node someone else is heading for is reported, never refused.
 */
export const claim = async (node: string): Promise<void> => {
	const paths = await openBoard()
	const by = await whoami(paths.root)
	const taken = await claimNode(paths, node, by).catch(refuse)

	say(`${green('✓')} ${node} is yours, as ${bold(by)}`)
	if (taken.previous !== null && taken.previous.by !== by) {
		say()
		say(`${yellow('·')} it was ${bold(taken.previous.by)}'s — they were not asked, and not stopped`)
	}

	const team = await readContributors(paths).catch(refuse)
	if (!team.some((person) => person.handle === by)) {
		say()
		say(`${yellow('·')} you are not on this project yet`)
		say(dim(`  sober contributors add "${by}"`))
	}
	warn(taken.overlaps)
}

export const release = async (node: string): Promise<void> => {
	const paths = await openBoard()
	const had = await releaseNode(paths, node).catch(refuse)
	say(
		had === null
			? `${yellow('·')} nobody had claimed ${node}`
			: `${green('✓')} ${node} is nobody's again`,
	)
}

/**
 * The same-files warning (§3.4). It is about nodes, not people: two of one
 * person's own parallel nodes are the ordinary case. It says so and stops
 * nothing — the prediction it reads is a prediction (D22).
 */
export const warn = (overlaps: readonly Overlap[], harmless = true): void => {
	if (overlaps.length === 0) return
	say()
	say(
		`${yellow('·')} ${overlaps.length} node${overlaps.length === 1 ? '' : 's'} heading for the same files`,
	)
	say(
		columns(
			overlaps.map((overlap) => [
				`  ${cyan(overlap.id)}`,
				dim(overlap.by ?? 'not started yet'),
				overlap.files.join(', '),
			]),
		).join('\n'),
	)
	if (!harmless) return
	say()
	say(dim('  Nothing is blocked. Two nodes on one file is one merge, done twice.'))
}
