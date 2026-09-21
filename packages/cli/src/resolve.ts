import { emitKeypressEvents } from 'node:readline'
import {
	ARCHIVE_FIELD,
	type Choices,
	type OpenConflict,
	openConflicts,
	type Resolution,
	resolveConflict,
	type Side,
} from '@besober/core'
import { openBoard, settingsOf } from './board.js'
import { bodyOf, pad, type Row, sideBySide } from './merge-view.js'
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

/**
 * Every field only one side touched is already merged and is never listed here.
 * A person at a terminal gets the picker; a pipe gets the listing, so the
 * scriptable surface is unchanged (§4).
 */
export const listConflicts = async (): Promise<void> => {
	const paths = await openBoard()
	const branch = (await settingsOf(paths)).board.branch
	const conflicts = await openConflicts(paths, branch).catch(refuse)

	if (conflicts.length === 0) {
		say(`${green('✓')} nothing is waiting on you — run ${bold('sober sync')}`)
		return
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		for (const [at, conflict] of conflicts.entries()) {
			if (at > 0) say()
			showFields(conflict)
		}
		return
	}

	const answers = await pick(conflicts)
	if (answers === null) {
		say(dim('nothing was answered'))
		return
	}
	for (const [id, choices] of answers)
		say(
			`${bold(id)}  ${dim(
				Object.entries(choices)
					.map(([field, side]) => `${field} → ${side}`)
					.join(', '),
			)}`,
		)
	say()
	// One record at a time, exactly as the arguments form does; the last lands the merge.
	let last: { id: string; result: Resolution } | undefined
	for (const [id, choices] of answers) {
		last = { id, result: await resolveConflict(paths, branch, id, choices).catch(refuse) }
	}
	if (last !== undefined) report(last.id, last.result)
}

interface Question {
	readonly conflict: OpenConflict
	readonly field: string
	readonly rows: readonly Row[]
}

const KEYS = 'o ours  t theirs  ←→ field  ↑↓ PgUp PgDn scroll  enter apply  q quit'
const ARCHIVE_KEYS = 'a keep archived  r restore  ←→ field  enter apply  q quit'

const fit = (text: string, width: number): string =>
	text.length > width ? `${text.slice(0, width - 1)}…` : text

/**
 * The picker: one screen per field, both versions as a diff a person can read,
 * and nothing is written until every question has an answer and enter is pressed.
 */
