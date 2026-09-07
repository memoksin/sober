import { readFile } from 'node:fs/promises'

/**
 * The one place outside `core` that reads a file, and the reason it is allowed
 * to is that it is not reading the board.
 *
 * ADR 0008's rule — only `core` touches the filesystem — is about storage
 * ownership: the board's records have one owner so that two surfaces cannot
 * disagree about what is on disk. A path the user typed as an argument is not
 * the board; it is this surface's own input, the way `process.stdin` is.
 *
 * It lives alone in its own module so that the exemption in
 * `.dependency-cruiser.cjs` can name one file rather than a whole command, and
 * so that the next `readFile` someone adds to `work.ts` is still a red build.
 */
export const source = async (from: string): Promise<string> => {
	if (from !== '-') return readFile(from, 'utf8')

	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
	return Buffer.concat(chunks).toString('utf8')
}
