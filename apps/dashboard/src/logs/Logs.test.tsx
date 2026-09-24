import { type LogLineInput, LogWindow } from '@besober/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Wire } from '../wire.js'
import { LogScreen } from './Logs.js'

afterEach(cleanup)

/**
 * A `Wire` whose watch hands over the windows a test names, and whose `op`
 * records what was sent. The channel is the thing under test here, so it is the
 * thing that is faked rather than the transport under it.
 */
const surfaceOf = (
	windows: readonly LogWindow[],
	options: { op?: Wire['op']; hold?: boolean } = {},
): Wire => ({
	read: () => Promise.reject(new Error('the log screen reads nothing')),
	op: options.op ?? ((() => Promise.resolve({})) as Wire['op']),
	watch: (async (_name, _params, onMessage: (message: unknown) => void) => {
		for (const window of windows) onMessage(window)
		// A live run's channel stays open; a finished one's resolves, which is
		// what tells the screen the run has ended.
		if (options.hold === true) await new Promise(() => {})
	}) as Wire['watch'],
})

// Lines are written as a host writes them; the parse fills the fields they leave out.
const window = (
	over: Partial<Omit<LogWindow, 'lines'>> & { lines?: readonly LogLineInput[] } = {},
): LogWindow => LogWindow.parse({ lines: [], offset: 0, live: false, ...over })

test('a person reads what the agent said, without opening a terminal', async () => {
	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([
				window({
					lines: [
						{ kind: 'started', text: 'session started', tool: null },
						{ kind: 'tool', text: 'Write', tool: null },
						{ kind: 'text', text: 'wrote the auth middleware', tool: null },
					],
				}),
			])}
			onClose={() => {}}
		/>,
	)

	expect(await screen.findByText('wrote the auth middleware')).toBeTruthy()
	expect(screen.getByText('session started')).toBeTruthy()
	expect(screen.getByText('Write')).toBeTruthy()
})

test('windows arriving one after another append rather than replace', async () => {
	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([
				window({ lines: [{ kind: 'text', text: 'first', tool: null }], offset: 10, live: true }),
				window({ lines: [{ kind: 'text', text: 'second', tool: null }], offset: 20, live: false }),
			])}
			onClose={() => {}}
		/>,
	)

	// A tail that replaced its contents on every window would show only the
	// last thing said, which is the opposite of reading a run.
	expect(await screen.findByText('first')).toBeTruthy()
	expect(screen.getByText('second')).toBeTruthy()
})

test('a run still going says so, and one that ended says that instead', async () => {
	const { unmount } = render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([window({ live: true })], { hold: true })}
			onClose={() => {}}
		/>,
	)
	expect(await screen.findByText('running')).toBeTruthy()
	unmount()

	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([window({ live: false })])}
			onClose={() => {}}
		/>,
	)
	expect(await screen.findByText('the run has ended')).toBeTruthy()
})

test('a run that wrote nothing says so rather than showing an empty box', async () => {
	render(
		<LogScreen node="n-k7f2" surface={surfaceOf([window({ live: false })])} onClose={() => {}} />,
	)

	expect(await screen.findByText(/wrote nothing/i)).toBeTruthy()
})

test('a channel that refuses shows the server’s own words', async () => {
	const surface: Wire = {
		read: () => Promise.reject(new Error('nope')),
		op: (() => Promise.resolve({})) as Wire['op'],
		watch: () => Promise.reject(new Error('n has not run yet')),
	}

	render(<LogScreen node="n-k7f2" surface={surface} onClose={() => {}} />)

	expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'n has not run yet')
})

test('a live run can be answered, and the reply carries the node', async () => {
	const op = vi.fn(() => Promise.resolve({})) as unknown as Wire['op']
	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([window({ live: true })], { op, hold: true })}
			onClose={() => {}}
		/>,
	)

	const box = await screen.findByLabelText(/answer the run/i)
	fireEvent.change(box, { target: { value: 'use the second option' } })
	fireEvent.click(screen.getByText('Send'))

	await waitFor(() =>
		expect(op).toHaveBeenCalledWith('answer', {
			node: 'auth-api-k7f2',
			text: 'use the second option',
			done: false,
		}),
	)
})

