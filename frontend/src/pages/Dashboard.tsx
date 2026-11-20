
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Compass,
  ExternalLink,
  Flag,
  Library,
  Plus,
  Search,
  ShieldCheck,
  Star,
  Upload,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

import { listTemplates, type Badge, type Summary } from "../hub/api";
import { shortenAddress, useWallet } from "../hub/WalletContext";

type StatIcon = "explore" | "publish" | "checked" | "flags";
type StatColor = "purple" | "orange" | "green" | "blue";

type DashboardStat = {
  label: string;
  value: string;
  change: string;
  icon: StatIcon;
  color: StatColor;
};

const BADGE_LABEL: Record<Badge, string> = {
  unchecked: "Unchecked",
  "auto-checked": "Auto-checked",
  reviewed: "Reviewed",
};

const PAGE_SIZE = 50;
const MAX_PAGES = 10;

/** Every template in the registry (the API pages at 50, so this walks the pages). */
async function loadAllTemplates(): Promise<Summary[]> {
  const all: Summary[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await listTemplates({ sort: "newest", page, pageSize: PAGE_SIZE });

    all.push(...result.items);

    if (all.length >= result.total || result.items.length === 0) break;
  }

  return all;
}

const formatDate = (iso: string): string => {
  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

const iconMap: Record<StatIcon, LucideIcon> = {
  explore: Compass,
  publish: Upload,
  checked: ShieldCheck,
  flags: Flag,
};

const colorMap: Record<
  StatColor,
  {
    icon: string;
    glow: string;
  }
> = {
  purple: {
    icon: "bg-violet-500/10 text-violet-300",
    glow: "group-hover:border-violet-400/30",
  },
  orange: {
    icon: "bg-orange-500/10 text-orange-400",
    glow: "group-hover:border-orange-400/30",
  },
  green: {
    icon: "bg-emerald-500/10 text-emerald-400",
    glow: "group-hover:border-emerald-400/30",
  },
  blue: {
    icon: "bg-sky-500/10 text-sky-400",
    glow: "group-hover:border-sky-400/30",
  },
};

function Dashboard() {
  const { address, walletName } = useWallet();
  const [searchQuery, setSearchQuery] = useState("");
  const [all, setAll] = useState<Summary[] | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let current = true;

    loadAllTemplates()
      .then((items) => {
        if (current) setAll(items);
      })
      .catch((reason: unknown) => {
        if (current) setLoadError(reason instanceof Error ? reason.message : "Could not load the registry.");
      });

    return () => {
      current = false;
    };
  }, []);

  // "Yours" means published while this wallet was connected (the publish form sends the wallet address).
  const mine = useMemo(
    () => (all && address ? all.filter((template) => template.publisher === address) : []),
    [all, address],
  );

  const newest = useMemo(() => (all ?? []).slice(0, 5), [all]);
  const loading = all === null && !loadError;
  const dash = loading ? "…" : "0";

  const stats: DashboardStat[] = [
    {
      label: "Templates in the registry",
      value: all ? String(all.length) : dash,
      change: "Live from the registry",
      icon: "explore",
      color: "purple",
    },
    {
      label: "Published by you",
      value: all ? String(mine.length) : dash,
      change: address ? `Wallet ${shortenAddress(address)}` : "Resolving your wallet address",
      icon: "publish",
      color: "orange",
    },
    {
      label: "Checked or reviewed",
      value: all ? String(all.filter((template) => template.badge !== "unchecked").length) : dash,
      change: all
        ? `${all.filter((template) => template.badge === "reviewed").length} reviewed by a person`
        : "Auto-checked and reviewed",
      icon: "checked",
      color: "green",
    },
    {
      label: "Open flags on your templates",
      value: all ? String(mine.reduce((total, template) => total + template.openFlags, 0)) : dash,
      change: "Community reports awaiting review",
      icon: "flags",
      color: "blue",
    },
  ];

  const filteredTemplates = mine.filter((template) =>
    `${template.name} ${template.identifier}`.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05070b] text-white">
      <style>{`
        @keyframes xogridFadeUp {
          from {
            opacity: 0;
            transform: translateY(28px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes xogridFloat {
          0%, 100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(22px, -25px, 0);
          }
        }

        @keyframes xogridPulse {
          0%, 100% {
            opacity: 0.5;
            box-shadow: 0 0 5px rgba(167, 139, 250, 0.3);
          }
          50% {
            opacity: 1;
            box-shadow: 0 0 16px rgba(167, 139, 250, 0.9);
          }
        }

        @keyframes xogridShimmer {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(220%);
          }
        }

        .xogrid-section-enter {
          animation: xogridFadeUp 0.8s cubic-bezier(.2,.8,.2,1) both;
        }

        .xogrid-stat-card {
          animation: xogridFadeUp 0.8s cubic-bezier(.2,.8,.2,1) both;
          transition:
            transform 0.35s ease,
            border-color 0.35s ease,
            background 0.35s ease,
            box-shadow 0.35s ease;
        }

        .xogrid-stat-card:nth-child(1) {
          animation-delay: 0.12s;
        }

        .xogrid-stat-card:nth-child(2) {
          animation-delay: 0.22s;
        }

        .xogrid-stat-card:nth-child(3) {
          animation-delay: 0.32s;
        }

        .xogrid-stat-card:nth-child(4) {
          animation-delay: 0.42s;
        }

        .xogrid-stat-card:hover {
          transform: translateY(-7px);
          box-shadow: 0 18px 45px rgba(0, 0, 0, 0.3);
        }

        .xogrid-template-row {
          animation: xogridFadeUp 0.6s ease-out both;
          transition: background 0.3s ease;
        }

        .xogrid-template-row:nth-child(1) {
          animation-delay: 0.12s;
        }

        .xogrid-template-row:nth-child(2) {
          animation-delay: 0.2s;
        }

        .xogrid-template-row:nth-child(3) {
          animation-delay: 0.28s;
        }

        .xogrid-template-row:hover {
          background: rgba(255, 255, 255, 0.035);
        }

        .xogrid-activity-item {
          animation: xogridFadeUp 0.65s ease-out both;
        }

        .xogrid-activity-item:nth-child(1) {
          animation-delay: 0.12s;
        }

        .xogrid-activity-item:nth-child(2) {
          animation-delay: 0.22s;
        }

        .xogrid-activity-item:nth-child(3) {
          animation-delay: 0.32s;
        }

        .xogrid-activity-item:nth-child(4) {
          animation-delay: 0.42s;
        }

        .xogrid-ambient-one {
          animation: xogridFloat 13s ease-in-out infinite;
        }

        .xogrid-ambient-two {
          animation: xogridFloat 17s ease-in-out infinite reverse;
        }

        .xogrid-ambient-three {
          animation: xogridFloat 20s ease-in-out infinite;
        }

        .xogrid-status-dot {
          animation: xogridPulse 2.5s ease-in-out infinite;
        }

        .xogrid-primary-button {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          transition:
            transform 0.3s ease,
            box-shadow 0.3s ease,
            background 0.3s ease;
        }

        .xogrid-primary-button::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          width: 45%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255,255,255,0.2),
            transparent
          );
          transform: translateX(-120%);
          transition: none;
        }

        .xogrid-primary-button:hover::before {
          animation: xogridShimmer 0.8s ease;
        }

        .xogrid-primary-button:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 32px rgba(249, 115, 22, 0.22);
        }

        .xogrid-primary-button:active {
          transform: scale(0.97);
        }

        .xogrid-panel {
          transition:
            border-color 0.35s ease,
            background 0.35s ease,
            box-shadow 0.35s ease;
        }

        .xogrid-panel:hover {
          border-color: rgba(167, 139, 250, 0.2);
          box-shadow: 0 16px 45px rgba(0, 0, 0, 0.2);
        }

        @media (prefers-reduced-motion: reduce) {
          .xogrid-section-enter,
          .xogrid-stat-card,
          .xogrid-template-row,
          .xogrid-activity-item,
          .xogrid-ambient-one,
          .xogrid-ambient-two,
          .xogrid-ambient-three,
          .xogrid-status-dot {
            animation: none !important;
          }

          .xogrid-stat-card,
          .xogrid-primary-button,
          .xogrid-panel {
            transition: none !important;
          }
        }
      `}</style>

      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="xogrid-ambient-one absolute -left-48 -top-48 h-[500px] w-[500px] rounded-full bg-violet-600/[0.08] blur-[140px]" />
        <div className="xogrid-ambient-two absolute right-0 top-[20%] h-[400px] w-[400px] rounded-full bg-orange-500/[0.035] blur-[140px]" />
        <div className="xogrid-ambient-three absolute bottom-0 left-[35%] h-[350px] w-[350px] rounded-full bg-violet-500/[0.04] blur-[140px]" />
      </div>

      {/* Dashboard content */}
      <div className="relative mx-auto max-w-[1600px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
        {/* Welcome */}
        <section className="xogrid-section-enter mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-400/15 bg-violet-500/[0.07] px-3 py-1.5">
              <span className="xogrid-status-dot h-1.5 w-1.5 rounded-full bg-violet-400 shadow-[0_0_10px_#a78bfa]" />

              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-violet-300">
                Your workspace
              </span>
            </div>

            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Welcome back
              <span className="text-orange-400">.</span>
            </h2>

            <p className="mt-2 max-w-xl text-sm leading-6 text-white/45">
              Keep track of your templates, explore the registry, and
              contribute to the XOGrid ecosystem.
            </p>
          </div>

          <Link
            to="/publish"
            className="xogrid-primary-button group inline-flex h-12 items-center justify-center gap-2 self-start rounded-xl bg-orange-500 px-5 text-sm font-semibold text-white shadow-lg shadow-orange-500/10 sm:self-auto"
          >
            <Plus size={17} />
            Publish a template

            <ArrowUpRight
              size={16}
              className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </Link>
        </section>

        {/* Stats */}
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Workspace activity
              </h3>

              <p className="mt-1 text-xs text-white/35">
                {walletName ? `Connected with ${walletName}` : "Your wallet"}
              </p>
            </div>

            <span className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[10px] text-white/40">
              Live data
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => {
              const Icon = iconMap[stat.icon];
              const colors = colorMap[stat.color];

              return (
                <div
                  key={stat.label}
                  className={`xogrid-stat-card group rounded-2xl border border-white/[0.07] bg-[#0B0D15]/80 p-5 ${colors.glow}`}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors.icon}`}
                    >
                      <Icon size={19} strokeWidth={1.8} />
                    </div>

                    <ArrowUpRight
                      size={16}
                      className="text-white/20 transition-colors group-hover:text-white/60"
                    />
                  </div>

                  <p className="mt-5 text-3xl font-semibold tracking-tight text-white">
                    {stat.value}
                  </p>

                  <p className="mt-1 text-xs font-medium text-white/60">
                    {stat.label}
                  </p>

                  <p className="mt-3 text-[10px] text-white/30">
                    {stat.change}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Main dashboard columns */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.85fr]">
          {/* Templates */}
          <section className="xogrid-panel min-w-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0B0D15]/80">
            <div className="flex flex-col gap-3 border-b border-white/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Your templates
                </h3>

                <p className="mt-1 text-xs text-white/35">
                  Templates published from your connected wallet
                </p>
              </div>

              <Link
                to="/explore"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-400 transition hover:text-orange-300"
              >
                Explore registry
                <ArrowUpRight size={14} />
              </Link>
            </div>

            {/* Search */}
            <div className="border-b border-white/[0.06] p-4">
              <div className="relative">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
                />

                <input
                  type="search"
                  placeholder="Search your templates..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.025] pl-9 pr-3 text-xs text-white outline-none placeholder:text-white/30 focus:border-violet-400/40"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[570px] text-left">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/30">
                    <th className="px-6 py-4 font-semibold">Template</th>
                    <th className="px-4 py-4 font-semibold">Reviews</th>
                    <th className="px-4 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 text-right font-semibold">
                      Published
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredTemplates.map((template) => (
                    <tr
                      key={template.identifier}
                      className="xogrid-template-row border-b border-white/[0.045] last:border-0"
                    >
                      <td className="px-6 py-4">
                        <Link to={`/t/${template.identifier}`} className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-400/10 bg-violet-500/[0.08] text-violet-300">
                            <Blocks size={16} />
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">
                              {template.name}
                            </p>

                            <p className="mt-1 text-[10px] text-white/30">
                              {template.identifier.slice(0, 12)}…
                            </p>
                          </div>
                        </Link>
                      </td>

                      <td className="px-4 py-4 text-xs text-white/45">
                        <span className="inline-flex items-center gap-1">
                          <Star size={12} className="text-amber-400" />
                          {template.averageRating !== null ? template.averageRating.toFixed(1) : "–"}
                          <span className="text-white/30">({template.userReviewCount})</span>
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-medium ${
                            template.badge === "reviewed"
                              ? "border-violet-400/15 bg-violet-500/[0.08] text-violet-300"
                              : template.badge === "auto-checked"
                                ? "border-emerald-400/15 bg-emerald-500/[0.07] text-emerald-300"
                                : "border-white/10 bg-white/[0.04] text-white/45"
                          }`}
                        >
                          {BADGE_LABEL[template.badge]}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-right text-xs text-white/40">
                        {formatDate(template.createdAt)}
                      </td>
                    </tr>
                  ))}

                  {filteredTemplates.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-xs text-white/40">
                        {loadError ? (
                          loadError
                        ) : loading ? (
                          "Loading your templates…"
                        ) : mine.length === 0 ? (
                          <>
                            You have not published a template from this wallet yet.{" "}
                            <Link to="/publish" className="font-semibold text-orange-400 hover:text-orange-300">
                              Publish your first one
                            </Link>
                          </>
                        ) : (
                          "No matching templates."
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-4">
              <span className="text-[10px] text-white/30">
                Showing {filteredTemplates.length} of {mine.length} yours
              </span>

              <Link
                to="/explore"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-white/50 transition hover:text-orange-400"
              >
                View registry
                <ArrowRight size={14} />
              </Link>
            </div>
          </section>

          {/* Recent activity */}
          <section className="xogrid-panel rounded-2xl border border-white/[0.07] bg-[#0B0D15]/80">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-5 sm:px-6">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Newest in the registry
                </h3>

                <p className="mt-1 text-xs text-white/35">
                  The latest templates anyone has published
                </p>
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-white/45">
                <Activity size={17} />
              </div>
            </div>

            <div className="p-5 sm:px-6">
              <div className="space-y-6">
                {newest.map((template, index) => (
                  <Link
                    key={template.identifier}
                    to={`/t/${template.identifier}`}
                    className="xogrid-activity-item relative flex gap-3"
                  >
                    {index !== newest.length - 1 && (
                      <div className="absolute bottom-[-22px] left-[17px] top-10 w-px bg-white/[0.07]" />
                    )}

                    <div className="relative z-10 flex h-[35px] w-[35px] shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
                      <Upload size={15} />
                    </div>

                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-white">{template.name}</p>

                        <span className="text-[9px] text-white/30">{formatDate(template.createdAt)}</span>
                      </div>

                      <p className="mt-1 truncate text-[11px] text-white/45">
                        by {template.publisher === address ? "you" : template.publisherName ?? shortenAddress(template.publisher)}
                      </p>

                      <span className="mt-2 inline-flex rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1 text-[9px] text-white/40">
                        {BADGE_LABEL[template.badge]}
                      </span>
                    </div>
                  </Link>
                ))}

                {newest.length === 0 && (
                  <p className="text-xs text-white/40">
                    {loadError || (loading ? "Loading…" : "No templates have been published yet.")}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-white/[0.06] px-6 py-4">
              <span className="text-[10px] text-white/30">
                Read from the live registry.
              </span>
            </div>
          </section>
        </div>

        {/* Bottom information */}
        <section className="xogrid-section-enter mt-8 flex flex-col justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.018] px-5 py-4 transition duration-300 hover:border-violet-400/20 sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-start gap-3">
            <ShieldCheck
              size={18}
              className="mt-0.5 shrink-0 text-violet-300"
            />

            <div>
              <p className="text-xs font-semibold text-white/75">
                Understand template trust statuses
              </p>

              <p className="mt-1 text-[11px] leading-5 text-white/35">
                Automated checks and community reviews provide information,
                not a guarantee that a template is safe.
              </p>
            </div>
          </div>

          <Link
            to="/policy"
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-violet-300 transition hover:text-violet-200"
          >
            Read trust policy
            <ExternalLink size={13} />
          </Link>
        </section>

        {/* Footer */}
        <footer className="pb-4 pt-8 text-center text-[10px] tracking-wide text-white/25">
          XOGrid · Explore. Publish. Build trust.
        </footer>
      </div>

    </div>
  );
}

export default Dashboard;
