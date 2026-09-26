import {
	correctNode,
	createDecision,
	createNode,
	dismissFlag,
	reopenNode,
	whoami,
} from '@besober/core'
import { CATEGORIES, Category } from '@besober/schema'
import { openBoard } from './board.js'
import { bold, dim, green, refuse, say } from './out.js'

/**
 * DESIGN §7.2's three actions on a flagged node, on the command line. Each one
 * says what it did and what is left: a flag dealt with is a step in a loop, and
 * the next step is never the same one twice.
 */

/** The flag, judged and set aside — the reason is what is kept (§7.2). */
export const dismiss = async (node: string, reason: string): Promise<void> => {
	const paths = await openBoard()
	await dismissFlag(paths, node, { by: await whoami(paths.root), reason }).catch(refuse)

	say(`${green('✓')} ${node} is no longer flagged`)
	say()
	say(dim('Kept on the node, so a teammate reads the judgement rather than the flag again.'))
	say(
		dim('A later change to the same decision flags it once more — that is a change nobody judged.'),
	)
}

/** The node comes back into the loop. Running it is still `sober run` (§7.2). */
export const reopen = async (node: string): Promise<void> => {
	const paths = await openBoard()
	await reopenNode(paths, node, await whoami(paths.root)).catch(refuse)

	say(`${green('✓')} ${node} is back in the loop`)
	say()
	say(dim(`Next: ${bold(`sober run ${node}`)}. Its brief is still approved.`))
	say(dim('The work it already landed stays landed — this reopens the node, not the merge.'))
}

/** The node's own words, fixed in place. Same id, same edges; an approval goes. */
export const correct = async (
	node: string,
	words: { title?: string; description?: string; name?: string },
): Promise<void> => {
	const paths = await openBoard()
	const updated = await correctNode(paths, node, {
		...words,
		by: await whoami(paths.root),
	}).catch(refuse)

	say(`${green('✓')} ${node} corrected`)
	if (updated.brief !== null) {
		say()
		say(dim(`Its brief is read beside these words, so it needs approving again.`))
		say(dim(`Next: ${bold(`sober approve ${node}`)}.`))
	}
}

/** The correction is its own piece of work (§7.2). One node, and no brief yet. */
export const open = async (
	title: string,
	edges: { decisions?: string; dependsOn?: string },
): Promise<void> => {
	const paths = await openBoard()
	const { id } = await createNode(paths, {
		title,
		by: await whoami(paths.root),
		decisions: list(edges.decisions),
		dependsOn: list(edges.dependsOn),
	}).catch(refuse)

	say(`${green('✓')} ${id}`)
	say()
	// It lands on `needs-brief`, and nothing runs without an approved brief
	// (§3.2). Writing one needs an agent, which a terminal does not have.
	say(dim(`Next: a brief. Ask for one in a session, then ${bold(`sober approve ${id}`)}.`))
}

/**
 * A question a person already knows they want answered, holding the nodes it
 * names. The options still come from a session (§2.6), so it arrives unopened.
 */
export const question = async (
	asked: string,
	given: { category?: string; binds?: string },
): Promise<void> => {
	const category = Category.safeParse(given.category)
	if (!category.success) return refuse(new Error(`--category is one of ${CATEGORIES.join(', ')}`))
	const paths = await openBoard()
	const { id } = await createDecision(paths, {
		question: asked,
		category: category.data,
		binds: list(given.binds) ?? [],
		by: await whoami(paths.root),
	}).catch(refuse)

	say(`${green('✓')} ${id}`)
	say()
	say(dim('It holds what it binds until it is answered, and it has no options yet.'))
	say(
		dim(
			`Next: ask a session for them (${bold('/sober:decide')}), then ${bold(`sober decide ${id} <option>`)}.`,
		),
	)
}

/** `--decisions a,b` — the same spelling `sober bind` takes. */
const list = (given: string | undefined): string[] | undefined =>
	given === undefined
		? undefined
		: given
				.split(',')
				.map((one) => one.trim())
				.filter((one) => one !== '')
