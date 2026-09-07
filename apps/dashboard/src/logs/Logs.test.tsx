import type { LogWindow } from '@besober/schema'
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

const window = (over: Partial<LogWindow> = {}): LogWindow => ({
	lines: [],
	offset: 0,
	live: false,
	...over,
})

test('a person reads what the agent said, without opening a terminal', async () => {
	render(
		<LogScreen
			node="auth-api-k7f2"
			surface={surfaceOf([
				window({
					lines: [
						{ kind: 'started', text: 'session started' },
						{ kind: 'tool', text: 'Write' },
						{ kind: 'text', text: 'wrote the auth middleware' },
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
				window({ lines: [{ kind: 'text', text: 'first' }], offset: 10, live: true }),
				window({ lines: [{ kind: 'text', text: 'second' }], offset: 20, live: false }),
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
