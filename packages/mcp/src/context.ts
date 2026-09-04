import { findRoot, type Paths, paths as resolve, SoberError } from '@besober/core'

export class NoBoardError extends SoberError {
	constructor() {
		super(
			'no-board',
			'there is no board in this repository yet — the `init` tool makes one, at the root',
		)
	}
}

/** Every tool but `init` starts here: the board found from where the host started us. */
export const openBoard = async (cwd: string): Promise<Paths> => {
	const root = findRoot(cwd)
	if (root === null) throw new NoBoardError()
	return resolve(root)
}

export interface ToolResult {
	[extra: string]: unknown
	content: { type: 'text'; text: string }[]
	isError?: boolean
}

export const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] })

/**
 * A refusal is an answer, not a crash: the model reads it and tells the human
 * what to do instead (§8.7). Anything that is not one of SOBER's own errors
 * still comes back as text, because a thrown error inside a tool reaches the
 * user as a protocol failure with no sentence in it.
 */
export const refusal = (error: unknown): ToolResult => ({
	content: [
		{
			type: 'text',
			text:
				error instanceof SoberError ? error.message : String((error as Error)?.message ?? error),
		},
	],
	isError: true,
})

export const tool =
	<A extends unknown[]>(run: (...args: A) => Promise<ToolResult>) =>
	async (...args: A): Promise<ToolResult> => {
		try {
			return await run(...args)
		} catch (error) {
			return refusal(error)
		}
	}
