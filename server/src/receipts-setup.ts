import type { Db } from './db.js';
import { DEFAULT_ELECTRUM, ElectrumServer, parseEndpoint } from './electrum.js';
import { resolveReviewIdentity, reviewAddressFor } from './review-address.js';
import type { ReceiptConfig } from './review-chain.js';

/**
 * Startup settings for on-chain review receipts. The review address is derived from an admin identity
 * (REVIEW_IDENTITY_LABEL picks one by its label; otherwise the first usable one). ELECTRUM_MAINNET and
 * ELECTRUM_CHIPNET are "host:port" (TLS) servers; ELECTRUM_INSECURE_TLS=1 accepts self-signed certificates.
 */
export async function buildReceiptConfig(database: Db, env: NodeJS.ProcessEnv): Promise<ReceiptConfig | undefined> {
    const identity = await resolveReviewIdentity(database, env.REVIEW_IDENTITY_LABEL);

    if (!identity) {
        console.warn('On-chain receipts are off: no usable admin identity for the review address.');

        return undefined;
    }

    const chains: ReceiptConfig['chains'] = {};
    const insecureTls = env.ELECTRUM_INSECURE_TLS === '1';
    const specs = {
        mainnet: env.ELECTRUM_MAINNET ?? DEFAULT_ELECTRUM.mainnet,
        chipnet: env.ELECTRUM_CHIPNET ?? DEFAULT_ELECTRUM.chipnet,
    };

    for (const network of ['mainnet', 'chipnet'] as const) {
        const endpoint = parseEndpoint(specs[network]);

        if (endpoint) {
            chains[network] = new ElectrumServer(endpoint, { insecureTls });
        } else {
            console.warn(`ELECTRUM_${network.toUpperCase()} is not a host:port value; receipts are off on ${network}.`);
        }
    }

    for (const network of ['mainnet', 'chipnet'] as const) {
        console.log(`Review receipts on ${network}: ${chains[network] ? reviewAddressFor(identity, network)?.address : 'off'}`);
    }

    return { identity, chains };
}