test('finishing is a different act from sending, and says so on the wire', async () => {
	const op = vi.fn(() => Promise.resolve({})) as unknown as Wire['op']
	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([window({ live: true })], { op, hold: true })}
			onClose={() => {}}
		/>,
	)

	fireEvent.change(await screen.findByLabelText(/answer the run/i), {
		target: { value: 'that is everything' },
	})
	fireEvent.click(screen.getByText(/Send & finish/))

	// `done` closes the session's input so the run ends on its own. It is not
	// `stop`, which kills it — the difference between finishing a conversation
	// and hanging up on one.
	await waitFor(() =>
		expect(op).toHaveBeenCalledWith('answer', expect.objectContaining({ done: true })),
	)
})

test('a run that has ended cannot be answered, because nothing is listening', async () => {
	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([window({ live: false })])}
			onClose={() => {}}
		/>,
	)

	await screen.findByText('the run has ended')
	expect(screen.queryByLabelText(/answer the run/i)).toBeNull()
})

test('a refused answer says why, and keeps what was typed', async () => {
	const op = (() => Promise.reject(new Error('it is not running any more'))) as Wire['op']
	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([window({ live: true })], { op, hold: true })}
			onClose={() => {}}
		/>,
	)

	const box = await screen.findByLabelText(/answer the run/i)
	fireEvent.change(box, { target: { value: 'still there?' } })
	fireEvent.click(screen.getByText('Send'))

	expect(await screen.findByRole('alert')).toHaveProperty(
		'textContent',
		'it is not running any more',
	)
	// Losing what somebody typed because the send failed is how a person stops
	// trusting the box.
	expect((box as HTMLTextAreaElement).value).toBe('still there?')
})

test('Enter sends and Shift+Enter does not', async () => {
	const op = vi.fn(() => Promise.resolve({})) as unknown as Wire['op']
	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([window({ live: true })], { op, hold: true })}
			onClose={() => {}}
		/>,
	)

	const box = await screen.findByLabelText(/answer the run/i)
	fireEvent.change(box, { target: { value: 'go' } })
	fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
	expect(op).not.toHaveBeenCalled()

	fireEvent.keyDown(box, { key: 'Enter' })
	await waitFor(() => expect(op).toHaveBeenCalledTimes(1))
})

test('an empty answer is not sent', async () => {
	const op = vi.fn(() => Promise.resolve({})) as unknown as Wire['op']
	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([window({ live: true })], { op, hold: true })}
			onClose={() => {}}
		/>,
	)

	fireEvent.change(await screen.findByLabelText(/answer the run/i), {
		target: { value: '   ' },
	})
	fireEvent.keyDown(screen.getByLabelText(/answer the run/i), { key: 'Enter' })

	expect(op).not.toHaveBeenCalled()
})

test('prose is a line like any other', async () => {
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([
				window({
					lines: [
						{ kind: 'text', text: 'a paragraph', tool: null },
						{ kind: 'answer', text: 'the answer', tool: null },
						{ kind: 'tool', text: 'Read', tool: null },
					],
				}),
			])}
			onClose={() => {}}
		/>,
	)

	const prose = await screen.findByText('a paragraph')
	expect(prose.className).not.toContain('border')
	expect(prose.className).not.toContain('bg-[var(--surface)]')
	for (const text of ['a paragraph', 'Read']) {
		const row = screen.getByText(text).closest('li')
		expect(row?.tagName).toBe('LI')
		expect(row?.querySelector('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('true')
	}
	expect(
		screen.getByText('the answer').closest('li')?.querySelector('[aria-hidden]')?.textContent,
	).toBe('›')
})

test('f toggles full screen, and the button reflects it', async () => {
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([window({ live: true })], { hold: true })}
			onClose={() => {}}
		/>,
	)

	const dialog = await screen.findByRole('dialog')
	const toggle = screen.getByRole('button', { name: /enter full screen/i })
	expect(toggle.getAttribute('aria-pressed')).toBe('false')

	fireEvent.keyDown(dialog, { key: 'f' })
	expect(
		(await screen.findByRole('button', { name: /leave full screen/i })).getAttribute(
			'aria-pressed',
		),
	).toBe('true')

	fireEvent.click(screen.getByRole('button', { name: /leave full screen/i }))
	expect(
		(await screen.findByRole('button', { name: /enter full screen/i })).getAttribute(
			'aria-pressed',
		),
	).toBe('false')
})

