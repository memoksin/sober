import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { init, openBoard } from './board.js'
import { dismiss, open, reopen } from './flag.js'
import { widen } from './name.js'
import { bold, columns, dim, fail, say } from './out.js'
import { listConflicts, resolve } from './resolve.js'
import { accept, acceptGreen, archive, reject, review } from './review.js'
import { status } from './status.js'
import { sync } from './sync.js'
import { assign, claim, contributors, release } from './team.js'
import { answer, approve, bind, brief, decide, decisions, edit, logs, run, stop } from './work.js'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

/**
 * `PR-00-04`: one sentence, seven or eight words, saying what SOBER is. It is
 * the first thing a person reads and the only line that has to land with no
 * context at all.
 */
const WHAT_IT_IS = 'SOBER plans work as a graph, then dispatches agents.'

/**
 * Grouped by purpose (`PR-00-03`), because a flat list of thirteen commands
 * makes the reader work out the order for themselves. The groups are the order
 * of the loop.
 */
const GROUPS: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
	[
		'Start here',
		[
			['init', 'create the board in this repository'],
			['status [node]', 'the board, and what can start now'],
		],
	],
	[
		'Decide',
		[
			['decisions', 'every decision still waiting on you'],
			['decide <id> <option>', 'answer one, and unblock what it holds'],
			['edit <id> <option>', 'change an answer — it shows what that reaches first'],
			['edit <id> <option> --anyway', 'apply it'],
			['bind <node> --decisions <ids>', 'say which decisions hold a node'],
		],
	],
	[
		'Prepare',
		[
			['brief <node>', 'read the brief an agent will work from'],
			['approve <node>', 'approve it — nothing runs without this'],
		],
	],
	[
		'Build',
		[
			['run <node...>', 'start the agent in the node’s own worktree'],
			['run <node> --anyway', 'start it even though it meets another node’s files'],
			['run <node> --watch', 'start it so you can read it and answer it as it works'],
			['stop <node>', 'stop it; the work stays where it is'],
			['logs <node>', 'what the agent said, from the last run'],
			['say <node> -m "…"', 'answer a run you are watching'],
			['say <node> -m "…" --done', 'answer it and let the session finish'],
		],
	],
	[
		'Review',
		[
			['review <node>', 'the scan, the criteria, and the diff'],
			['accept <node>', 'land it — merge, and the node is done'],
			['accept --green', 'land every node whose checks are all clean'],
			['reject <node> -m "…"', 'send it back with what was wrong'],
		],
	],
	[
		'Share',
		[
			['sync [--no-push]', 'take in the team’s board, then send yours'],
			['resolve [record] [field=side]', 'answer what the merge could not'],
		],
	],
	[
		'Team',
		[
			['contributors [add|remove] <handle>', 'who is on this project'],
			['assign <node> [handle]', 'hand a node to someone, or to nobody'],
			['claim <node>', 'say you are on it — a signal, never a lock'],
			['release <node>', 'give it back'],
		],
	],
	[
		'When a decision moved',
		[
			['dismiss <node> -m "…"', 'the answer changed and this node is fine anyway'],
			['reopen <node>', 'un-finish it, so it can run again'],
			['open --title "…"', 'a new node carrying the fix'],
		],
	],
	['Tidy', [['archive <node>', 'take it off the board, keep its record']]],
	['On a screen', [['dashboard', 'serve the board in a browser — Ctrl-C stops it and its runs']]],
	['In a session', [['mcp', 'serve SOBER’s tools to a host — the plugin starts this']]],
]

const help = (): void => {
	say(WHAT_IT_IS)
	say()
	say(`${bold('usage')}  sober <command> [options]`)
	for (const [group, commands] of GROUPS) {
		say()
		say(bold(group))
		say(columns(commands.map(([name, what]) => [`  ${name}`, dim(what)])).join('\n'))
	}
	say()
	say(dim('Planning happens in your own agent session, through the SOBER plugin.'))
	say(dim('Every command here works headless, for hosts that have no plugin.'))
}

/** The commands whose first positional is a node or a decision on the board. */
const NAMES_A_RECORD = new Set([
	'status',
	'decide',
	'edit',
	'bind',
	'brief',
	'approve',
	'run',
	'stop',
	'logs',
	'say',
	'review',
	'accept',
	'reject',
	'resolve',
	'assign',
	'claim',
	'release',
	'archive',
	'dismiss',
	'reopen',
])

