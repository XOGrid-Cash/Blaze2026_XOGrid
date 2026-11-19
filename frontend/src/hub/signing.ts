// Tracks "the wallet has been asked to sign and we are waiting", so one prompt can tell the person to open their
// wallet and approve. Every place that asks the wallet to sign goes through trackSigning, so the prompt appears the
// same way for a review, the moderator sign-in and the Demo.

export type SigningKind =
  /** A request that only proves the wallet is yours. Nothing is broadcast and no funds move. */
  | "proof"
  /** A real transaction. Approving it moves funds. */
  | "transaction";

export interface SigningRequest {
  id: number;
  kind: SigningKind;
  startedAt: number;
  /** Stops waiting. The wallet may still show the request, and the person can reject it there. */
  cancel: () => void;
}

/** Thrown to the caller when the person cancels the wait. */
export class SigningCancelledError extends Error {
  constructor() {
    super("You cancelled the signing request. If your wallet still shows it, reject it there.");
    this.name = "SigningCancelledError";
  }
}

const active = new Map<number, SigningRequest>();
const listeners = new Set<() => void>();
let nextId = 1;
// useSyncExternalStore needs the same object back until something changes, so the newest request is kept in a variable.
let snapshot: SigningRequest | null = null;

function publish() {
  let newest: SigningRequest | null = null;

  for (const request of active.values()) {
    if (!newest || request.id > newest.id) newest = request;
  }

  snapshot = newest;
  listeners.forEach((listener) => listener());
}

export function subscribeSigning(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getSigning(): SigningRequest | null {
  return snapshot;
}

/**
 * Runs a request to the wallet while showing the "approve in your wallet" prompt. Returns the wallet's answer
 * unchanged, passes on its errors, and rejects with SigningCancelledError if the person cancels the wait.
 */
export async function trackSigning<T>(kind: SigningKind, run: () => Promise<T>): Promise<T> {
  const id = nextId++;
  let cancel: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new SigningCancelledError());
  });

  active.set(id, { id, kind, startedAt: Date.now(), cancel });
  publish();

  try {
    // Both promises are watched by the race, so a late answer from the wallet after a cancel is ignored quietly.
    return await Promise.race([run(), cancelled]);
  } finally {
    active.delete(id);
    publish();
  }
}
