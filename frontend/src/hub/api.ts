
// Typed client for the XOGrid registry API.
// Shapes mirror docs/FRONTEND.md; keep both in step with the server.

export type Badge = "unchecked" | "auto-checked" | "reviewed";

export interface Counts {
  pass: number;
  warn: number;
  fail: number;
  skipped: number;
}

export interface Summary {
  identifier: string;
  name: string;
  description: string;
  publisher: string;
  /** Display name an admin registered for the publisher's address, or null. */
  publisherName: string | null;
  createdAt: string;
  badge: Badge;
  openFlags: number;
  reviewCount: number;
  userReviewCount: number;
  averageRating: number | null;
  removed: boolean;
  removedReason: string | null;
  /** Category slugs, in display order. A template can be in several. */
  categories: string[];
  audit: {
    checkerVersion: string;
    counts: Counts;
  } | null;
}

export interface CategoryList {
  total: number;
  categories: { slug: string; label: string; count: number }[];
}

export interface CheckResult {
  id: string;
  title: string;
  status: "pass" | "warn" | "fail" | "skipped";
  message: string;
  details?: string[];
}

export interface PlainEnglish {
  summary: string;
  steps: string[];
  whoDoesWhat: string[];
  youWillNeed: string[];
}

export interface Detail extends Summary {
  template: unknown;
  plainEnglish: PlainEnglish | null;
  auditReport: {
    checkerVersion: string;
    results: CheckResult[];
  } | null;
  actions: {
    id: string;
    name: string;
    description: string;
    roles: string[];
  }[];
  roles: {
    id: string;
    name: string;
    description: string;
  }[];
  flags: {
    id: number;
    reason: string;
    reporter: string;
    status: string;
    createdAt: string;
  }[];
  reviews: {
    id: number;
    reviewerAddress: string;
    reviewerLabel?: string | null;
    note: string;
    createdAt: string;
  }[];
}

export interface UserReview {
  id: number;
  reviewerAddress: string;
  reviewer: string;
  /** Display name an admin registered for the reviewer's address, or null. */
  reviewerName: string | null;
  rating: number;
  body: string;
  createdAt: string;
  /** The on-chain receipt, when the reviewer recorded one. "pending" is sent but not confirmed yet. */
  receipt: { txid: string; network: ReceiptNetwork; status: "confirmed" | "pending" } | null;
}

export type ReceiptNetwork = "mainnet" | "chipnet";

export interface ReceiptSettings {
  enabled: boolean;
  paymentSatoshis: string;
  networks: Partial<Record<ReceiptNetwork, { address: string }>>;
}

export interface PreparedReceipt {
  walletSignRequest: object;
  network: ReceiptNetwork;
  reviewAddress: string;
  paymentSatoshis: string;
  feeSatoshis: string;
  totalSatoshis: string;
}

export interface ReceiptStatus {
  status: "confirmed" | "pending";
  txid: string;
  network: ReceiptNetwork;
}

export interface ReviewStats {
  count: number;
  average: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export interface ReviewPage {
  items: UserReview[];
  total: number;
  page: number;
  pageSize: number;
  stats: ReviewStats;
}

export interface ReviewChallenge {
  nonce: string;
  expiresAt: number;
  message: string;
  review: {
    rating: number;
    body: string;
  };
  walletSignRequest?: object;
}

export interface PublishResponse {
  identifier: string;
  created: boolean;
  badge: Badge;
  categories?: string[];
}

export type TemplateSort = "newest" | "name" | "flagged" | "rating";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) || "";

export async function hub<T>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    token?: string;
  } = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
        ...(init.token
          ? { authorization: `Bearer ${init.token}` }
          : {}),
      },
      body:
        init.body !== undefined
          ? JSON.stringify(init.body)
          : undefined,
    });
  } catch {
    throw new Error(
      "Unable to reach the XOGrid server. Check your connection and try again.",
    );
  }

  const data: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage =
      data !== null &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;

    throw new Error(errorMessage);
  }

  return data as T;
}

export function listTemplates(params: {
  query?: string;
  badge?: Badge;
  category?: string;
  sort?: TemplateSort;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: Summary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }

  return hub(`/api/templates?${search.toString()}`);
}

export const getTemplate = (identifier: string) =>
  hub<Detail>(`/api/templates/${encodeURIComponent(identifier)}`);

export const listReviews = (identifier: string, page = 1) =>
  hub<ReviewPage>(
    `/api/templates/${encodeURIComponent(identifier)}/reviews?page=${page}&pageSize=10`,
  );

export const startReview = (
  identifier: string,
  rating: number,
  body: string,
  publicKey: string,
) =>
  hub<ReviewChallenge>(
    `/api/templates/${encodeURIComponent(identifier)}/reviews/challenge`,
    {
      method: "POST",
      body: {
        rating,
        body,
        publicKey,
      },
    },
  );

export const finishReview = (
  identifier: string,
  nonce: string,
  signedTransaction: string,
) =>
  hub<{
    id: number;
    reviewerAddress: string;
    rating: number;
    body: string;
  }>(`/api/templates/${encodeURIComponent(identifier)}/reviews`, {
    method: "POST",
    body: {
      nonce,
      proof: {
        type: "transaction",
        signedTransaction,
      },
    },
  });

const receiptBase = (identifier: string, reviewId: number) =>
  `/api/templates/${encodeURIComponent(identifier)}/reviews/${reviewId}/receipt`;

export const getReceiptSettings = () => hub<ReceiptSettings>("/api/receipts/config");

export const prepareReceipt = (identifier: string, reviewId: number, network: ReceiptNetwork, publicKey: string) =>
  hub<PreparedReceipt>(`${receiptBase(identifier, reviewId)}/prepare`, { method: "POST", body: { network, publicKey } });

export const broadcastReceipt = (identifier: string, reviewId: number, network: ReceiptNetwork, signedTransaction: string) =>
  hub<ReceiptStatus>(`${receiptBase(identifier, reviewId)}/broadcast`, { method: "POST", body: { network, signedTransaction } });

export const checkReceipt = (identifier: string, reviewId: number, network: ReceiptNetwork, txid: string) =>
  hub<ReceiptStatus>(receiptBase(identifier, reviewId), { method: "POST", body: { network, txid } });

export const flagTemplate = (identifier: string, reason: string) =>
  hub<{ id: number }>(
    `/api/templates/${encodeURIComponent(identifier)}/flags`,
    {
      method: "POST",
      body: {
        reason,
      },
    },
  );

// Publish a template to the XOGrid registry.
// The server returns HTTP 201 for a new template
// or HTTP 200 when the template already exists.

export const getCategories = () => hub<CategoryList>("/api/categories");

export const publishTemplate = (
  template: unknown,
  publisher?: string,
  categories?: string[],
): Promise<PublishResponse> =>
  hub<PublishResponse>("/api/templates", {
    method: "POST",
    body: {
      template,
      ...(publisher ? { publisher } : {}),
      ...(categories && categories.length > 0 ? { categories } : {}),
    },
  });



/**
 * The template's exact published JSON text. Its identifier is a hash of this content, so a copy or a downloaded
 * file is something an XO wallet or the Blaze Tool can import as it is.
 */
export async function fetchRawTemplate(identifier: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch(`${BASE}/api/templates/${encodeURIComponent(identifier)}/raw`);
  } catch {
    throw new Error("Unable to reach the XOGrid server. Check your connection and try again.");
  }

  if (response.status === 410) {
    throw new Error("This template was removed by a moderator.");
  }

  if (!response.ok) {
    throw new Error(`Could not load the template JSON (${response.status}).`);
  }

  return response.text();
}
