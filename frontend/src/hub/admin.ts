// Moderator client for the XOGrid admin API.
//
// Who is a moderator is decided by the SERVER: it checks a wallet signature against its allowlist
// (ADMIN_IDENTITIES) and hands out a one-hour session token. Nothing in the browser decides access, so this file only
// stores the token and calls the API. A user who edits the page in dev tools gets a login screen and 401 responses.

import { useEffect, useState } from "react";

import { hub, type Summary } from "./api";

const TOKEN_KEY = "xogrid-admin-token";

export function readAdminToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAdminToken(value: string): void {
  try {
    if (value) {
      sessionStorage.setItem(TOKEN_KEY, value);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode). The session then lasts until the page closes.
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const CHANGE_EVENT = "xogrid-admin-change";

/** Re-renders when a moderator signs in or out, so the menu link and the Admin page follow along. */
export function useHasAdminToken(): boolean {
  const [value, setValue] = useState(() => readAdminToken() !== "");

  useEffect(() => {
    const update = () => setValue(readAdminToken() !== "");

    window.addEventListener(CHANGE_EVENT, update);

    return () => window.removeEventListener(CHANGE_EVENT, update);
  }, []);

  return value;
}

/** Cosmetic only, for showing a menu link. The server still checks every request. */
export const hasAdminToken = (): boolean => readAdminToken() !== "";

export interface AdminSummary {
  templates: {
    total: number;
    removed: number;
    byBadge: Record<string, number>;
    withFailingChecks: number;
  };
  openFlags: number;
  reviews: number;
  recentActions: {
    actor: string;
    action: string;
    identifier: string | null;
    note: string;
    at: string;
  }[];
}

export interface AdminFlag {
  id: number;
  identifier: string;
  templateName: string;
  reason: string;
  reporter: string;
  status: string;
  createdAt: string;
}

export interface AdminUserReview {
  id: number;
  identifier: string;
  /** Public key hex. */
  reviewer: string;
  reviewerAddress: string;
  reviewerName: string | null;
  rating: number;
  body: string;
  created_at: string;
  hidden: number;
  hidden_reason: string | null;
}

export interface AdminChallenge {
  nonce: string;
  expiresAt: string;
  message: string;
  walletSignRequest?: object;
}

export interface AdminLogin {
  token: string;
  admin: string;
  expiresAt: string;
}

/** Thrown for a 401 from a moderator route, so the page can send the person back to the login screen. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Your moderator session ended. Sign in again.");
  }
}

async function call<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  try {
    return await hub<T>(path, { method, body, token });
  } catch (reason) {
    if (reason instanceof Error && /\(401\)|login required/i.test(reason.message)) {
      throw new SessionExpiredError();
    }

    throw reason;
  }
}

// ----- login (no token yet) -----

export const requestChallenge = (publicKey: string) =>
  hub<AdminChallenge>("/api/admin/challenge", { method: "POST", body: { publicKey } });

export const submitLogin = (nonce: string, signedTransaction: string) =>
  hub<AdminLogin>("/api/admin/login", {
    method: "POST",
    body: { nonce, proof: { type: "transaction", signedTransaction } },
  });

// ----- session -----

export const adminMe = (token: string) => call<{ admin: string; expiresAt: string }>(token, "/api/admin/me");

export const adminLogout = (token: string) =>
  hub("/api/admin/logout", { method: "POST", body: {}, token }).catch(() => undefined);

// ----- reading -----

export const adminSummary = (token: string) => call<AdminSummary>(token, "/api/admin/summary");

export const adminFlags = (token: string) => call<{ items: AdminFlag[] }>(token, "/api/admin/flags?status=open");

export const adminTemplates = (token: string, query: string) =>
  call<{ items: Summary[]; total: number }>(
    token,
    `/api/admin/templates?pageSize=50${query.trim() ? `&query=${encodeURIComponent(query.trim())}` : ""}`,
  );

export const adminUserReviews = (token: string) =>
  call<{ items: AdminUserReview[] }>(token, "/api/admin/user-reviews");

// ----- acting -----

export const resolveFlag = (token: string, id: number, status: "dismissed" | "upheld") =>
  call(token, `/api/admin/flags/${id}/resolve`, "POST", { status });

export const reviewTemplate = (token: string, identifier: string, note: string) =>
  call(token, `/api/admin/templates/${identifier}/review`, "POST", { note });

export const removeTemplate = (token: string, identifier: string, reason: string) =>
  call(token, `/api/admin/templates/${identifier}/remove`, "POST", { reason });

export const restoreTemplate = (token: string, identifier: string) =>
  call(token, `/api/admin/templates/${identifier}/restore`, "POST", {});

/** Replaces a template's categories (moderators only). The server drops duplicates and keeps the canonical order. */
export const setTemplateCategories = (token: string, identifier: string, categories: string[]) =>
  call(token, `/api/admin/templates/${identifier}/categories`, "PUT", { categories });

/** Sets the name shown as a template's publisher, or clears it with null (moderators only). */
export const setTemplatePublisherName = (token: string, identifier: string, name: string | null) =>
  call(token, `/api/admin/templates/${identifier}/publisher-name`, "PUT", { name });

export interface FeaturedItem {
  identifier: string;
  blurb: string;
}

/** The Home page's featured list (public endpoint). */
export const featuredList = () =>
  hub<{ items: (Summary & { blurb: string })[] }>("/api/spotlight").then((result) =>
    result.items.map((item): FeaturedItem => ({ identifier: item.identifier, blurb: item.blurb })),
  );

/** Saves the whole featured list (at most 6). The API replaces the list, so callers send the full new list. */
export const saveFeatured = (token: string, items: FeaturedItem[]) =>
  call(token, "/api/admin/spotlight", "PUT", { items });

export const hideUserReview = (token: string, id: number, reason: string) =>
  call(token, `/api/admin/user-reviews/${id}/hide`, "POST", { reason });

export const unhideUserReview = (token: string, id: number) =>
  call(token, `/api/admin/user-reviews/${id}/unhide`, "POST", {});

// ----- named users (display names for outside publishers and reviewers) -----

export interface NamedUser {
  id: number;
  name: string;
  createdAt: string;
  createdBy: string;
  addresses: { address: string; addedAt: string }[];
}

export const adminUsers = (token: string) => call<{ items: NamedUser[] }>(token, "/api/admin/users");

export const createNamedUser = (token: string, name: string, addresses: string[]) =>
  call<NamedUser>(token, "/api/admin/users", "POST", { name, addresses });

export const renameNamedUser = (token: string, id: number, name: string) =>
  call<NamedUser>(token, `/api/admin/users/${id}`, "PUT", { name });

export const addNamedUserAddresses = (token: string, id: number, addresses: string[]) =>
  call<NamedUser>(token, `/api/admin/users/${id}/addresses`, "POST", { addresses });

export const removeNamedUserAddress = (token: string, id: number, address: string) =>
  call<NamedUser>(token, `/api/admin/users/${id}/addresses/${encodeURIComponent(address)}`, "DELETE");

export const deleteNamedUser = (token: string, id: number) => call(token, `/api/admin/users/${id}`, "DELETE");

/** Splits pasted text (commas, spaces or new lines) into address entries. */
export const splitAddresses = (text: string): string[] => text.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
