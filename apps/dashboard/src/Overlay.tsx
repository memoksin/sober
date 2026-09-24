/**
 * The shell both stopping screens share: a card in the middle, the board
 * pushed back behind it.
 *
 * The backdrop is a button rather than a div with a click on it. It does what a
 * button does, and writing it as one is how it reaches a keyboard without a
 * rule being silenced to let it through.
 */
export const Overlay = ({
	label,
	width,
	onClose,
	children,
}: {
	readonly label: string
	readonly width: number
	readonly onClose: () => void
	readonly children: React.ReactNode
}): React.JSX.Element => (
	<div className="absolute inset-0 z-30 flex items-center justify-center p-6">
		<button
			type="button"
			aria-label="Close"
			onClick={onClose}
			className="absolute inset-0 cursor-default bg-[color-mix(in_oklab,var(--bg)_78%,transparent)]"
		/>
		<div
			role="dialog"
			aria-modal="true"
			aria-label={label}
			style={{ width }}
			className="relative flex max-h-full max-w-full flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-2xl"
		>
			{children}
		</div>
	</div>
)
