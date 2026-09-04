import {
	ARCHIVE_FIELD,
	type Choices,
	type OpenConflict,
	openConflicts,
	resolveConflict,
	type Side,
} from '@besober/core'
import { openBoard, settingsOf } from './board.js'
import { bold, columns, cyan, dim, fail, green, magenta, refuse, say, yellow } from './out.js'

/**
 * What a record's two versions look like side by side. The values are printed,
 * never summarised: choosing between two things you cannot see is not a choice
 * (§2.5's rule, applied to a merge).
 */
const showFields = (conflict: OpenConflict): void => {
	const answered = conflict.answered ? dim(' — answered; say it again to change it') : ''
	if (conflict.kind === 'archived') {
		const them = conflict.by === 'theirs' ? 'Someone else' : 'You'
		const you = conflict.by === 'theirs' ? 'you' : 'someone else'
		say(`${bold(conflict.id)} ${dim('— archived on one side, edited on the other')}${answered}`)
		say()
		say(`  ${them} archived it while ${you} edited it.`)
		say()
		say(
			columns([
				[`  ${green('keep')}`, dim('leave it archived — the edit is dropped')],
				[`  ${green('restore')}`, dim('put it back on the board, with the edit')],
			]).join('\n'),
		)
		say()
		say(`  sober resolve ${conflict.id} keep`)
		return
	}

	const count = conflict.fields.length
	say(
		`${bold(conflict.id)} ${dim(`— ${count} field${count === 1 ? '' : 's'} changed on both sides`)}${answered}`,
	)
	for (const field of conflict.fields) {
		say()
		say(`  ${bold(field.field)}`)
		say(`    ${cyan('ours')}   ${field.ours}`)
		say(`    ${magenta('theirs')} ${field.theirs}`)
	}
	say()
	say(
		`  sober resolve ${conflict.id} ${conflict.fields.map((field) => `${field.field}=ours`).join(' ')}`,
	)
}

/** Every field only one side touched is already merged and is never listed here. */
export const listConflicts = async (): Promise<void> => {
	const paths = await openBoard()
	const branch = (await settingsOf(paths)).board.branch
	const conflicts = await openConflicts(paths, branch).catch(refuse)

	if (conflicts.length === 0) {
		say(`${green('✓')} nothing is waiting on you — run ${bold('sober sync')}`)
		return
	}
	for (const [at, conflict] of conflicts.entries()) {
		if (at > 0) say()
		showFields(conflict)
	}
}

/**
 * The answer, as arguments — the CLI never prompts, exactly like `sober decide`
 * (§4: it is the scriptable surface as well as a human one). A record whose
 * every question is answered lands the merge; one that is not is remembered
 * until the others arrive.
 */
export const resolve = async (id: string, answers: readonly string[]): Promise<void> => {
	const paths = await openBoard()
	const branch = (await settingsOf(paths)).board.branch

	if (answers.length === 0) {
		const conflicts = await openConflicts(paths, branch).catch(refuse)
		const asked = conflicts.find((conflict) => conflict.id === id)
		if (asked === undefined)
			return fail(`${id} is not waiting on you — \`sober resolve\` lists what is`)
		return showFields(asked)
	}

	const result = await resolveConflict(paths, branch, id, choicesFrom(answers)).catch(refuse)
	if (result.kind === 'recorded') {
		say(`${green('✓')} ${id} is answered — ${result.left.length} still waiting`)
		for (const conflict of result.left) say(`  ${dim(conflict.id)}`)
		say()
		say(`Answer them, and the merge lands on the last one.`)
		return
	}

	say(`${green('✓')} the merge landed — every record was decided by you`)
	if (result.findings.length > 0) {
		say()
		say(`${yellow('·')} but the board it made does not hold together:`)
		for (const finding of result.findings) say(`  ${finding}`)
		say()
		say('  Fix those, then sync. Nothing goes out until they are fixed.')
		process.exitCode = 1
		return
	}
	say()
	say(`Next: ${bold('sober sync')} to send it.`)
}

const SIDES = new Set(['ours', 'theirs'])

const choicesFrom = (answers: readonly string[]): Choices => {
	// `keep` and `restore` are the archive question, which has one answer and no
	// field — a person should not have to say `ours` about a rename.
	const [first] = answers
	if (first === 'keep' || first === 'restore') return { [ARCHIVE_FIELD]: first }

	const choices: Record<string, Side> = {}
	for (const answer of answers) {
		const [field, side] = answer.split('=')
		if (field === undefined || side === undefined || !SIDES.has(side))
			fail(`\`${answer}\` is not an answer — write \`<field>=ours\` or \`<field>=theirs\``)
		choices[field as string] = side as Side
	}
	return choices
}
