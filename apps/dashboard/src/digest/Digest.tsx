import type { Digest as Read } from '@besober/schema'
import { lines } from './data.js'

/**
 * What changed since you last looked (DESIGN §7.1), across the top of the
 * board. On a forty-node board this is not a question the canvas can answer:
 * every one of these nodes is already drawn, and the digest is the sentence
 * saying which of them are new.
 *
 * A bar rather than a card over the canvas. It is read once and dismissed, and
 * a modal would make a glance into a thing to get past.
 */
export const Digest = ({
	digest,
	onClose,
}: {
	readonly digest: Read
	readonly onClose: () => void
}): React.JSX.Element => (
	<section
		aria-label="Since you last looked"
		className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-[var(--line)] border-b bg-[var(--raised)] px-4 py-2"
	>
		<span className="text-[var(--ink-faint)] text-xs tracking-widest">SINCE YOU LAST LOOKED</span>

		{lines(digest).map((line) => (
			<span key={line.kind} className="text-[var(--ink)] text-xs tabular-nums">
				{line.text}
			</span>
		))}

		{/*
		  The remote half failing is said, never dropped. "Nothing changed" and
		  "nothing was checked" are opposite facts, and a bar that shows the
		  counts it does have without this line reports the second as the first
		  (§8.7).
		*/}
		{digest.unreachable !== null && (
			<span className="text-[var(--ink-faint)] text-xs">{digest.unreachable}</span>
		)}

		<button
			type="button"
			onClick={onClose}
			className="ml-auto rounded-[var(--radius-sm)] px-2 py-0.5 text-[var(--ink-faint)] text-xs hover:bg-[var(--surface)] hover:text-[var(--ink)]"
		>
			dismiss
		</button>
	</section>
)
