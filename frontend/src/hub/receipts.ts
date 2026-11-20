import type { ReceiptNetwork } from "./api";

/** A public explorer page for a receipt transaction. */
export function explorerUrl(network: ReceiptNetwork, txid: string): string {
  return network === "mainnet"
    ? `https://blockchair.com/bitcoin-cash/transaction/${txid}`
    : `https://chipnet.chaingraph.cash/tx/${txid}`;
}

export const networkLabel = (network: ReceiptNetwork): string =>
  network === "mainnet" ? "Mainnet" : "Chipnet (test network)";
