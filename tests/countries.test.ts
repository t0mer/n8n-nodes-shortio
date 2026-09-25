import { describe, expect, it } from 'vitest';

import { COUNTRIES, COUNTRY_OPTIONS } from '../nodes/ShortIo/countries';

// Copied verbatim from docs/api/digests/subresources.md section 6 (250 codes, spec order).
const DIGEST_CODES = (
	'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE ' +
	'BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD ' +
	'CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM ' +
	'DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF ' +
	'GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ' +
	'ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN ' +
	'KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME ' +
	'MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA ' +
	'NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM ' +
	'PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI ' +
	'SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK ' +
	'TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI ' +
	'VN VU WF WS YE YT ZA ZM ZW XK'
)
	.trim()
	.split(/\s+/);

describe('COUNTRIES', () => {
	it('has exactly the 250 codes from the digest', () => {
		expect(DIGEST_CODES).toHaveLength(250);
		const codes = COUNTRIES.map((c) => c.code);
		expect(new Set(codes)).toEqual(new Set(DIGEST_CODES));
		expect(codes).toHaveLength(250);
		expect(new Set(codes).size).toBe(250);
	});

	it('includes XK mapped to Kosovo', () => {
		expect(COUNTRIES.find((c) => c.code === 'XK')).toEqual({ code: 'XK', name: 'Kosovo' });
	});

	it('is sorted by name', () => {
		const names = COUNTRIES.map((c) => c.name);
		const sorted = [...names].sort((a, b) => a.localeCompare(b));
		expect(names).toEqual(sorted);
	});

	it('every entry has a non-empty name', () => {
		for (const country of COUNTRIES) {
			expect(country.name.length).toBeGreaterThan(0);
		}
	});
});

describe('COUNTRY_OPTIONS', () => {
	it('formats name as "<Name> (<CODE>)" and value as the code', () => {
		const us = COUNTRY_OPTIONS.find((o) => o.value === 'US');
		expect(us).toEqual({ name: 'United States (US)', value: 'US' });
	});

	it('has one option per country, same order as COUNTRIES', () => {
		expect(COUNTRY_OPTIONS.map((o) => o.value)).toEqual(COUNTRIES.map((c) => c.code));
	});
});
