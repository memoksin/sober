import { ID_PATTERN } from '@besober/schema'
import { expect, test } from 'vitest'
import { newId } from './id.js'

test('a title nobody wrote in ASCII still reads as itself', () => {
	// Found in the M1 gate: a Turkish board produced `ge-ersiz`, `mod-l` and
	// `ok-para-birimli` — every letter the slug could not spell was dropped.
	expect(newId('Geçersiz para birimleri')).toMatch(/^gecersiz-para-birimleri-[a-z0-9]{4}$/)
	expect(newId('Exchange rates modülü')).toMatch(/^exchange-rates-modulu-[a-z0-9]{4}$/)
	expect(newId('Çok para birimli toplam')).toMatch(/^cok-para-birimli-toplam-[a-z0-9]{4}$/)
	// ı, ß and ø are not a base letter plus a mark, so NFD alone leaves them.
	expect(newId('Ayrıştırma')).toMatch(/^ayristirma-[a-z0-9]{4}$/)
	expect(newId('Straße')).toMatch(/^strasse-[a-z0-9]{4}$/)
})

test('every id it makes is one the schema accepts', () => {
	for (const seed of [
		'The auth API',
		'Geçersiz para birimleri',
		'日本語',
		'',
		'---',
		'a'.repeat(80),
	])
		expect(newId(seed), seed).toMatch(ID_PATTERN)
})

test('a title with nothing to slug still gets a name', () => {
	expect(newId('日本語')).toMatch(/^item-[a-z0-9]{4}$/)
	expect(newId('')).toMatch(/^item-[a-z0-9]{4}$/)
})
