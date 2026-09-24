import { useEffect, useRef } from 'react'
import {
	EKG_FLAT,
	EKG_H,
	EKG_W,
	type EkgBeat,
	ekgPath,
	type Random,
	scheduleBeats,
	spike,
} from './data.js'

/**
 * The thinking trace (ADR 0064): a 90×18 EKG that beats on its own rhythm and
 * spikes when a new log line lands, ported from `docs/design/watch-the-run.html`.
 * Reduced motion drops the `requestAnimationFrame` loop for a single static
 * beat — the caller's own timer keeps running regardless.
 */
export const Ekg = ({
	live,
	lineCount,
	random = Math.random,
}: {
	readonly live: boolean
	/** Bumped by the caller on every new line; a change here draws a spike. */
	readonly lineCount: number
	readonly random?: Random
}): React.JSX.Element => {
	const pathRef = useRef<SVGPathElement>(null)
	const queue = useRef<readonly EkgBeat[]>([])
	const nextAt = useRef<number | null>(null)
	const frame = useRef<number | null>(null)
	const start = useRef(performance.now())
	const seenLines = useRef(lineCount)

	useEffect(() => {
		if (lineCount === seenLines.current) return
		seenLines.current = lineCount
		const now = performance.now() - start.current
		const result = spike(queue.current, now, random)
		queue.current = result.queue
		nextAt.current = result.nextAt
	}, [lineCount, random])

	useEffect(() => {
		if (!live) {
			if (frame.current !== null) cancelAnimationFrame(frame.current)
			pathRef.current?.setAttribute('d', EKG_FLAT)
			return
		}

		const draw = (): void => {
			const now = performance.now() - start.current
			const result = scheduleBeats(queue.current, nextAt.current, now, random)
			queue.current = result.queue
			nextAt.current = result.nextAt
			pathRef.current?.setAttribute('d', ekgPath(queue.current, now))
		}

		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			draw()
			return
		}

		const loop = (): void => {
			draw()
			frame.current = requestAnimationFrame(loop)
		}
		frame.current = requestAnimationFrame(loop)
		return () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current)
		}
	}, [live, random])

	return (
		<svg
			viewBox={`0 0 ${EKG_W} ${EKG_H}`}
			aria-hidden="true"
			className="h-[18px] w-[90px] shrink-0 overflow-hidden"
		>
			<path
				ref={pathRef}
				d={EKG_FLAT}
				fill="none"
				stroke="var(--tx-think)"
				strokeWidth={1.5}
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
		</svg>
	)
}
