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
}

export const listDripCoins = (network: RunNetwork) =>
  hub<{ network: RunNetwork; address: string; coins: DripCoinView[] }>(
    `/api/run/drip-mine/coins?network=${network}`,
  );

export const runDripMine = (body: {
  network: RunNetwork;
  txid: string;
  index: number;
  confirmMainnet: boolean;
}) => hub<DripRun>("/api/run/drip-mine", { method: "POST", body });
