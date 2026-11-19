
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import xogridlogo from "../assets/images/xogridlogo.png";
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
    label: "Build template",
    to: "/publish",
    icon: Upload,
  },
  {
    label: "Trust & Policy",
    to: "/policy",
    icon: ShieldCheck,
  },
];

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { connected, walletName, address, openModal, disconnect } = useWallet();

  const walletMenuRef = useRef<HTMLDivElement>(null);
  const isAdmin = useHasAdminToken();

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
      isActive
        ? "border border-orange-500/20 bg-orange-500/10 text-orange-400"
        : "border border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white"
    }`;

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
        style={{ top: "var(--banner-offset, 0px)" }}
        className={`fixed inset-y-0 left-0 z-50 flex w-[270px] flex-col border-r border-white/[0.07] bg-[#080B10] transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 2xl:w-[290px] 3xl:w-[310px]`}
      >
        {/* Logo */}
        <div className="flex h-[88px] items-center justify-between border-b border-white/[0.07] px-6 2xl:h-[96px] 2xl:px-7 3xl:h-[104px] 3xl:px-8">
          <Link
            to="/"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center"
          >
            <img
              src={xogridlogo}
              alt="XOGrid"
              className="h-9 w-auto object-contain 2xl:h-10 3xl:h-11"
            />
          </Link>

          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto px-4 py-6 2xl:px-5 2xl:py-8 3xl:px-6 3xl:py-10">
          <p className="mb-3 px-4 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 2xl:text-[11px] 3xl:text-xs">
            Workspace
          </p>

          <nav className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;

              return (
                <div key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={() => setSidebarOpen(false)}
                    className={navLinkClass}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </NavLink>           
                </div>
              );
            })}

            {isAdmin && (
              <NavLink
                to="/admin"
                onClick={() => setSidebarOpen(false)}
                className={navLinkClass}
              >
                <Activity size={18} />
                <span>Admin Dashboard</span>
              </NavLink>
            )}
          </nav>
        </div>

        {/* Bottom sidebar section */}
        <div className="border-t border-white/[0.07] p-4 2xl:p-5 3xl:p-6">
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
      <div className="min-h-screen lg:pl-[270px] 2xl:pl-[290px] 3xl:pl-[310px]">
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