const options = {
	title: { type: 'string' },
	intent: { type: 'string' },
	base: { type: 'string' },
	message: { type: 'string', short: 'm' },
	why: { type: 'string' },
	write: { type: 'string' },
	decisions: { type: 'string' },
	'depends-on': { type: 'string' },
	queue: { type: 'boolean' },
	anyway: { type: 'boolean' },
	watch: { type: 'boolean' },
	done: { type: 'boolean' },
	'no-push': { type: 'boolean' },
	name: { type: 'string' },
	role: { type: 'string' },
	focus: { type: 'string' },
	clean: { type: 'boolean' },
	green: { type: 'boolean' },
	diff: { type: 'boolean' },
	port: { type: 'string' },
	version: { type: 'boolean', short: 'v' },
	help: { type: 'boolean', short: 'h' },
} as const

const main = async (): Promise<void> => {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options,
		allowPositionals: true,
	})
	const [command, ...positional] = positionals
	let rest = positional

	if (values.version === true) return say(version)
	// `sober` with no arguments and `sober --help` print the same thing
	// (`PR-00-02`): a person who has never opened a terminal follows one of them.
	if (command === undefined || values.help === true) return help()

	const need = (what: string): string => rest[0] ?? fail(`which ${what}? try \`sober --help\``)

	// One place, because every command that names a record reads it from the
	// same array (M2 gate finding 7). `run` names as many as you give it; the
	// rest name one and then say something else — a handle, a field, a reason.
	if (NAMES_A_RECORD.has(command) && rest.length > 0) {
		const paths = await openBoard()
		const widened = await widen(paths, command === 'run' ? rest : rest.slice(0, 1))
		rest = [...widened, ...rest.slice(widened.length)]
	}

	switch (command) {
		case 'init':
			return init({ title: values.title, intent: values.intent })
		case 'status':
			return status(rest[0])
		case 'decisions':
			return decisions()
		case 'decide': {
			const id = need('decision')
			const option = rest[1] ?? fail(`which option? \`sober decisions\` lists them`)
			return decide(id, option, values.why)
		}
		case 'edit': {
			const id = need('decision')
			const option = rest[1] ?? fail(`which option? \`sober decisions\` lists them`)
			return edit(id, option, values.why, values.anyway === true)
		}
		case 'bind': {
			const node = need('node')
			if (values.decisions === undefined && values['depends-on'] === undefined)
				fail('bind what? --decisions <ids> and --depends-on <ids>, comma separated')
			return bind(node, values.decisions, values['depends-on'])
		}
		case 'brief':
			return brief(need('node'), values.write)
		case 'approve':
			return approve(need('node'), values.queue === true)
		case 'run':
			if (rest.length === 0) fail('which node? `sober status` shows what is ready')
			return run(rest, values.base, values.anyway === true, values.watch === true)
		case 'say': {
			const node = need('node')
			const text = values.message ?? fail('say what to tell it: sober say <node> -m "…"')
			return answer(node, text, values.done === true)
		}
		case 'stop':
			return stop(need('node'))
		case 'logs':
			return logs(need('node'))
		case 'review':
			return review(need('node'), values.base, values.diff === true)
		case 'accept':
			return values.green === true ? acceptGreen(values.base) : accept(need('node'), values.base)
		case 'reject': {
			const node = need('node')
			const text = values.message ?? fail('say what was wrong: sober reject <node> -m "…"')
			return reject(node, text, values.clean === true, values.base)
		}
		case 'sync':
			return sync(values['no-push'] === true)
		case 'resolve':
			return rest.length === 0 ? listConflicts() : resolve(rest[0] as string, rest.slice(1))
		case 'contributors':
			return contributors(rest[0], rest[1], {
				name: values.name,
				role: values.role,
				focus: values.focus,
			})
		case 'assign':
			return assign(need('node'), rest[1] ?? null)
		case 'claim':
			return claim(need('node'))
		case 'release':
			return release(need('node'))
		case 'dismiss': {
			const node = need('node')
			const reason = values.message ?? fail('say why it is fine: sober dismiss <node> -m "…"')
			return dismiss(node, reason)
		}
		case 'reopen':
			return reopen(need('node'))
		case 'open': {
			const title = values.title ?? fail('what is it? sober open --title "…"')
			return open(title, { decisions: values.decisions, dependsOn: values['depends-on'] })
		}
		case 'archive':
			return archive(need('node or decision'))
		case 'dashboard': {
			// Imported here rather than at the top so that every other command
			// pays nothing for a server it does not start.
			const { dashboard } = await import('./dashboard.js')
			return dashboard(values.port === undefined ? undefined : Number(values.port))
		}
		case 'mcp': {
			// The MCP server ships as a subcommand, not a second package: one
			// install, one version, one changelog (ADR 0007). It speaks over
			// stdio, so nothing after this line may write to stdout.
			const { serve } = await import('@besober/mcp')
			return serve()
		}
		default:
			return fail(`there is no \`sober ${command}\`. \`sober --help\` lists what there is.`)
	}
}

await main()
