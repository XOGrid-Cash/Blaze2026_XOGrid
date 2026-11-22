/** Token amounts: base units (what the chain stores) to and from a decimal string with `decimals` places. */

/** Parses "1,234.5" with 2 decimals into 123450n. Throws on anything that isn't a plain decimal number. */
export function parseUnits(text: string, decimals: number): bigint {
    const cleaned = text.trim().replaceAll(',', '').replaceAll('_', '');

    if (!/^\d+(\.\d+)?$/.test(cleaned)) {
        throw new Error(`“${text}” is not a number.`);
    }

    const [whole = '0', fraction = ''] = cleaned.split('.');

    if (fraction.length > decimals) {
        throw new Error(`“${text}” has more than ${decimals} decimal places.`);
    }

    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

/** Formats 123450n with 2 decimals as "1,234.5". */
export function formatUnits(amount: bigint, decimals: number): string {
    const negative = amount < 0n;
    const absolute = negative ? -amount : amount;
    const scale = 10n ** BigInt(decimals);
    const whole = (absolute / scale).toLocaleString('en-US');
    const fraction = decimals > 0 ? (absolute % scale).toString().padStart(decimals, '0').replace(/0+$/, '') : '';

    return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