test('Escape leaves full screen before it closes', async () => {
	const onClose = vi.fn()
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([window({ live: true })], { hold: true })}
			onClose={onClose}
		/>,
	)

	const dialog = await screen.findByRole('dialog')
	fireEvent.keyDown(dialog, { key: 'f' })
	await screen.findByRole('button', { name: /leave full screen/i })

	fireEvent.keyDown(dialog, { key: 'Escape' })
	expect(onClose).not.toHaveBeenCalled()
	await screen.findByRole('button', { name: /enter full screen/i })

	fireEvent.keyDown(dialog, { key: 'Escape' })
	expect(onClose).toHaveBeenCalledTimes(1)
})

test('keys are ignored while the answer box has focus', async () => {
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([window({ live: true })], { hold: true })}
			onClose={() => {}}
		/>,
	)

	const box = await screen.findByLabelText(/answer the run/i)
	fireEvent.change(box, { target: { value: 'f is not a shortcut here' } })
	fireEvent.keyDown(box, { key: 'f' })

	expect(
		screen.getByRole('button', { name: /enter full screen/i }).getAttribute('aria-pressed'),
	).toBe('false')
	expect((box as HTMLTextAreaElement).value).toBe('f is not a shortcut here')
})

test('/ opens find, which filters the transcript', async () => {
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([
				window({
					lines: [
						{ kind: 'text', text: 'wrote the auth middleware', tool: null },
						{ kind: 'tool', text: 'ls', tool: 'Bash' },
					],
				}),
			])}
			onClose={() => {}}
		/>,
	)

	const dialog = await screen.findByRole('dialog')
	await screen.findByText('wrote the auth middleware')
	fireEvent.keyDown(dialog, { key: '/' })

	const query = await screen.findByPlaceholderText(/filter the transcript/i)
	fireEvent.change(query, { target: { value: 'middleware' } })

	expect(screen.getByText('wrote the auth middleware')).toBeTruthy()
	expect(screen.queryByText('ls')).toBeNull()
})

test('the dots wave only while the run is live', async () => {
	const { unmount, container } = render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([window({ live: true })], { hold: true })}
			onClose={() => {}}
		/>,
	)
	await screen.findByText('running')
	expect(container.querySelectorAll('.sober-dot-wave').length).toBe(3)
	unmount()

	render(
		<LogScreen node="n-k7f2" surface={surfaceOf([window({ live: false })])} onClose={() => {}} />,
	)
	await screen.findByText('the run has ended')
	expect(document.querySelectorAll('.sober-dot-wave').length).toBe(0)
})

test('the model badge names the provider from the model id, not the host', async () => {
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([
				window({
					ran: {
						host: 'openrouter --model anthropic/claude-opus-5-5',
						tier: null,
						fallback: false,
					},
				}),
			])}
			onClose={() => {}}
		/>,
	)

	expect(await screen.findByText('Anthropic')).toBeTruthy()
	expect(screen.getByText('anthropic/claude-opus-5-5')).toBeTruthy()
	expect(screen.getByText(/via openrouter/)).toBeTruthy()
})

test('a scroll away from the bottom, then a new line, shows a pill that a click clears', async () => {
	let deliver: ((window: LogWindow) => void) | undefined
	const surface: Wire = {
		read: () => Promise.reject(new Error('unused')),
		op: (() => Promise.resolve({})) as Wire['op'],
		watch: (async (_name, _params, onMessage: (message: unknown) => void) => {
			deliver = onMessage as (window: LogWindow) => void
			onMessage(window({ lines: [{ kind: 'text', text: 'first', tool: null }], live: true }))
			await new Promise(() => {})
		}) as Wire['watch'],
	}

	render(<LogScreen node="n-k7f2" surface={surface} onClose={() => {}} />)
	await screen.findByText('first')

	const scroller = screen.getByText('first').closest('.overflow-y-auto') as HTMLDivElement
	Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
	Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true })
	Object.defineProperty(scroller, 'scrollTop', { value: 0, configurable: true, writable: true })
	fireEvent.scroll(scroller, { target: { scrollTop: 0 } })

	deliver?.(
		window({
			lines: [{ kind: 'text', text: 'second', tool: null }],
			live: true,
		}),
	)

	const pill = await screen.findByText(/1 new line ↓/)
	fireEvent.click(pill)
	await waitFor(() => expect(screen.queryByText(/new lines? ↓/)).toBeNull())
})

