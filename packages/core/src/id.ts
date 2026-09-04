import { randomBytes } from 'node:crypto'

const SUFFIX = 4
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * The letters NFD cannot take a mark off, because they are not a base letter
 * plus a mark. Everything else — ş, ğ, ö, é, å — decomposes and the mark is
 * stripped below.
 */
const STANDALONE: Readonly<Record<string, string>> = {
	ı: 'i',
	ß: 'ss',
	ø: 'o',
	đ: 'd',
	ð: 'd',
	ł: 'l',
	þ: 'th',
	æ: 'ae',
	œ: 'oe',
}

/**
 * An id is read by a human — in `sober status`, in a branch name, in the file
 * name on disk — so a title that is not written in ASCII has to survive the
 * trip. Dropping every letter it cannot spell turns "Geçersiz para birimleri"
 * into `ge-ersiz-para-birimleri`, which is worse than a transliteration and
 * silently so.
 */
const ascii = (text: string): string =>
	[...text.toLowerCase()]
		.map((letter) => STANDALONE[letter] ?? letter)
		.join('')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')

/** A slug plus four random characters (ADR 0020). Generation is core's, validation is schema's. */
export const newId = (seed: string): string => {
	const slug =
		ascii(seed)
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40)
			.replace(/-+$/, '') || 'item'
	const suffix = [...randomBytes(SUFFIX)].map((byte) => ALPHABET[byte % ALPHABET.length]).join('')
	return `${slug}-${suffix}`
}
