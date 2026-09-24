import {
	addContributor,
	assignNode,
	type Chained,
	claimChain,
	claimNode,
	type Overlap,
	readContributors,
	releaseChain,
	releaseNode,
	removeContributor,
	sameHandle,
	whoami,
} from '@besober/core'
import { chainEnds } from '@besober/schema'
import { openBoard } from './board.js'
import { bold, columns, cyan, dim, fail, green, refuse, say, yellow } from './out.js'

export interface Person {
	name?: string
	role?: string
	focus?: readonly string[]
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
		focus: [...(person.focus ?? [])],
	}).catch(refuse)
	say(`${green('✓')} ${handle} is on the project`)
	say()
	say(dim(`Next: ${bold(`sober assign <node> ${handle}`)}, or edit .sober/contributors.json.`))
}

const list = (
	team: readonly { handle: string; name: string; role: string; focus: readonly string[] }[],
) => {
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
				dim(person.focus.join(' ')),
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
export const claim = async (node: string, anyway = false): Promise<void> => {
	const paths = await openBoard()
	const by = await whoami(paths.root)
	const ends = chainEnds(node)

	if (ends === null) {
		const taken = await claimNode(paths, node, by).catch(refuse)

		say(`${green('✓')} ${node} is yours, as ${bold(by)}`)
		if (taken.previous !== null && !sameHandle(taken.previous.by, by)) {
			say()
			say(
				`${yellow('·')} it was ${bold(taken.previous.by)}'s — they were not asked, and not stopped`,
			)
		}
		await onTheProject(paths, by)
		return warn(taken.overlaps)
	}

	const run = await claimChain(paths, ends[0], ends[1], by, { anyway }).catch(refuse)
	if (run.nodes.length === 0) return nothingLinks(ends)

	if (run.changed.length === 0) {
		say(`${yellow('·')} ${some(run.taken.length, run.nodes.length)} already someone else's`)
		say(columns(run.taken.map((one) => [`  ${cyan(one.id)}`, dim(one.by)])).join('\n'))
		say()
		say(dim('  Nothing was taken. `--anyway` takes the whole run.'))
		return
	}

	say(`${green('✓')} ${nodesAre(run.changed.length)} yours, as ${bold(by)}`)
	say(columns(run.changed.map((id) => [`  ${cyan(id)}`])).join('\n'))
	passedOver(run)
	if (run.taken.length > 0) {
		say()
		say(
			`${yellow('·')} ${run.taken.length} of them ${run.taken.length === 1 ? 'was' : 'were'} someone else's — they were not asked`,
		)
		say(columns(run.taken.map((one) => [`  ${cyan(one.id)}`, dim(one.by)])).join('\n'))
	}
	await onTheProject(paths, by)
}

export const release = async (node: string): Promise<void> => {
	const paths = await openBoard()
	const ends = chainEnds(node)

	if (ends === null) {
		const had = await releaseNode(paths, node).catch(refuse)
		return say(
			had === null
				? `${yellow('·')} nobody had claimed ${node}`
				: `${green('✓')} ${node} is nobody's again`,
		)
	}

	const by = await whoami(paths.root)
	const run = await releaseChain(paths, ends[0], ends[1], by).catch(refuse)
	if (run.nodes.length === 0) return nothingLinks(ends)

	say(
		run.changed.length === 0
			? `${yellow('·')} you had claimed none of these ${run.nodes.length} nodes`
			: `${green('✓')} ${nodesAre(run.changed.length)} nobody's again`,
	)
	if (run.changed.length > 0) say(columns(run.changed.map((id) => [`  ${cyan(id)}`])).join('\n'))
	if (run.taken.length > 0) {
		say()
		say(`${yellow('·')} left alone, because they are not yours`)
		say(columns(run.taken.map((one) => [`  ${cyan(one.id)}`, dim(one.by)])).join('\n'))
	}
}

const nodesAre = (many: number): string => `${many} node${many === 1 ? ' is' : 's are'}`

// The noun agrees with the run, the verb with the part of it being talked about.
const some = (many: number, of: number): string =>
	`${many} of ${of} node${of === 1 ? '' : 's'} ${many === 1 ? 'is' : 'are'}`

/**
 * Two ends with nothing between them. Said as its own line rather than as an
 * empty success, because "I took nothing" and "there was nothing to take" are
 * the two answers a person needs told apart — usually the ends were given the
 * wrong way round, and the run reads from dependency to dependent.
 */
const nothingLinks = (ends: readonly [string, string]): void => {
	say(`${yellow('·')} nothing links ${cyan(ends[0])} to ${cyan(ends[1])} — no run to take`)
	say()
	say(dim('  A run reads from the node the work starts at to the one it ends at.'))
}

const passedOver = (run: Chained): void => {
	if (run.done.length === 0) return
	say()
	say(
		`${dim('·')} ${dim(`passed over ${run.done.length === 1 ? 'a node that is' : `${run.done.length} nodes that are`} already done: ${run.done.join(', ')}`)}`,
	)
}

const onTheProject = async (
	paths: Awaited<ReturnType<typeof openBoard>>,
	by: string,
): Promise<void> => {
	const team = await readContributors(paths).catch(refuse)
	if (team.some((person) => sameHandle(person.handle, by))) return
	say()
	say(`${yellow('·')} you are not on this project yet`)
	say(dim(`  sober contributors add "${by}"`))
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
