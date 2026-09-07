import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { ATTRIBUTES_BLOCK, ensureAttributes } from './board.js'
import { tmpRoot } from './tmp.fixture.js'

const attributes = async (root: string): Promise<string> =>
	readFile(join(root, '.gitattributes'), 'utf8')

test('a repository with no attributes file gets the whole block', async () => {
	const root = await tmpRoot('sober-attributes-')

	await ensureAttributes(root)

	expect(await attributes(root)).toContain('.sober/nodes/*.json merge=binary -text')
	expect(await attributes(root)).toContain('.sober/distribution.json merge=binary -text')
})

/**
 * The list grows. `.sober/distribution.json` was the first board file added
 * after `init` existed (ADR 0051), and a block written once would have left
 * every board created before it with git line-merging the one file nobody
 * thought to check.
 */
test('a repository holding an older block gains only the lines it is missing', async () => {
	const root = await tmpRoot('sober-attributes-')
	const older = ATTRIBUTES_BLOCK.split('\n')
		.filter((line) => !line.includes('distribution'))
		.join('\n')
	await writeFile(join(root, '.gitattributes'), `* text=auto eol=lf\n\n${older}`)

	await ensureAttributes(root)

	const written = await attributes(root)
	expect(written).toContain('.sober/distribution.json merge=binary -text')
	// Once each: the lines already there are not written a second time.
	expect(written.match(/\.sober\/nodes\/\*\.json/g)).toHaveLength(1)
	expect(written).toContain('* text=auto eol=lf')
})

test('a repository already holding every line is left exactly as it is', async () => {
	const root = await tmpRoot('sober-attributes-')
	await writeFile(join(root, '.gitattributes'), `# mine\n\n${ATTRIBUTES_BLOCK}`)

	await ensureAttributes(root)

	expect(await attributes(root)).toBe(`# mine\n\n${ATTRIBUTES_BLOCK}`)
})
