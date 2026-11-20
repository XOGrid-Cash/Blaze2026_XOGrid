import { initiateDappRelay } from "@wizardconnect/core";
import { DappConnectionManager, loadSession, clearSession, type SessionStorage } from "@wizardconnect/dapp";

import { trackSigning, type SigningKind } from "./signing";

// WizardConnect (Selene, Paytaca and other WizardConnect wallets).
//
// The relay credentials of a live connection are kept in sessionStorage so a page reload, or moving around the site,
// can pick the same wallet connection back up without scanning again. sessionStorage ends with the browser tab. The
// credentials let the page talk to the wallet; they are not wallet keys, and every signature is still approved on the
// wallet's own device.

export const SESSION_KEY = "xogrid-wallet-session";

/** sessionStorage, or an in-memory stand-in when the browser blocks it. */
function sessionStore(): SessionStorage {
  try {
    const probe = "__xogrid_probe__";

    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);

    return window.sessionStorage;
  } catch {
    const memory = new Map<string, string>();

    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
}

const storage = sessionStore();

export interface WalletSession {
  manager: DappConnectionManager;
  /** Lets go of the relay without ending the connection, so the same wallet can be resumed (React effect clean-up). */
  cleanup: () => void;
  /** Ends the connection for good: tells the wallet, closes the relay and forgets the stored credentials. */
  end: () => void;
  uri: string;
  qrUri: string;
}

interface Handlers {
  onStatus: (text: string) => void;
  onReady: (walletName: string) => void;
  onDisconnect?: () => void;
}

function build(handlers: Handlers, resume: boolean): WalletSession | null {
  const stored = resume ? loadSession(SESSION_KEY, storage) : null;

  if (resume && !(stored && stored.walletPublicKey)) {
    clearSession(SESSION_KEY, storage);

    return null;
  }

  if (!resume) {
    // A new pairing must not inherit an old one.
    clearSession(SESSION_KEY, storage);
  }

  const manager = new DappConnectionManager("XOGrid", undefined, { session: { key: SESSION_KEY, storage } });
  let ended = false;
  let announced = false;

  const relay = initiateDappRelay(
    (payload) => {
      manager.updateConnection(payload.client, payload.status);
      handlers.onStatus(payload.status.status);

      // The wallet deleted the pairing: nothing can be resumed from it.
      if (payload.status.status === "session_deleted" && !ended) {
        ended = true;
        clearSession(SESSION_KEY, storage);
        handlers.onDisconnect?.();
      }
    },
    stored && stored.walletPublicKey
      ? { existingCredentials: { privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey } }
      : undefined,
  );

  manager.attachRelay(relay);

  // Some wallets report "wallet ready" more than once; announce it once.
  manager.on("walletready", () => {
    if (!announced) {
      announced = true;
      handlers.onReady(manager.walletName ?? "wallet");
    }
  });

  // The wallet closed the connection (or the relay stayed down past the grace period).
  manager.on("disconnect", () => {
    if (ended) return;

    ended = true;
    clearSession(SESSION_KEY, storage);
    handlers.onDisconnect?.();
  });

  const cleanup = () => {
    try {
      relay.cleanup();
    } catch {
      // Already closed.
    }
  };

  const end = () => {
    ended = true;

    // Best effort: tell the wallet so it drops the pairing too. Without this the wallet keeps a half-open session and a
    // fresh connection can fail.
    void Promise.resolve(manager.sendDisconnect("XOGrid disconnected"))
      .catch(() => undefined)
      .finally(() => {
        cleanup();

        try {
          manager.destroy();
        } catch {
          // Already destroyed.
        }
      });

    // Do not wait for the wallet before the stored credentials are gone.
    clearSession(SESSION_KEY, storage);
  };

  return { manager, cleanup, end, uri: relay.uri, qrUri: relay.qrUri };
}

/** Starts a new WizardConnect pairing. The returned session carries the QR code and link to show. */
export function startWalletSession(
  onStatus: (text: string) => void,
  onReady: (walletName: string) => void,
  onDisconnect?: () => void,
): WalletSession {
  const session = build({ onStatus, onReady, onDisconnect }, false);

  if (!session) {
    throw new Error("Could not start a wallet session.");
  }

  return session;
}

/** True when this tab has a paired wallet that could be resumed. */
export function hasStoredWalletSession(): boolean {
  const stored = loadSession(SESSION_KEY, storage);

  return Boolean(stored && stored.walletPublicKey);
}

/** Re-opens the wallet connection stored by this tab. Returns null when there is nothing to resume. */
export function resumeWalletSession(
  onStatus: (text: string) => void,
  onReady: (walletName: string) => void,
  onDisconnect?: () => void,
): WalletSession | null {
  return build({ onStatus, onReady, onDisconnect }, true);
}

export function forgetStoredWalletSession(): void {
  clearSession(SESSION_KEY, storage);
}

const hex = (key: Uint8Array): string => Array.from(key, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * The wallet's first receive key as compressed-public-key hex. Wallets announce "ready" slightly before their keys
 * arrive, so this waits for the key instead of failing on the first look.
 */
export async function publicKeyHex(
  session: Pick<WalletSession, "manager">,
  timeoutMs = 10_000,
  intervalMs = 250,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const key = session.manager.getPubkey(0, 0n);

    if (key) {
      return hex(key);
    }

    if (Date.now() >= deadline) {
      throw new Error("The wallet did not share a receive key. Keep the wallet open on its home screen and try again.");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Asks the wallet to sign a request from the server. The wallet never broadcasts here. Kind "proof" is a message-only
 * request that moves no funds; kind "transaction" is a real payment that the server checks and then sends.
 */
export async function signWithWallet(session: WalletSession, request: object, kind: SigningKind = "proof"): Promise<string> {
  // The prompt tells the person to open their wallet and approve while this waits.
  const response = await trackSigning(kind, () =>
    session.manager.signTransaction({
      transaction: request as never,
      inputPaths: [[0, "receive", 0]],
    }),
  );

  if (response.error) {
    throw new Error(`Wallet refused: ${response.error}`);
  }

  return response.signedTransaction;
}