const pick = (conflicts: readonly OpenConflict[]): Promise<Map<string, Choices> | null> => {
	const questions = conflicts.flatMap<Question>((conflict) =>
		conflict.kind === 'archived'
			? [{ conflict, field: ARCHIVE_FIELD, rows: [] }]
			: conflict.fields.map((field) => ({
					conflict,
					field: field.field,
					rows: bodyOf(field.ours, field.theirs),
				})),
	)
	const chosen = new Map<Question, Choices[string]>()
	let current = 0
	let scroll = 0
	let note = ''
	const { stdin, stdout } = process

	const bodyOfQuestion = (question: Question, width: number): string[] => {
		const { conflict } = question
		if (conflict.kind === 'archived') {
			const them = conflict.by === 'theirs' ? 'Someone else' : 'You'
			const you = conflict.by === 'theirs' ? 'you' : 'someone else'
			return [
				`${them} archived it while ${you} edited it.`,
				'',
				`${green('a')}  keep it archived — the edit is dropped`,
				`${green('r')}  restore it — back on the board, with the edit`,
			]
		}
		const column = Math.floor((width - 3) / 2)
		return sideBySide(question.rows, column).map(({ kind, left, right }) =>
			kind === 'gap'
				? dim(left)
				: kind === 'changed'
					? `${cyan(left)} ${dim('│')} ${magenta(right)}`
					: `${left} ${dim('│')} ${right}`,
		)
	}

	const draw = (): void => {
		const width = Math.max(stdout.columns ?? 80, 20) - 1
		const height = Math.max(stdout.rows ?? 24, 8)
		const question = questions[current] as Question
		const { conflict } = question
		const answer = chosen.get(question)
		const answered = questions.filter((each) => chosen.has(each)).length

		const head = [
			bold(fit(conflict.id, width)),
			dim(
				fit(
					`record ${conflicts.indexOf(conflict) + 1}/${conflicts.length} · field ${question.field} · question ${current + 1}/${questions.length}`,
					width,
				),
			),
			conflict.kind === 'archived'
				? ''
				: `${cyan(pad('ours', Math.floor((width - 3) / 2)))} ${dim('│')} ${magenta('theirs')}`,
			'',
		]
		const body = bodyOfQuestion(question, width)
		const room = height - head.length - 3
		scroll = Math.min(Math.max(scroll, 0), Math.max(body.length - room, 0))
		const shown = body.slice(scroll, scroll + room)
		while (shown.length < room) shown.push('')

		const status = [
			answer === undefined ? yellow('· not chosen') : green(`✓ ${answer}`),
			dim(`${answered}/${questions.length} answered`),
			body.length > room ? dim(`lines ${scroll + 1}–${scroll + shown.length}/${body.length}`) : '',
			note === '' ? '' : yellow(note),
		]
		const foot = [
			'',
			status.filter((part) => part !== '').join('  '),
			dim(fit(conflict.kind === 'archived' ? ARCHIVE_KEYS : KEYS, width)),
		]
		stdout.write(`[H${[...head, ...shown, ...foot].map((line) => `${line}[K`).join('\r\n')}[J`)
	}

	return new Promise((done) => {
		const restore = (): void => {
			stdout.write('[?25h')
		}
		const finish = (answers: Map<string, Choices> | null): void => {
			stdin.off('keypress', onKey)
			stdout.off('resize', draw)
			process.off('exit', restore)
			stdin.setRawMode(false)
			stdin.pause()
			restore()
			say()
			done(answers)
		}

		const choose = (question: Question, value: Choices[string]): void => {
			chosen.set(question, value)
			const next = questions.findIndex((each, at) => at > current && !chosen.has(each))
			const wrapped = next === -1 ? questions.findIndex((each) => !chosen.has(each)) : next
			if (wrapped !== -1) {
				current = wrapped
				scroll = 0
			}
		}

		const answersOf = (): Map<string, Choices> => {
			const answers = new Map<string, Choices>()
			for (const conflict of conflicts) {
				const choices: Record<string, Choices[string]> = {}
				for (const question of questions)
					if (question.conflict === conflict)
						choices[question.field] = chosen.get(question) as Choices[string]
				answers.set(conflict.id, choices)
			}
			return answers
		}

		const onKey = (_: string, key: { name?: string; ctrl?: boolean; shift?: boolean }): void => {
			note = ''
			const question = questions[current] as Question
			const page = Math.max((stdout.rows ?? 24) - 10, 1)
			const archived = question.conflict.kind === 'archived'
			switch (key.name) {
				case 'c':
					if (key.ctrl !== true) break
					finish(null)
					return
				case 'q':
				case 'escape':
					finish(null)
					return
				case 'up':
				case 'k':
					scroll--
					break
				case 'down':
				case 'j':
					scroll++
					break
				case 'pageup':
					scroll -= page
					break
				case 'pagedown':
				case 'space':
					scroll += page
					break
				case 'left':
				case 'h':
					current = Math.max(current - 1, 0)
					scroll = 0
					break
				case 'right':
				case 'l':
				case 'tab':
					current = Math.min(current + 1, questions.length - 1)
					scroll = 0
					break
				case 'o':
				case 't':
					if (archived) note = 'this one is a or r'
					else choose(question, key.name === 'o' ? 'ours' : 'theirs')
					break
				case 'a':
				case 'r':
					if (!archived) note = 'this one is o or t'
					else choose(question, key.name === 'a' ? 'keep' : 'restore')
					break
				case 'return': {
					const left = questions.length - chosen.size
					if (left === 0) {
						finish(answersOf())
						return
					}
					note = `${left} still to choose`
					break
				}
			}
			draw()
		}

		emitKeypressEvents(stdin)
		stdin.setRawMode(true)
		stdin.resume()
		// A crash mid-screen must not leave the cursor hidden.
		process.on('exit', restore)
		// What was on screen scrolls into the scrollback, and the last frame stays after exit.
		stdout.write('\n'.repeat(stdout.rows ?? 24))
		stdout.write('[?25l')
		stdin.on('keypress', onKey)
		stdout.on('resize', draw)
		draw()
	})
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

	report(id, await resolveConflict(paths, branch, id, choicesFrom(answers)).catch(refuse))
}

const report = (id: string, result: Resolution): void => {
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
