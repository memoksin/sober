import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { answerDecision } from './decide.js'
import { editDecision } from './impact.js'
import type { Paths } from './paths.js'
import { aDecision } from './records.fixture.js'
import { readDecision, writeDecision } from './records.js'
import { tmpRoot } from './tmp.fixture.js'

let paths: Paths

beforeEach(async () => {
	const root = await tmpRoot('sober-decide-')
	paths = (await initBoard(root, { title: 'Acme', intent: '', constraints: [] })).paths
})

const answerOf = async (id: string) => {
	const record = await readDecision(paths, id)
	return record.kind === 'ok' ? record.value.answer : null
}

/**
 * ADR 0055. The provenance is on the decision because whoever answers is
 * usually not whoever opened it — so it has to survive the gap between the two,
 * and the only thing that spans it is the record.
 */
test('an answer carries where the options were read from, when they were read off the repository', async () => {
	await writeDecision(paths, 'auth-model-k7f2', aDecision({ derived: 'docs/adr/0012-state.md' }))

	await answerDecision(paths, 'auth-model-k7f2', { option: 'redis', by: 'memoksin' })

	expect(await answerOf('auth-model-k7f2')).toMatchObject({
		option: 'redis',
		derived: 'docs/adr/0012-state.md',
	})
})

test('a decision nobody derived answers with no provenance rather than an empty one', async () => {
	await writeDecision(paths, 'auth-model-k7f2', aDecision({}))

	await answerDecision(paths, 'auth-model-k7f2', { option: 'redis', by: 'memoksin' })

	expect((await answerOf('auth-model-k7f2'))?.derived).toBeNull()
})

test('an edit drops the provenance — it is a person changing their mind, not a reading of the code', async () => {
	await writeDecision(paths, 'auth-model-k7f2', aDecision({ derived: 'docs/adr/0012-state.md' }))
	await answerDecision(paths, 'auth-model-k7f2', { option: 'redis', by: 'memoksin' })

	await editDecision(paths, 'auth-model-k7f2', {
		option: 'cookie',
		by: 'memoksin',
		anyway: true,
	})

	expect(await answerOf('auth-model-k7f2')).toMatchObject({ option: 'cookie', derived: null })
})
