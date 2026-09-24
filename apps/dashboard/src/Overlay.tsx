/**
 * The shell both stopping screens share: a card in the middle, the board
 * pushed back behind it.
 *
 * The backdrop is a button rather than a div with a click on it. It does what a
 * button does, and writing it as one is how it reaches a keyboard without a
 * rule being silenced to let it through.
 *
 * `full` swaps the fixed card for the whole viewport (ADR 0064's run screen):
 * same dialog markup, same backdrop, just the sizing. The backdrop blurs
 * behind it — `backdrop-filter` reaches the canvas without this component
 * needing to touch it.
 */
export const Overlay = ({
	label,
	width,
	full = false,
	onClose,
	children,
	dialogRef,
	onKeyDown,
}: {
	readonly label: string
	readonly width: number
	readonly full?: boolean
	readonly onClose: () => void
	readonly children: React.ReactNode
	readonly dialogRef?: React.Ref<HTMLDivElement>
	readonly onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
}): React.JSX.Element => (
	<div className={`absolute inset-0 z-30 flex items-center justify-center ${full ? '' : 'p-6'}`}>
		<button
			type="button"
			aria-label="Close"
			onClick={onClose}
			className={`absolute inset-0 cursor-default transition-[background-color,backdrop-filter] duration-300 ${
				full
					? 'bg-[oklch(0_0_0/0.65)] backdrop-blur-[5px]'
					: 'bg-[color-mix(in_oklab,var(--bg)_78%,transparent)]'
			}`}
		/>
		<div
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-label={label}
			tabIndex={-1}
			onKeyDown={onKeyDown}
			style={full ? undefined : { width }}
			className={
				full
					? 'relative flex h-full w-full flex-col overflow-y-auto bg-[var(--surface)]'
					: 'relative flex max-h-full max-w-full flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-2xl'
			}
		>
			{children}
		</div>
	</div>
)
