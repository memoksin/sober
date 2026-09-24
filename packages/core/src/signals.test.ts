import { expect, test } from 'vitest'
import { addedLines } from './diff.js'
import { signalsIn } from './signals.js'

const diff = (path: string, ...lines: string[]): string =>
	`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines
		.map((line) => `+${line}`)
		.join('\n')}\n`

const signalsFor = (path: string, line: string, declared: readonly string[] = ['**']) =>
	signalsIn(addedLines(diff(path, line)), declared).map((finding) => finding.signal)

test('a diff outside the node’s declared files is a finding, not a refusal', () => {
	// The list is a prediction (§3.1). It earns its place in the review rather
	// than as a gate before the work runs.
	expect(signalsFor('src/billing.ts', 'const x = 1', ['src/auth/**'])).toEqual(['undeclared-file'])
	expect(signalsFor('src/auth/token.ts', 'const x = 1', ['src/auth/**'])).toEqual([])
})

test('a node that declares no files reports nothing about files', () => {
	expect(signalsIn(addedLines(diff('anything.ts', 'const x = 1')), [])).toEqual([])
})

test('a manifest or a lockfile changing is a dependency signal', () => {
	expect(signalsFor('package.json', '  "left-pad": "^1.0.0"')).toContain('dependency-added')
	expect(signalsFor('pnpm-lock.yaml', '  left-pad: 1.0.0')).toContain('dependency-added')
	expect(signalsFor('apps/api/go.sum', 'example.com/x v1.0.0')).toContain('dependency-added')
	expect(signalsFor('src/package.json.d.ts', 'export {}')).not.toContain('dependency-added')
})

test('code built and executed at runtime is a signal, in any language', () => {
	expect(signalsFor('a.js', 'eval(payload)')).toContain('dynamic-code')
	expect(signalsFor('a.js', 'const f = new Function("return 1")')).toContain('dynamic-code')
	expect(signalsFor('a.py', 'exec("print(1)")')).toContain('dynamic-code')
	expect(signalsFor('a.ts', 'const evaluation = total * 2')).not.toContain('dynamic-code')
})

test('a shell command built from a variable is a signal; a literal one is not', () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the fixture
	expect(signalsFor('a.js', 'execSync(`rm -rf ' + '${dir}`)')).toContain('shell-from-variable')
	expect(signalsFor('a.py', 'subprocess.run(f"ls {path}", shell=True)')).toContain(
		'shell-from-variable',
	)
	expect(signalsFor('a.js', 'execSync("pnpm install")')).not.toContain('shell-from-variable')
})

test('TLS verification being turned off is a signal', () => {
	expect(signalsFor('a.js', 'const agent = new Agent({ rejectUnauthorized: false })')).toContain(
		'tls-disabled',
	)
	expect(signalsFor('a.py', 'requests.get(url, verify=False)')).toContain('tls-disabled')
	expect(signalsFor('a.go', 'tls.Config{InsecureSkipVerify: true}')).toContain('tls-disabled')
	expect(signalsFor('a.js', 'const agent = new Agent({ rejectUnauthorized: true })')).not.toContain(
		'tls-disabled',
	)
})

test('a call to a hardcoded address is a signal, and localhost is not one', () => {
	expect(signalsFor('a.ts', 'fetch("https://collector.example-metrics.io/v1")')).toContain(
		'hardcoded-address',
	)
	expect(signalsFor('a.ts', 'fetch("http://10.0.0.7:9000/ingest")')).toContain('hardcoded-address')
	expect(signalsFor('a.ts', 'fetch("http://localhost:3000/api")')).not.toContain(
		'hardcoded-address',
	)
	expect(signalsFor('a.ts', 'fetch("http://127.0.0.1:3000/api")')).not.toContain(
		'hardcoded-address',
	)
})

test('a finding carries the line number in the file, not in the diff', () => {
	const patch = `--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -40,0 +41,2 @@\n+const a = 1\n+eval(payload)\n`
	expect(signalsIn(addedLines(patch), ['**'])).toEqual([
		{
			signal: 'dynamic-code',
			file: 'src/auth.ts',
			line: 42,
			message: 'code is built and executed at runtime',
		},
	])
})
