import {
	ARCHIVE_FIELD,
	type Choices,
	type Conflict,
	readConfig,
	resolveConflict,
	sync,
} from '@besober/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { askFields } from '../ask.js'
import { openBoard, text, tool } from '../context.js'

/** A value the host has to render inside a collapsed enum: short, or not read. */
const short = (value: string): string => (value.length > 60 ? `${value.slice(0, 57)}…` : value)

const formFor = (conflict: Conflict) =>
	conflict.kind === 'archived'
		? [
				{
					name: ARCHIVE_FIELD,
					title: `${conflict.id} was archived while it was edited`,
					choices: [
						{ id: 'keep', label: 'Keep it archived' },
						{ id: 'restore', label: 'Put it back, with the edit' },
					],
				},
			]
		: conflict.fields.map((field) => ({
				name: field.field,
				title: field.field,
				choices: [
					{ id: 'ours', label: short(field.ours) },
					{ id: 'theirs', label: short(field.theirs) },
				],
			}))

/**
 * The board travels, and the one question it can ask is put to the human here
 * (ADR 0010). The values are written into the conversation first, because a
 * host truncates a label rather than wrapping it — the form is where the choice
 * is made, not where it is read.
 */
export const registerSync = (server: McpServer, cwd: string): void => {
	server.registerTool(
		'sync',
		{
			title: 'Exchange the board with the team',
			description:
				'Takes in the team’s board and sends yours. Records only one side changed merge with no question. A record both sides changed is put to the human, field by field, and nothing is chosen for them.',
			inputSchema: {},
		},
		tool(async () => {
			const paths = await openBoard(cwd)
			const config = await readConfig(paths)
			if (config.kind !== 'ok') return text(`${config.file} cannot be read: ${config.reason}`)
			const branch = config.value.board.branch

			const first = await sync(paths, branch)
			if (first.kind === 'no-remote')
				return text('The board was committed here. This repository has no remote to send it to.')
			if (first.kind === 'invalid') return text(blocked(first.findings))
			if (first.kind !== 'conflicted') return text(landed(first.pulled.updated.length))

			// Every conflicted record, one form each, in the order they were
			// found. The human answers or dismisses; a dismissal stops the merge
			// and leaves every record exactly where it was.
			const lines: string[] = ['Records both of you changed:', '']
			for (const conflict of first.conflicts) lines.push(describe(conflict))
			lines.push('')

			for (const conflict of first.conflicts) {
				const answers = await askFields(
					server.server,
					'resolve this merge',
					`${conflict.id}: which version wins?`,
					formFor(conflict),
				)
				if (answers === null)
					return text(
						`${lines.join('\n')}You stopped at ${conflict.id}. Nothing was merged, and your edits are still here. Run sync again when you want to answer.`,
					)
				const result = await resolveConflict(paths, branch, conflict.id, answers as Choices)
				if (result.kind === 'done')
					return text(
						result.findings.length > 0
							? `${lines.join('\n')}${blocked(result.findings)}`
							: `${lines.join('\n')}Every record was decided by you and the merge landed. Sync again to send it.`,
					)
			}
			return text(`${lines.join('\n')}Answered. Sync again to send it.`)
		}),
	)
}

const describe = (conflict: Conflict): string =>
	conflict.kind === 'archived'
		? `- ${conflict.id}: archived on one side, edited on the other.`
		: conflict.fields
				.map(
					(field) => `- ${conflict.id}.${field.field}: ours ${field.ours} / theirs ${field.theirs}`,
				)
				.join('\n')

const landed = (count: number): string =>
	count === 0
		? 'Nothing came in, and your board went out.'
		: `${count} records came in, and your board went out.`

const blocked = (findings: readonly string[]): string =>
	`The merge landed here, but the board it made does not hold together:\n${findings
		.map((finding) => `- ${finding}`)
		.join('\n')}\nNothing went out. Fix these and sync again — nothing is lost.`
