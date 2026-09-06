#!/usr/bin/env node
// Coverage may not drop, per package (BUILD-PLAN.md 7.2, ADR 0014). Vitest only
// offers a fixed threshold, and a fixed threshold invites tests written to reach
// the number — so the comparison lives here, against a committed baseline.
//
// Integration coverage counts, because the integration project runs in the same
// process. The one exception is the packed-binary smoke test, which runs a
// subprocess v8 cannot see; that is the smoke test's job, not the ratchet's.
import { readFileSync, writeFileSync } from 'node:fs'

const SUMMARY = 'coverage/coverage-summary.json'
const BASELINE = 'coverage-baseline.json'
// A types-and-Zod package produces tests written to reach a number (STRUCTURE.md).
const EXCLUDED = new Set(['schema', 'tsconfig'])
const DROP_TOLERANCE = 0.01
// Below this the baseline is stale and has to be refreshed in the same commit,
// or a rise today silently pays for a fall tomorrow.
const RISE_TOLERANCE = 1

const percentages = (summary) => {
	const totals = new Map()
	for (const [file, data] of Object.entries(summary)) {
		// `apps/` as well as `packages/`: the dashboard is source like any other,
		// and a group this misses is a group with no floor that still reads green.
		const name = file.replaceAll('\\', '/').match(/\/(?:packages|apps)\/([^/]+)\//)?.[1]
		if (!name || EXCLUDED.has(name)) continue
		const running = totals.get(name) ?? { covered: 0, total: 0 }
		running.covered += data.lines.covered
		running.total += data.lines.total
		totals.set(name, running)
	}
	return Object.fromEntries(
		[...totals]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, { covered, total }]) => [
				name,
				total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)),
			]),
	)
}

let summary
try {
	summary = JSON.parse(readFileSync(SUMMARY, 'utf8'))
} catch {
	console.error(`${SUMMARY} is missing. Run: pnpm test --coverage`)
	process.exit(1)
}

const current = percentages(summary)

if (process.argv.includes('--update')) {
	writeFileSync(BASELINE, `${JSON.stringify(current, null, '\t')}\n`)
	console.log(`${BASELINE} updated:`, current)
	process.exit(0)
}

let baseline
try {
	baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
	console.error(`${BASELINE} is missing. Run: pnpm coverage:update`)
	process.exit(1)
}

const failures = []
for (const [name, pct] of Object.entries(current)) {
	const was = baseline[name]
	if (was === undefined) {
		failures.push(`${name}: new package at ${pct}% — run pnpm coverage:update`)
	} else if (pct < was - DROP_TOLERANCE) {
		failures.push(`${name}: ${was}% -> ${pct}% — coverage dropped`)
	} else if (pct > was + RISE_TOLERANCE) {
		failures.push(`${name}: ${was}% -> ${pct}% — run pnpm coverage:update and commit it`)
	} else {
		console.log(`${name}: ${pct}% (baseline ${was}%)`)
	}
}

for (const gone of Object.keys(baseline).filter((name) => !(name in current))) {
	failures.push(`${gone}: in the baseline but not in this run — run pnpm coverage:update`)
}

if (failures.length > 0) {
	console.error(`\n${failures.join('\n')}`)
	process.exit(1)
}
