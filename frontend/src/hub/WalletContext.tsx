import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { hexToBin } from "@bitauth/libauth";

import { addressFor, walletLockingBytecode } from "../voucher/core";
import {
  forgetStoredWalletSession,
  hasStoredWalletSession,
  publicKeyHex,
  resumeWalletSession,
  startWalletSession,
  type WalletSession,
} from "./wallet";

// One wallet connection for the whole site. The navbar, the connect modal, the Dashboard, the Admin sign-in, the review
// form and the Demo all read it from here, so a person connects once and every page sees the same wallet.
//
// The connection survives page reloads and moving around the site (the relay credentials sit in sessionStorage, see
// hub/wallet.ts). It ends when the person disconnects, when the wallet closes it, when the tab is closed, or after
// IDLE_LIMIT_MS without any activity on the page. Nothing here holds wallet keys; the wallet signs on its own device.

export const IDLE_LIMIT_MS = 20 * 60 * 1000;
const ACTIVITY_KEY = "xogrid-wallet-activity";
const RESUME_TIMEOUT_MS = 20_000;
const KEY_ATTEMPTS = 4;

export interface OpenModalOptions {
  /** Where to go as soon as the wallet connects (for example "/dashboard"). */
  redirectTo?: string;
}

export interface WalletContextValue {
  /** The live WizardConnect session, or null when nothing is connected or pending. */
  session: WalletSession | null;
  /** Wallet name once the wallet is ready, otherwise an empty string. */
  walletName: string;
  /** True only when a wallet has announced it is ready. */
  connected: boolean;
  /** True while a connection from earlier in this tab is being picked back up. */
  restoring: boolean;
  /** The wallet's first receive address on mainnet (bitcoincash:), or "" until the wallet has shared its key. */
  address: string;
  /** Last relay status text, for display while connecting. */
  status: string;
  modalOpen: boolean;
  openModal: (options?: OpenModalOptions) => void;
  closeModal: () => void;
  /** Starts a fresh WizardConnect session, replacing any pending or live one. Returns it so the caller can show the QR. */
  start: () => WalletSession;
  /** Ends the session (pending or connected). */
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** "bitcoincash:qp9c…tw6y": the prefix, the first four and the last four characters. Short strings are returned as they are. */
export function shortenAddress(address: string): string {
  const separator = address.indexOf(":");
  const prefix = separator >= 0 ? address.slice(0, separator + 1) : "";
  const body = separator >= 0 ? address.slice(separator + 1) : address;

  return body.length > 12 ? `${prefix}${body.slice(0, 4)}…${body.slice(-4)}` : address;
}

function readActivity(): number {
  try {
    return Number(window.sessionStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeActivity(value: number): void {
  try {
    if (value === 0) {
      window.sessionStorage.removeItem(ACTIVITY_KEY);
    } else {
      window.sessionStorage.setItem(ACTIVITY_KEY, String(value));
    }
  } catch {
    // Storage blocked: the idle limit then only applies while this page stays open.
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [walletName, setWalletName] = useState("");
  const [status, setStatus] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [restoring, setRestoring] = useState(false);

  const sessionRef = useRef<WalletSession | null>(null);
  const connectedRef = useRef(false);
  const redirectRef = useRef<string | null>(null);
  const lastTouch = useRef(0);

  const clearState = useCallback(() => {
    sessionRef.current = null;
    connectedRef.current = false;
    setSession(null);
    setWalletName("");
    setPublicKey("");
    setStatus("");
    setRestoring(false);
  }, []);

  // Ends the connection for good (person disconnected, idle limit, abandoned attempt).
  const teardown = useCallback(() => {
    sessionRef.current?.end();
    redirectRef.current = null;
    writeActivity(0);
    clearState();
  }, [clearState]);

  const touch = useCallback(() => {
    const at = Date.now();

    // Writing storage on every mouse move would be wasteful: once every five seconds is plenty for a 20 minute limit.
    if (at - lastTouch.current > 5_000) {
      lastTouch.current = at;
      writeActivity(at);
    }
  }, []);

  // Callbacks handed to a session. They ignore late events from a session that has since been replaced or ended.
  const handlersFor = useCallback(
    (getSession: () => WalletSession | undefined) => {
      const isCurrent = () => {
        const created = getSession();

        return created === undefined || sessionRef.current === created;
      };

      return {
        onStatus: (text: string) => {
          if (isCurrent()) setStatus(text);
        },
        onReady: (name: string) => {
          if (!isCurrent()) return;
          connectedRef.current = true;
          lastTouch.current = 0;
          touch();
          setRestoring(false);
          setWalletName(name);
        },
        onDisconnect: () => {
          if (!isCurrent()) return;
          sessionRef.current = null;
          connectedRef.current = false;
          writeActivity(0);
          setSession(null);
          setWalletName("");
          setPublicKey("");
          setRestoring(false);
          setStatus("Wallet disconnected.");
        },
      };
    },
    [touch],
  );

  const start = useCallback((): WalletSession => {
    sessionRef.current?.end();
    connectedRef.current = false;
    setWalletName("");
    setPublicKey("");
    setStatus("");
    setRestoring(false);

    let created: WalletSession | undefined;
    const handlers = handlersFor(() => created);

    created = startWalletSession(handlers.onStatus, handlers.onReady, handlers.onDisconnect);
    sessionRef.current = created;
    setSession(created);

    return created;
  }, [handlersFor]);

  const openModal = useCallback((options?: OpenModalOptions) => {
    redirectRef.current = options?.redirectTo ?? null;
    setModalOpen(true);
  }, []);

  // Closing the modal keeps a connected wallet, but drops a connection attempt nobody finished.
  const closeModal = useCallback(() => {
    setModalOpen(false);

    if (!connectedRef.current) {
      teardown();
    }
  }, [teardown]);

  // Pick a connection from earlier in this tab back up (page reload, or a link followed from elsewhere on the site).
  useEffect(() => {
    if (!hasStoredWalletSession()) return;

    const last = readActivity();

    if (last !== 0 && Date.now() - last > IDLE_LIMIT_MS) {
      forgetStoredWalletSession();
      writeActivity(0);

      return;
    }

    let created: WalletSession | undefined;
    const handlers = handlersFor(() => created);
    let resumed: WalletSession | null = null;

    try {
      resumed = resumeWalletSession(handlers.onStatus, handlers.onReady, handlers.onDisconnect);
    } catch {
      // A stored pairing the library rejects (damaged, or saved in an older format) must not take the whole site
      // down. Forget it; the person simply connects again.
      forgetStoredWalletSession();
      writeActivity(0);

      return;
    }

    if (!resumed) return;

    created = resumed;
    sessionRef.current = resumed;
    setSession(resumed);
    setRestoring(true);

    // The wallet may be asleep or have dropped the pairing: give up after a while instead of waiting forever.
    const giveUp = window.setTimeout(() => {
      if (sessionRef.current === resumed && !connectedRef.current) {
        resumed.end();
        writeActivity(0);
        clearState();
      }
    }, RESUME_TIMEOUT_MS);

    return () => {
      window.clearTimeout(giveUp);
      // Release only: the stored pairing stays so the next mount (React StrictMode, reload) can resume it.
      resumed.cleanup();

      if (sessionRef.current === resumed) {
        sessionRef.current = null;
        connectedRef.current = false;
        setSession(null);
        setWalletName("");
        setRestoring(false);
      }
    };
  }, [handlersFor, clearState]);

  // Release the relay when the provider goes away (leaves the pairing stored for a resume).
  useEffect(
    () => () => {
      sessionRef.current?.cleanup();
    },
    [],
  );

  // Idle limit: any activity on the page keeps the wallet connected; 20 minutes without any ends it.
  useEffect(() => {
    if (!walletName) return;

    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    const check = () => {
      const last = readActivity();

      if (last !== 0 && Date.now() - last > IDLE_LIMIT_MS) {
        teardown();
        setStatus("Disconnected after 20 minutes without activity.");
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        check();
        touch();
      }
    };

    for (const name of events) window.addEventListener(name, touch, { passive: true });

    document.addEventListener("visibilitychange", onVisible);

    const timer = window.setInterval(check, 30_000);

    return () => {
      for (const name of events) window.removeEventListener(name, touch);

      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [walletName, touch, teardown]);

  // Wallets announce "ready" slightly before their keys arrive. Wait for the first receive key (it is what the address
  // is made from) and try again a few times if it is slow, so the address shows up reliably.
  useEffect(() => {
    if (!walletName || !session) return;

    let current = true;

    (async () => {
      for (let attempt = 0; attempt < KEY_ATTEMPTS && current; attempt += 1) {
        try {
          const key = await publicKeyHex(session, 8_000);

          if (current) setPublicKey(key);

          return;
        } catch {
          // Try again.
        }
      }
    })();

    return () => {
      current = false;
    };
  }, [walletName, session]);

  // Went to a page that asked for a connection: go on to the page that was wanted as soon as the wallet is ready.
  useEffect(() => {
    if (walletName && redirectRef.current) {
      const target = redirectRef.current;

      redirectRef.current = null;
      setModalOpen(false);
      navigate(target);
    }
  }, [walletName, navigate]);

  // Always the mainnet form of the address; the same key is the same wallet on every network.
  const address = useMemo(() => {
    if (!publicKey) return "";

    try {
      return addressFor(walletLockingBytecode(hexToBin(publicKey)), "mainnet");
    } catch {
      return "";
    }
  }, [publicKey]);

  const value = useMemo<WalletContextValue>(
    () => ({
      session,
      walletName,
      connected: walletName !== "",
      restoring,
      address,
      status,
      modalOpen,
      openModal,
      closeModal,
      start,
      disconnect: teardown,
    }),
    [session, walletName, restoring, address, status, modalOpen, openModal, closeModal, start, teardown],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);

  if (!value) {
    throw new Error("useWallet must be used inside <WalletProvider>.");
  }

  return value;
}
