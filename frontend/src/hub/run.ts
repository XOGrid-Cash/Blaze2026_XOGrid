import { hub } from "./api";

/** The registry identifier of the Drip Mine template (templates/drip-mine). Live runs are offered only for this exact template. */
export const DRIP_MINE_TEMPLATE_IDENTIFIER =
  "346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185";

export type RunNetwork = "chipnet" | "mainnet";

export interface DripCoinView {
  txid: string;
  index: number;
  satoshis: number;
  height: number;
  action: "drip" | "terminate";
  payoutSatoshis: number;
  remainderSatoshis: number;
  spendable: boolean;
  reason?: string;
}

export interface DripRun {
  network: RunNetwork;
  transactionId: string;
  transactionHex: string;
  action: "drip" | "terminate";
  coin: { txid: string; index: number; satoshis: number };
  payoutSatoshis: number;
  remainderSatoshis: number;
  sizeBytes: number;
  coinsSkipped?: number;
  /** What built the transaction: the XO engine and the template it used. */
  builtBy?: { engine: string; templateIdentifier: string };
}

/** An XO invitation for one coin, for the user's own wallet to import and broadcast. Nothing has been broadcast. */
export interface DripInvitation {
  network: RunNetwork;
  /** The serialized XO invitation: what the user copies or downloads. */
  invitation: string;
  invitationIdentifier: string;
  /** ISO time when the earliest commit expires. */
  expiresAt: string;
  /** The transaction the wallet will build from the invitation. */
  transactionId: string;
  transactionHex: string;
  action: "drip" | "terminate";
  coin: { txid: string; index: number; satoshis: number };
  payoutSatoshis: number;
  remainderSatoshis: number;
  sizeBytes: number;
  builtBy?: { engine: string; templateIdentifier: string };
}

export const prepareDripInvitation = (body: { network: RunNetwork; txid: string; index: number }) =>
  hub<DripInvitation>("/api/run/drip-mine/invitation", { method: "POST", body });

export const listDripCoins = (network: RunNetwork) =>
  hub<{ network: RunNetwork; address: string; coins: DripCoinView[] }>(
    `/api/run/drip-mine/coins?network=${network}`,
  );

export const runDripMine = (body: {
  network: RunNetwork;
  txid: string;
  index: number;
  confirmMainnet: boolean;
  anyCoin?: boolean;
}) => hub<DripRun>("/api/run/drip-mine", { method: "POST", body });
