import { childIndexOfPathName, initiateDappRelay } from '@wizardconnect/core';
import { DappConnectionManager } from '@wizardconnect/dapp';
import type { Chain } from './chain';
import type { Coin } from './core';
import { walletLockingBytecode } from './core';
import { trackSigning } from '../hub/signing';

/**
 * What the demo needs from a wallet: connect, share public keys, and sign a transaction we built. Selene connects
 * through WizardConnect today. Another connection method (WalletConnect, a future XO wallet connection) only has to
 * implement this interface.
 */
export interface WalletConnector {
    readonly protocolName: string;
    start(onStatus: (text: string) => void, onReady: (walletName: string) => void): { uri: string; qrUri: string };
    stop(): void;
    /** Public keys the wallet shares, with the path name used to ask it to sign. */
    keys(scanPerPath: number): { pathName: string; addressIndex: number; publicKey: Uint8Array }[];
    /** Returns signed transaction hex. The request is the relay-safe JSON body from core.buildIssueSignRequest. */
    sign(request: object, pathName: string, addressIndex: number): Promise<string>;
}

export class WizardConnectWallet implements WalletConnector {
    readonly protocolName = 'WizardConnect';
    private manager: DappConnectionManager | undefined;
    private cleanup: (() => void) | undefined;

    start(onStatus: (text: string) => void, onReady: (walletName: string) => void): { uri: string; qrUri: string } {
        this.stop();

        const manager = new DappConnectionManager('XOGrid', undefined, { session: false });
        const relay = initiateDappRelay((payload) => {
            manager.updateConnection(payload.client, payload.status);
            onStatus(payload.status.status);
        });
        let announced = false;

        manager.attachRelay(relay);
        // Selene reports "wallet ready" more than once; announce it once.
        manager.on('walletready', () => {
            if (!announced) {
                announced = true;
                const paths = manager.getSessionPaths().map((path) => path.name).join(', ');

                onReady(`${manager.walletName ?? 'wallet'} (shares: ${paths || 'no paths'})`);
            }
        });
        manager.on('disconnect', (reason, message) => onStatus(`disconnected: ${reason} ${message ?? ''}`));
        this.manager = manager;
        this.cleanup = relay.cleanup;

        return { uri: relay.uri, qrUri: relay.qrUri };
    }

    /**
     * Uses a connection that is already open (the site-wide wallet from hub/WalletContext) instead of starting its own.
     * The shared connection stays open when this wallet is stopped: stop() only lets go of it.
     */
    adopt(manager: DappConnectionManager): void {
        this.stop();
        this.manager = manager;
    }

    stop(): void {
        this.cleanup?.();
        this.cleanup = undefined;
        this.manager = undefined;
    }

    keys(scanPerPath: number): { pathName: string; addressIndex: number; publicKey: Uint8Array }[] {
        const found: { pathName: string; addressIndex: number; publicKey: Uint8Array }[] = [];

        // Scan every standard path the wallet shares (receive, change, defi, ...) rather than assuming a fixed list,
        // so wallets other than Selene work. Extension paths with no child index (e.g. stealth) are skipped.
        for (const path of this.manager?.getSessionPaths() ?? []) {
            const childIndex = childIndexOfPathName(path.name);

            if (childIndex === undefined || !this.manager?.hasPath(childIndex)) {
                continue;
            }

            for (let index = 0; index < scanPerPath; index += 1) {
                const publicKey = this.manager.getPubkey(childIndex, BigInt(index));

                if (publicKey) {
                    found.push({ pathName: path.name, addressIndex: index, publicKey });
                }
            }
        }

        return found;
    }

    async sign(request: object, pathName: string, addressIndex: number): Promise<string> {
        if (!this.manager) {
            throw new Error('No wallet connected.');
        }

        const manager = this.manager;
        // A real transaction: the prompt tells the person to open their wallet, check it and approve.
        const response = await trackSigning('transaction', () =>
            manager.signTransaction({ transaction: request as never, inputPaths: [[0, pathName, addressIndex]] }),
        );

        if (response.error) {
            throw new Error(`The wallet refused: ${response.error}`);
        }

        return response.signedTransaction;
    }
}

/** Finds the wallet's plain coins by asking the chain about each shared key's address. */
export async function scanCoins(wallet: WalletConnector, chain: Chain, scanPerPath = 20): Promise<Coin[]> {
    const coins: Coin[] = [];
    const seen = new Set<string>();

    for (const key of wallet.keys(scanPerPath)) {
        for (const found of await chain.plainCoins(walletLockingBytecode(key.publicKey))) {
            const id = `${found.transactionHash}:${found.outputIndex}`;

            if (!seen.has(id)) {
                seen.add(id);
                coins.push({ ...found, pathName: key.pathName, addressIndex: key.addressIndex, publicKey: key.publicKey });
            }
        }
    }

    return coins.sort((a, b) => Number(b.valueSatoshis - a.valueSatoshis));
}
