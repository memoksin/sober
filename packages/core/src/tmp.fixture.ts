import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'

// A root that removes itself when the test ends. Without it every run leaves
// its worlds in $TMPDIR — thousands of them accumulated before this existed.
export async function tmpRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix))
	onTestFinished(() => rm(root, { recursive: true, force: true }))
	return root
}
