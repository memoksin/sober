import { basename } from 'node:path'
import {
	adoptBoard,
	applySetting,
	createBoardBranch,
	currentBranch,
	detectSetup,
	findRoot,
	initBoard,
	isRepo,
	loadBoard,
	migrateBoard,
	type Paths,
	readConfig,
	readProject,
	paths as resolve,
} from '@besober/core'
import { bold, columns, dim, fail, green, refuse, say, yellow } from './out.js'

/**
 * Every command but `init` starts here: a board, found from wherever you stand,
 * and brought forward if it was written by an older SOBER (D42, §8.5). A newer
 * board is refused here — a version that does not understand a field drops it
 * on the next write, and on a shared board that is everyone's data.
 */
export const openBoard = async (): Promise<Paths> => {
	const root = findRoot(process.cwd())
	if (root === null)
		return fail('there is no board here — run `sober init` at the root of your repository')

	const paths = resolve(root)
	const migrated = await migrateBoard(paths).catch(refuse)
	if (migrated.kind === 'migrated')
		say(
			`${yellow('·')} board brought forward from schema ${migrated.from} to ${migrated.to} — ${migrated.records} record${migrated.records === 1 ? '' : 's'} rewritten, sync to share it`,
		)
	return paths
}

export const settingsOf = async (paths: Paths) => {
	const config = await readConfig(paths)
	if (config.kind !== 'ok') return fail(`${config.file} cannot be read: ${config.reason}`)
	return config.value
}

/** The ref a node is cut from and measured against, unless the user names another. */
export const baseOf = async (paths: Paths, given?: string): Promise<string> =>
	given ?? (await currentBranch(paths.root))

export const init = async (options: { title?: string; intent?: string }): Promise<void> => {
	const root = process.cwd()
	if (!(await isRepo(root)))
		return fail('this is not a git repository — SOBER plans work that git tracks')

	// A second person clones the repository and runs the same command. The board
	// is already on its branch, so init takes it rather than writing a second
	// project record — which is the one way a team ends up with two boards for
	// one repository (DESIGN §1.2).
	if ((await readProject(resolve(root))).kind === 'missing') {
		const paths = resolve(root)
		const branch = (await settingsOf(paths)).board.branch
		const adopted = await adoptBoard(paths, branch).catch(refuse)
		if (adopted !== null) return joined(branch, adopted)
	}

	const { paths, created } = await initBoard(root, {
		title: options.title ?? basename(root),
		intent: options.intent ?? '',
		constraints: [],
	})
	if (!created) {
		say(`${yellow('·')} there is already a board here — nothing was changed`)
		return
	}

	// PR-00-06: a default that can be detected is written in concretely, with
	// its comment above it. The user corrects one line instead of writing one.
	const setup = await detectSetup(root)
	if (setup !== null) await applySetting(paths, ['dispatch', 'setup'], setup)

	const settings = await settingsOf(paths)
	const branch = await createBoardBranch(root, settings.board.branch)

	say(`${green('✓')} the board is ready`)
	say()
	say(
		columns([
			['  .sober/', dim('the board — one file per node and decision')],
			['  .sober/config.jsonc', dim('every setting, with the reason for each')],
			['  .gitignore', dim('the entries the board depends on')],
			['  .gitattributes', dim('so no conflict marker ever lands in a record')],
			[
				`  ${settings.board.branch}`,
				dim(branch ? 'the branch the board travels on' : 'was already here'),
			],
		]).join('\n'),
	)
	say()
	if (setup === null) {
		say(
			`${yellow('·')} ${bold('dispatch.setup')} is empty. It is the command that prepares a fresh`,
		)
		say('  worktree — without it an agent cannot build or test what it writes.')
	} else {
		say(`${bold('dispatch.setup')} was detected as ${bold(setup)}. Correct it if that is wrong.`)
	}
	say()
	say(
		`Next: open a session and say what you want built, or ${bold('sober status')} to see the board.`,
	)
}

/** The other half of `init`: the board was already made, by someone else. */
const joined = (branch: string, records: number): void => {
	say(`${green('✓')} the team’s board is here`)
	say()
	say(
		columns([
			['  .sober/', dim(`${records} records, taken from ${branch}`)],
			['  .gitignore', dim('the entries the board depends on')],
			['  .gitattributes', dim('so no conflict marker ever lands in a record')],
		]).join('\n'),
	)
	say()
	say(`Next: ${bold('sober status')} to see what the team is building.`)
}

/** A board that cannot be read whole is said out loud, never rendered as empty (§8.4). */
export const readBoard = async (paths: Paths) => {
	const board = await loadBoard(paths)
	for (const broken of board.broken)
		process.stderr.write(`${yellow('!')} ${broken.file}: ${broken.reason}\n`)
	return board
}
