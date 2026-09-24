import type { ARCHIVE_FIELD, Choices, Conflict } from '@besober/core'

// Typed against core's constant so a rename there fails here, without pulling
// core's runtime into the browser bundle.
const ARCHIVE: typeof ARCHIVE_FIELD = 'record'

export interface Pick {
	readonly value: 'ours' | 'theirs' | 'keep' | 'restore'
	readonly label: string
	/** What choosing it gives: a field's value, or what happens to the record. */
	readonly shows: string
}

/** One question on the form: a field, or the single archive question. */
export interface Row {
	readonly field: string
	readonly picks: readonly [Pick, Pick]
}

export const rowsOf = (conflict: Conflict): readonly Row[] =>
	conflict.kind === 'archived'
		? [
				{
					field: ARCHIVE,
					picks: [
						{
							value: 'keep',
							label: 'keep',
							shows: `stays archived, as ${conflict.by === 'ours' ? 'you' : 'the remote'} did`,
						},
						{
							value: 'restore',
							label: 'restore',
							shows: `comes back with the edits made ${conflict.by === 'ours' ? 'on the remote' : 'here'}`,
						},
					],
				},
			]
		: conflict.fields.map(({ field, ours, theirs }) => ({
				field,
				picks: [
					{ value: 'ours', label: 'ours', shows: ours },
					{ value: 'theirs', label: 'theirs', shows: theirs },
				],
			}))

/** The questions on this record still without an answer. */
export const unanswered = (rows: readonly Row[], choices: Choices): readonly string[] =>
	rows.filter((row) => choices[row.field] === undefined).map((row) => row.field)
