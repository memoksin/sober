import { randomBytes } from 'node:crypto'

const SUFFIX = 4
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A slug plus four random characters (ADR 0020). Generation is core's, validation is schema's. */
export const newId = (seed: string): string => {
	const slug =
		seed
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40)
			.replace(/-+$/, '') || 'item'
	const suffix = [...randomBytes(SUFFIX)].map((byte) => ALPHABET[byte % ALPHABET.length]).join('')
	return `${slug}-${suffix}`
}
