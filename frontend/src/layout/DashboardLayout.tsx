
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  Compass,
  Upload,
  ShieldCheck,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Wallet,
  Copy,
  Check,
  Blocks,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import xogridlogo from "../assets/images/xogridlogo-trimmed.png";
import xogridmark from "../assets/images/xogridlogo-mark.png";
import { useHasAdminToken } from "../hub/admin";
import { shortenAddress, useWallet } from "../hub/WalletContext";

interface NavigationItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

const navigation: NavigationItem[] = [
  {
    label: "Overview",
    to: "/dashboard",
    icon: LayoutDashboard,
    end: true,
  },
  {
    label: "Explore templates",
    to: "/explore",
    icon: Compass,
  },
  {
    label: "Publish template",
    to: "/publish",
    icon: Upload,
  },
  {
    label: "Trust & Policy",
    to: "/policy",
    icon: ShieldCheck,
  },
];

// Desktop sidebar collapse is remembered per browser. Storage can be unavailable (private mode, blocked site data).
const COLLAPSED_KEY = "xogrid.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Only affects lg and up: the mobile drawer always shows the full menu.
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Not saved; the sidebar still works for this visit.
    }
  }, [collapsed]);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { connected, walletName, address, openModal, disconnect } = useWallet();

  const walletMenuRef = useRef<HTMLDivElement>(null);
  const isAdmin = useHasAdminToken();

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all 2xl:text-base 3xl:py-3.5 ${
      collapsed ? "lg:justify-center lg:px-0" : ""
    } ${
      isActive
        ? "border border-orange-500/20 bg-orange-500/10 text-orange-400"
        : "border border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white"
    }`;

  // In the collapsed rail the label is visually hidden but stays readable by screen readers.
  const navLabelClass = collapsed ? "lg:sr-only" : "";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        walletMenuRef.current &&
        !walletMenuRef.current.contains(event.target as Node)
      ) {
        setWalletMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleCopyAddress = async () => {
    if (!address) return;

    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleDisconnect = () => {
    setWalletMenuOpen(false);
    disconnect();
  };

  return (
    <div className="min-h-screen bg-[#05070B] text-white">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        id="dashboard-sidebar"
        style={{ top: "var(--banner-offset, 0px)" }}
        className={`fixed inset-y-0 left-0 z-50 flex w-[270px] flex-col border-r border-white/[0.07] bg-[#080B10] transition-[transform,width] duration-300 motion-reduce:transition-none ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 ${
          collapsed
            ? "lg:w-[84px] 2xl:w-[92px] 3xl:w-[100px]"
            : "2xl:w-[290px] 3xl:w-[320px] 4xl:w-[350px]"
        }`}
      >
        {/* Logo */}
        <div
          className={`relative flex h-[88px] shrink-0 items-center justify-between border-b border-white/[0.07] px-6 2xl:h-[96px] 2xl:px-7 3xl:h-[112px] 3xl:px-8 4xl:h-[124px] ${
            collapsed ? "lg:justify-center lg:px-0 2xl:px-0 3xl:px-0" : ""
          }`}
        >
          <Link
            to="/"
            onClick={() => setSidebarOpen(false)}
            aria-label="XOGrid home"
            className="flex items-center"
          >
            {/* Full logo (padding trimmed so it fills its height); just the XO grid mark in the collapsed rail.
                Visibility sits on wrapper spans: the global img { display: block } rule in index.css is unlayered, so
                it beats Tailwind's hidden / lg:hidden on the img itself. */}
            <span className={collapsed ? "lg:hidden" : ""}>
              <img
                src={xogridlogo}
                alt=""
                className="h-12 w-auto object-contain 2xl:h-14 3xl:h-16 4xl:h-[72px]"
              />
            </span>
            <span className={`hidden ${collapsed ? "lg:block" : ""}`}>
              <img
                src={xogridmark}
                alt=""
                className="h-10 w-auto object-contain 2xl:h-11 3xl:h-12"
              />
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>

          {/* Desktop collapse toggle, sitting on the sidebar's right edge */}
          <button
            type="button"
            onClick={() => setCollapsed((previous) => !previous)}
            aria-controls="dashboard-sidebar"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute -right-3.5 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-[#0B0E14] text-slate-400 shadow-lg shadow-black/40 transition hover:border-orange-500/40 hover:text-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 lg:flex 3xl:h-8 3xl:w-8 3xl:-right-4"
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        {/* Navigation */}
        <div
          className={`flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 2xl:px-5 2xl:py-8 3xl:px-6 3xl:py-10 ${
            collapsed ? "lg:px-3 2xl:px-3 3xl:px-4" : ""
          }`}
        >
          <p
            className={`mb-3 px-4 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 2xl:text-[11px] 3xl:text-xs ${
              collapsed ? "lg:hidden" : ""
            }`}
          >
            Workspace
          </p>

          <nav className="space-y-1" aria-label="Workspace">
            {navigation.map((item) => {
              const Icon = item.icon;

              return (
                <div key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={() => setSidebarOpen(false)}
                    title={collapsed ? item.label : undefined}
                    className={navLinkClass}
                  >
                    <Icon size={18} className="shrink-0 2xl:h-5 2xl:w-5" />
                    <span className={navLabelClass}>{item.label}</span>
                  </NavLink>
                </div>
              );
            })}

            {isAdmin && (
              <NavLink
                to="/admin"
                onClick={() => setSidebarOpen(false)}
                title={collapsed ? "Admin Dashboard" : undefined}
                className={navLinkClass}
              >
                <Activity size={18} className="shrink-0 2xl:h-5 2xl:w-5" />
                <span className={navLabelClass}>Admin Dashboard</span>
              </NavLink>
            )}
          </nav>
        </div>

        {/* Bottom sidebar section */}
        <div
          className={`border-t border-white/[0.07] p-4 2xl:p-5 3xl:p-6 ${
            collapsed ? "lg:hidden" : ""
          }`}
        >
          <div className="rounded-xl border border-orange-500/15 bg-orange-500/[0.06] p-4 2xl:p-5 3xl:p-6">
            <div className="mb-2 flex items-center gap-2 text-orange-400">
              <ShieldCheck size={17} />
              <span className="text-xs font-semibold 2xl:text-sm">
                XOGrid Network
              </span>
            </div>
            <p className="text-xs leading-5 text-slate-400 2xl:text-sm 2xl:leading-6">
              Discover, publish and explore trusted templates.
            </p>
          </div>
        </div>
      </aside>

      {/* Main page area */}
      <div
        className={`min-h-screen transition-[padding] duration-300 motion-reduce:transition-none ${
          collapsed
            ? "lg:pl-[84px] 2xl:pl-[92px] 3xl:pl-[100px]"
            : "lg:pl-[270px] 2xl:pl-[290px] 3xl:pl-[320px] 4xl:pl-[350px]"
        }`}
      >
        {/* Shared header */}
        <header className="sticky top-0 z-30 flex h-[76px] items-center gap-3 border-b border-white/[0.07] bg-[#05070B]/95 px-4 backdrop-blur-xl sm:gap-4 sm:px-8 2xl:h-[88px] 2xl:px-10 3xl:h-[96px] 3xl:px-12">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 rounded-xl border border-white/10 p-2.5 text-slate-300 hover:bg-white/5 lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white 2xl:text-base 3xl:text-lg">
              XOGrid Workspace
            </p>
            <p className="hidden text-xs text-slate-500 sm:block 2xl:text-sm">
              Your templates and workspace
            </p>
          </div>

          {/* Wallet */}
          <div className="relative shrink-0" ref={walletMenuRef}>
            {!connected ? (
              <button
                type="button"
                onClick={() => openModal()}
                className="flex items-center gap-2 rounded-xl border border-orange-500/25 bg-orange-500/[0.07] px-3 py-2.5 text-xs font-semibold text-white transition hover:border-orange-500/50 hover:bg-orange-500/[0.12] sm:gap-3 sm:px-4 2xl:px-5 2xl:py-3 2xl:text-sm"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-400 2xl:h-8 2xl:w-8">
                  <Wallet size={15} />
                </span>
                Connect wallet
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setWalletMenuOpen((previous) => !previous)}
                aria-expanded={walletMenuOpen}
                aria-haspopup="true"
                className="flex max-w-[190px] items-center gap-2 rounded-xl border border-orange-500/25 bg-orange-500/[0.07] px-3 py-2.5 text-xs font-semibold text-white transition hover:border-orange-500/50 hover:bg-orange-500/[0.12] sm:max-w-none sm:gap-3 sm:px-4 2xl:px-5 2xl:py-3 2xl:text-sm"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-400 2xl:h-8 2xl:w-8">
                  <Wallet size={15} />
                </span>

                <span className="min-w-0 truncate font-mono">
                  {address ? shortenAddress(address) : walletName}
                </span>

                <ChevronDown
                  size={15}
                  className={`shrink-0 text-slate-400 transition-transform duration-200 ${
                    walletMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            )}

            {connected && walletMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+12px)] z-50 w-[260px] overflow-hidden rounded-2xl border border-white/10 bg-[#0B0E14] p-2 shadow-2xl shadow-black/50 2xl:w-[300px] 2xl:p-3">
                <div className="border-b border-white/[0.07] px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <p className="text-xs font-semibold text-white 2xl:text-sm">
                      Connected to {walletName}
                    </p>
                  </div>

                  <p className="mt-2 break-all text-[11px] leading-5 text-slate-500 2xl:text-xs">
                    {address || "Waiting for the wallet to share its address..."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCopyAddress}
                  disabled={!address}
                  className="flex w-full disabled:cursor-not-allowed disabled:opacity-50 items-center gap-3 rounded-xl px-3 py-3 text-left text-xs text-slate-300 transition hover:bg-white/[0.05] hover:text-white 2xl:text-sm"
                >
                  {copied ? (
                    <Check size={16} className="text-emerald-400" />
                  ) : (
                    <Copy size={16} />
                  )}
                  {copied ? "Address copied" : "Copy wallet address"}
                </button>

                <div className="my-1 border-t border-white/[0.07]" />

                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs text-red-400 transition hover:bg-red-500/10 2xl:text-sm"
                >
                  <LogOut size={16} />
                  Disconnect wallet
                </button>
              </div>
            )}
          </div>

          <Link
            to="/"
            className="hidden shrink-0 items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-slate-300 transition hover:border-orange-500/30 hover:text-orange-400 sm:flex 2xl:px-5 2xl:py-3 2xl:text-sm"
          >
            <LogOut size={15} />
            Back to homepage
          </Link>
        </header>

        {/* Current route renders here */}
        <main className="min-h-[calc(100vh-76px)] 2xl:min-h-[calc(100vh-88px)] 3xl:min-h-[calc(100vh-96px)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