const markOf = (text: string): string | undefined =>
	screen.getByText(text).closest('li')?.querySelector('[aria-hidden]')?.className

test('a thinking line pulses only while it is the last line of a live run', async () => {
	const thinking = { kind: 'thinking', text: 'pondering', tool: null } as const
	const { unmount } = render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([window({ lines: [thinking], live: true })], { hold: true })}
			onClose={() => {}}
		/>,
	)
	await screen.findByText('pondering')
	expect(markOf('pondering')).toContain('animate-pulse')
	unmount()

	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf(
				[window({ lines: [thinking, { kind: 'text', text: 'said', tool: null }], live: true })],
				{ hold: true },
			)}
			onClose={() => {}}
		/>,
	)
	await screen.findByText('said')
	expect(markOf('pondering')).not.toContain('animate-pulse')
})

test('a tool line shows its glyph, and an unlisted tool falls back', async () => {
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([
				window({
					lines: [
						{ kind: 'tool', text: 'ls', tool: 'Bash' },
						{ kind: 'tool', text: 'zap', tool: 'Frobnicate' },
					],
				}),
			])}
			onClose={() => {}}
		/>,
	)

	const bash = (await screen.findByText('ls')).closest('li')?.querySelector('[aria-hidden]')
	expect(bash?.textContent).toBe('$')
	expect((bash as HTMLElement | null | undefined)?.style.color).toBe('var(--tx-tool)')
	expect(screen.getByText('ls').textContent).toBe('ls')

	const frobnicate = screen.getByText('zap').closest('li')?.querySelector('[aria-hidden]')
	expect(frobnicate?.textContent).toBe('⚒')
	expect(screen.getByText('zap').textContent).toBe('zap')
})

test('a tool call and its result are one block', async () => {
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([
				window({
					lines: [
						{
							kind: 'tool',
							text: 'Read',
							tool: 'Read',
							call: 'c1',
							detail: 'Read(apps/x.ts)',
						},
						{ kind: 'output', text: '92 lines', call: 'c1' },
					],
				}),
			])}
			onClose={() => {}}
		/>,
	)

	await screen.findByText('Read(apps/x.ts)')
	expect(screen.getByText('92 lines')).toBeTruthy()
})

test('a long body folds and expands on click', async () => {
	const body = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n')
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([
				window({
					lines: [
						{ kind: 'tool', text: 'Bash', tool: 'Bash', call: 'c1', detail: 'Bash(ls)' },
						{ kind: 'output', text: '6 lines', call: 'c1', body },
					],
				}),
			])}
			onClose={() => {}}
		/>,
	)

	await screen.findByText('Bash(ls)')
	const fold = await screen.findByText(/\+3 lines \(click to expand\)/)
	expect(fold.getAttribute('aria-expanded')).toBe('false')
	fireEvent.click(fold)
	expect(await screen.findByText(/Collapse output/)).toBeTruthy()
})

test('raw stderr reads in the error tone', async () => {
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([
				window({ lines: [{ kind: 'raw', text: 'stderr: something broke', tool: null }] }),
			])}
			onClose={() => {}}
		/>,
	)

	const raw = (await screen.findByText('stderr: something broke')).closest('li')
	expect((raw?.querySelector('[aria-hidden]') as HTMLElement | null)?.style.color).toBe(
		'var(--tx-error)',
	)
})

test('an old-style tool line with no detail or call still renders the bare tool text', async () => {
	render(
		<LogScreen
			node="n-k7f2"
			surface={surfaceOf([window({ lines: [{ kind: 'tool', text: 'Write', tool: 'Write' }] })])}
			onClose={() => {}}
		/>,
	)

	expect(await screen.findByText('Write')).toBeTruthy()
})
