/**
 * What chose a run's host, worded once (ADR 0058, 0061). The CLI's `sober
 * logs` and the dashboard's logs screen both show this; one function means
 * changing the wording changes it everywhere.
 */
export const ranLabel = ({
	tier,
	fallback,
}: {
	tier: string | null
	fallback: boolean
}): string => {
	if (tier === null)
		return fallback ? 'no model covers this score, fallback to dispatch.host' : 'unscored'
	return fallback ? `${tier} named no host, fallback to dispatch.host` : tier
}
