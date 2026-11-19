import { describe, expect, it } from 'vitest';
import { describeTemplate, readable } from '../src/describe.js';
import { COMMUNITY_TEMPLATES } from '../src/templates/community.js';

const variables = { fundSatoshis: { name: 'Amount to fund' }, masterSatoshis: { name: 'masterBadger satoshis' } };

describe('readable placeholders', () => {
    it('shows the variable name for a single fill-in', () => {
        expect(readable('Send $(<fundSatoshis>) satoshis.', variables)).toBe('Send [amount to fund] satoshis.');
    });

    it('describes a small calculation without exposing the script', () => {
        expect(readable('Left with $(<masterSatoshis> stakeFee OP_ADD) sats.', variables)).toBe(
            'Left with [calculated from: masterbadger satoshis, stakeFee] sats.',
        );
    });

    it('falls back to the written id when the template has no such variable, and leaves plain text alone', () => {
        expect(readable('Pays $(checkStake stakeReward) now', {})).toBe('Pays [calculated from: checkStake, stakeReward] now');
        expect(readable('Nothing to fill in.', variables)).toBe('Nothing to fill in.');
        expect(readable('Empty $(<0x01>) value', variables)).toBe('Empty [a value] value');
    });

    it.each(COMMUNITY_TEMPLATES.map((entry) => [entry.slug, entry] as const))('%s has no raw $( ) syntax in its plain English', (_slug, entry) => {
        const english = describeTemplate(JSON.parse(entry.json));
        const all = JSON.stringify(english);

        expect(english).not.toBeNull();
        expect(all).not.toContain('$(');
    });
});
