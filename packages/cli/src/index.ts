import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { init } from './board.js'
import { bold, columns, dim, fail, say } from './out.js'
import { accept, archive, reject, review } from './review.js'
import { status } from './status.js'
import { sync } from './sync.js'
import { approve, bind, brief, decide, decisions, logs, run, stop } from './work.js'

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
			['stop <node>', 'stop it; the work stays where it is'],
			['logs <node>', 'what the agent said, from the last run'],
		],
	],
	[
		'Review',
		[
			['review <node>', 'the scan, the criteria, and the diff'],
			['accept <node>', 'land it — merge, and the node is done'],
			['reject <node> -m "…"', 'send it back with what was wrong'],
		],
	],
	['Share', [['sync [--no-push]', 'take in the team’s board, then send yours']]],
	['Tidy', [['archive <node>', 'take it off the board, keep its record']]],
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
	'no-push': { type: 'boolean' },
	clean: { type: 'boolean' },
	diff: { type: 'boolean' },
	version: { type: 'boolean', short: 'v' },
	help: { type: 'boolean', short: 'h' },
} as const

const main = async (): Promise<void> => {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options,
		allowPositionals: true,
	})
	const [command, ...rest] = positionals

	if (values.version === true) return say(version)
	// `sober` with no arguments and `sober --help` print the same thing
	// (`PR-00-02`): a person who has never opened a terminal follows one of them.
	if (command === undefined || values.help === true) return help()

	const need = (what: string): string => rest[0] ?? fail(`which ${what}? try \`sober --help\``)

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
			return run(rest, values.base)
		case 'stop':
			return stop(need('node'))
		case 'logs':
			return logs(need('node'))
		case 'review':
			return review(need('node'), values.base, values.diff === true)
		case 'accept':
			return accept(need('node'), values.base)
		case 'reject': {
			const node = need('node')
			const text = values.message ?? fail('say what was wrong: sober reject <node> -m "…"')
			return reject(node, text, values.clean === true, values.base)
		}
		case 'sync':
			return sync(values['no-push'] === true)
		case 'archive':
			return archive(need('node or decision'))
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
