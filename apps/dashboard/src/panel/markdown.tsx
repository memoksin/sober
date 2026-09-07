/**
 * The small subset of markdown an agent writes into a brief.
 *
 * M3's gate, finding 3: the approach and the acceptance list are written by an
 * agent, and an agent writes headings, lists, inline code and fences. The panel
 * showed the source.
 *
 * Hand-rolled rather than a dependency, for one reason that is not size: the
 * dashboard client is bundled into the CLI (bd3aa9d), so whatever renders
 * agent-written text ships to every user. This returns React elements and never
 * a string of HTML, so there is no sanitiser to get wrong and a tag in an
 * approach is a tag on the screen. Links are the one common construct left out
 * — a brief has no use for one, and `javascript:` is the whole reason to be
 * careful about the one place a renderer produces an attribute.
 */

const FENCE = /^\s*```/
const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*]\s+(.*)$/
const NUMBER = /^\s*\d+[.)]\s+(.*)$/

/**
 * `at` is the line the block starts on. It is an identity rather than a
 * position in an array: blocks are never reordered, and two identical
 * paragraphs are still two paragraphs from two places in the source.
 */
type Block = { readonly at: number } & (
	| { readonly kind: 'code'; readonly lines: readonly string[] }
	| { readonly kind: 'heading'; readonly text: string }
	| { readonly kind: 'ul' | 'ol'; readonly items: readonly Item[] }
	| { readonly kind: 'p'; readonly text: string }
)

interface Item {
	readonly at: number
	readonly text: string
}

/** One pass, line by line. A fence swallows everything until it closes. */
const blocks = (text: string): Block[] => {
	const lines = text.split('\n')
	const found: Block[] = []
	let at = 0

	while (at < lines.length) {
		const line = lines[at] ?? ''

		if (FENCE.test(line)) {
			const opened = at
			const body: string[] = []
			at += 1
			while (at < lines.length && !FENCE.test(lines[at] ?? '')) {
				body.push(lines[at] ?? '')
				at += 1
			}
			// An unclosed fence still ends here: the run of lines is the block.
			at += 1
			found.push({ kind: 'code', at: opened, lines: body })
			continue
		}

		const heading = HEADING.exec(line)
		if (heading !== null) {
			found.push({ kind: 'heading', at, text: heading[2]?.trim() ?? '' })
			at += 1
			continue
		}

		const list = listFrom(lines, at)
		if (list !== null) {
			found.push(list.block)
			at = list.next
			continue
		}

		if (line.trim() === '') {
			at += 1
			continue
		}

		// A paragraph runs to the next blank line or the next thing that is not
		// one, so a wrapped sentence is one paragraph rather than two.
		const opened = at
		const paragraph: string[] = []
		while (at < lines.length) {
			const here = lines[at] ?? ''
			if (here.trim() === '' || FENCE.test(here) || HEADING.test(here)) break
			if (BULLET.test(here) || NUMBER.test(here)) break
			paragraph.push(here.trim())
			at += 1
		}
		found.push({ kind: 'p', at: opened, text: paragraph.join(' ') })
	}

	return found
}

/** A run of bullets or a run of numbers, whichever starts here. */
const listFrom = (
	lines: readonly string[],
	from: number,
): { readonly block: Block; readonly next: number } | null => {
	const kind = BULLET.test(lines[from] ?? '') ? 'ul' : NUMBER.test(lines[from] ?? '') ? 'ol' : null
	if (kind === null) return null

	const shape = kind === 'ul' ? BULLET : NUMBER
	const items: Item[] = []
	let at = from
	while (at < lines.length) {
		const item = shape.exec(lines[at] ?? '')
		if (item === null) break
		items.push({ at, text: item[1]?.trim() ?? '' })
		at += 1
	}
	return { block: { kind, at: from, items }, next: at }
}

const MARKS = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g

/**
 * Inline code, bold and emphasis, as elements. The keys are the index in the
 * split, which is stable for one render of one immutable string.
 */
export const Inline = ({ text }: { readonly text: string }): React.JSX.Element => {
	const parts: React.ReactNode[] = []
	let last = 0

	for (const mark of text.matchAll(MARKS)) {
		const at = mark.index
		if (at > last) parts.push(text.slice(last, at))
		const key = `${at}`
		if (mark[1] !== undefined)
			parts.push(
				<code key={key} className="font-[family-name:var(--font-mono)] text-[var(--ink)]">
					{mark[1]}
				</code>,
			)
		else if (mark[2] !== undefined)
			parts.push(
				<strong key={key} className="font-medium text-[var(--ink)]">
					{mark[2]}
				</strong>,
			)
		else parts.push(<em key={key}>{mark[3]}</em>)
		last = at + mark[0].length
	}

	if (last < text.length) parts.push(text.slice(last))
	return <>{parts}</>
}

/** The block half. Nothing at all when there is nothing to render. */
export const Markdown = ({ text }: { readonly text: string }): React.JSX.Element | null => {
	const found = blocks(text).filter(
		(block) =>
			block.kind === 'code' ||
			(block.kind === 'heading' || block.kind === 'p' ? block.text !== '' : block.items.length > 0),
	)
	if (found.length === 0) return null

	return (
		<div className="flex flex-col gap-2 text-[length:var(--text-sm)] text-[var(--ink-dim)] leading-[var(--leading-prose)]">
			{found.map((block) => (
				<Rendered key={`${block.kind}:${block.at}`} block={block} />
			))}
		</div>
	)
}

const Rendered = ({ block }: { readonly block: Block }): React.JSX.Element => {
	if (block.kind === 'code')
		return (
			<pre className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] p-2.5 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] leading-normal">
				{block.lines.join('\n')}
			</pre>
		)

	// One level. A brief is a section of a drawer, not a document, and six sizes
	// of heading inside a 420px column is a hierarchy nobody can see.
	if (block.kind === 'heading')
		return (
			<h4 className="font-medium text-[length:var(--text-sm)] text-[var(--ink)]">
				<Inline text={block.text} />
			</h4>
		)

	if (block.kind === 'p')
		return (
			<p>
				<Inline text={block.text} />
			</p>
		)

	const items = block.items.map((item) => (
		<li key={item.at} className="ml-4 list-outside">
			<Inline text={item.text} />
		</li>
	))

	return block.kind === 'ul' ? (
		<ul className="flex list-disc flex-col gap-1">{items}</ul>
	) : (
		<ol className="flex list-decimal flex-col gap-1">{items}</ol>
	)
}
