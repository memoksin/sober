import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Inline, Markdown } from './markdown.js'

afterEach(cleanup)

test('a heading is a heading and not a line beginning with hashes', () => {
	render(<Markdown text={'## The approach\n\nplain words'} />)

	expect(screen.getByRole('heading', { name: 'The approach' })).toBeTruthy()
	expect(screen.queryByText(/##/)).toBeNull()
})

test('a bullet list is a list', () => {
	const { container } = render(<Markdown text={'- first\n- second\n- third'} />)

	expect(container.querySelectorAll('li')).toHaveLength(3)
	expect(screen.getByText('first')).toBeTruthy()
})

test('a numbered list is a list, and keeps its numbers', () => {
	const { container } = render(<Markdown text={'1. first\n2. second'} />)

	expect(container.querySelector('ol')).toBeTruthy()
	expect(container.querySelectorAll('li')).toHaveLength(2)
})

test('inline code is code', () => {
	const { container } = render(<Markdown text={'call `loadBoard(paths)` first'} />)

	expect(container.querySelector('code')?.textContent).toBe('loadBoard(paths)')
})

test('a fenced block is one block, not one paragraph per line', () => {
	const { container } = render(
		<Markdown text={'before\n\n```ts\nconst a = 1\nconst b = 2\n```\n\nafter'} />,
	)

	const pre = container.querySelector('pre')
	expect(pre?.textContent).toBe('const a = 1\nconst b = 2')
	expect(container.querySelectorAll('pre')).toHaveLength(1)
})

test('bold and emphasis are marks, not asterisks', () => {
	const { container } = render(<Markdown text={'**never** guess the *shape*'} />)

	expect(container.querySelector('strong')?.textContent).toBe('never')
	expect(container.querySelector('em')?.textContent).toBe('shape')
	expect(container.textContent).toBe('never guess the shape')
})

/**
 * A brief is written by an agent against a repository it read, and a repository
 * contains angle brackets. Nothing here builds markup from the text: the
 * renderer returns elements, so a tag in an approach is a tag on the screen and
 * never a tag in the document.
 */
test('markup in the source is text', () => {
	const { container } = render(<Markdown text={'use <img src=x onerror=boom> carefully'} />)

	expect(container.querySelector('img')).toBeNull()
	expect(container.textContent).toContain('<img src=x onerror=boom>')
})

test('an empty approach renders nothing rather than an empty paragraph', () => {
	const { container } = render(<Markdown text={'   \n\n  '} />)

	expect(container.innerHTML).toBe('')
})

/**
 * A criterion's `proves` is one phrase, and a phrase inside a list item is not
 * a place for headings. It gets the inline half and nothing else.
 */
test('the inline half marks code without opening a block', () => {
	const { container } = render(<Inline text={'the `board` is loadable'} />)

	expect(container.querySelector('code')?.textContent).toBe('board')
	expect(container.querySelector('p')).toBeNull()
})
