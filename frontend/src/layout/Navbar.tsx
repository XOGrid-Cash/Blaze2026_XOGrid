
import { useEffect, useState, type MouseEvent } from "react";
import {
  Menu,
  X,
  ArrowUpRight,
  Wallet,
  LayoutDashboard,
} from "lucide-react";

import {
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";

import xogridlogo from "../assets/images/xogridlogo.png";
import { shortenAddress, useWallet } from "../hub/WalletContext";

interface NavLink {
  name: string;
  href: string;
  section?: string;
}

interface NavigationState {
  scrollToSection?: string;
}

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("home");

  const { connected, walletName, address, openModal } = useWallet();

  const location = useLocation();
  const navigate = useNavigate();

  const navLinks: NavLink[] = [
    {
      name: "How It Works",
      href: "/#how-it-works",
      section: "how-it-works",
    },
    {
      name: "Featured Templates",
      href: "/#featured-templates",
      section: "featured-templates",
    },
    {
      name: "Demo",
      href: "/demo",
    },
    {
      name: "Build Template",
      href: "/publish",
    },
    {
      name: "Policy",
      href: "/policy",
    },
  ];

  // Navbar scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 30);
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Close mobile menu when route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Automatically detect homepage section
  useEffect(() => {
    if (location.pathname !== "/") return;

    const sectionIds = [
      "home",
      "how-it-works",
      "featured-templates",
    ];

    const updateActiveSection = () => {
      const marker = window.scrollY + window.innerHeight * 0.35;

      let currentSection = "home";

      sectionIds.forEach((id) => {
        const section = document.getElementById(id);

        if (!section) return;

        const sectionTop =
          section.getBoundingClientRect().top + window.scrollY;

        if (marker >= sectionTop) {
          currentSection = id;
        }
      });

      setActiveSection(currentSection);
    };

    updateActiveSection();

    window.addEventListener("scroll", updateActiveSection, {
      passive: true,
    });

    window.addEventListener("resize", updateActiveSection);

    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [location.pathname]);

  // Track active routes outside homepage
  useEffect(() => {
    if (location.pathname === "/") return;

    setActiveSection(location.pathname);
  }, [location.pathname]);

  // Escape key closes mobile navigation
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Navigate home
  const handleHomeClick = () => {
    setMenuOpen(false);

    if (location.pathname === "/") {
      document.getElementById("home")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      setActiveSection("home");
    } else {
      navigate("/", {
        state: {
          scrollToSection: "home",
        } satisfies NavigationState,
      });
    }
  };

  // Navigate to homepage sections
  const handleSectionClick = (
    event: MouseEvent<HTMLAnchorElement>,
    link: NavLink,
  ) => {
    if (!link.section) {
      setMenuOpen(false);
      return;
    }

    event.preventDefault();
    setMenuOpen(false);

    if (location.pathname === "/") {
      document.getElementById(link.section)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      setActiveSection(link.section);
    } else {
      navigate("/", {
        state: {
          scrollToSection: link.section,
        } satisfies NavigationState,
      });
    }
  };

  // Scroll after returning to homepage
  useEffect(() => {
    const navigationState =
      location.state as NavigationState | null;

    const target = navigationState?.scrollToSection;

    if (location.pathname !== "/" || !target) return;

    const frame = requestAnimationFrame(() => {
      document.getElementById(target)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      setActiveSection(target);

      navigate("/", {
        replace: true,
        state: null,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.state, navigate]);

  // Check active navigation link
  const isLinkActive = (link: NavLink): boolean => {
    if (link.section) {
      return (
        location.pathname === "/" &&
        activeSection === link.section
      );
    }

    return location.pathname === link.href;
  };

  // Open shared wallet modal
  const openWalletModal = () => {
    setMenuOpen(false);

    openModal(
      location.pathname === "/"
        ? { redirectTo: "/dashboard" }
        : undefined,
    );
  };

  // Wallet display
  const walletLabel = address
    ? shortenAddress(address)
    : walletName.length > 18
      ? `${walletName.slice(0, 17)}…`
      : walletName;

  const walletTitle = address
    ? `${walletName}: ${address}`
    : walletName;

  // Shared navigation link styling
  const desktopLinkClass = (active: boolean) =>
    `group relative whitespace-nowrap rounded-xl px-3 xl:px-4 2xl:px-5 3xl:px-6 py-3 text-[12px] xl:text-[13px] 2xl:text-sm font-medium tracking-wide transition-all duration-300 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${
      active
        ? "text-orange-400"
        : "text-white/75 hover:text-white"
    }`;

  const mobileLinkClass = (active: boolean) =>
    `group flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-sm font-medium transition-all duration-300 ${
      active
        ? "border-orange-400/20 bg-orange-500/10 text-orange-400"
        : "border-transparent text-white/70 hover:border-orange-400/20 hover:bg-orange-500/10 hover:text-white"
    }`;

  return (
    <>
      <header
        style={{ top: "var(--banner-offset, 0px)" }}
        className="fixed inset-x-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4 lg:px-8 xl:px-10 2xl:px-14 3xl:px-20 4xl:px-24"
      >
        <nav
          className={`mx-auto flex h-[68px] w-full max-w-[1440px] items-center justify-between rounded-2xl px-3 transition-all duration-500 sm:h-[76px] sm:px-5 lg:px-6 xl:max-w-[1536px] xl:px-7 2xl:max-w-[1760px] 2xl:px-9 3xl:max-w-[1920px] 3xl:px-12 4xl:max-w-[2200px] 4xl:px-16 ${
            scrolled
              ? "border border-white/[0.09] bg-[#090A13]/75 shadow-[0_12px_50px_rgba(0,0,0,0.3)] backdrop-blur-2xl"
              : "border border-transparent bg-transparent shadow-none backdrop-blur-none"
          }`}
        >
          {/* Logo */}
          <button
            type="button"
            onClick={handleHomeClick}
            aria-label="XOGrid - Back to home"
            className="group flex shrink-0 items-center rounded-lg outline-none transition-transform duration-300 hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            <img
              src={xogridlogo}
              alt="XOGrid"
              className="h-10 w-auto object-contain transition-all duration-300 sm:h-12 xl:h-13 2xl:h-14 3xl:h-15 4xl:h-16"
            />
          </button>

          {/* Desktop Navigation */}
          <div className="hidden items-center gap-0.5 lg:flex xl:gap-1 2xl:gap-2 3xl:gap-3">
            {/* Home */}
            <button
              type="button"
              onClick={handleHomeClick}
              aria-current={
                location.pathname === "/" &&
                activeSection === "home"
                  ? "page"
                  : undefined
              }
              className={desktopLinkClass(
                location.pathname === "/" &&
                  activeSection === "home",
              )}
            >
              Home

              <span
                className={`absolute bottom-1.5 left-3 right-3 h-[2px] origin-center rounded-full bg-orange-500 transition-transform duration-300 xl:left-4 xl:right-4 ${
                  location.pathname === "/" &&
                  activeSection === "home"
                    ? "scale-x-100"
                    : "scale-x-0 group-hover:scale-x-100"
                }`}
              />
            </button>

            {/* Navigation Links */}
            {navLinks.map((link) => {
              const active = isLinkActive(link);

              return (
                <Link
                  key={link.name}
                  to={link.href}
                  onClick={(event) =>
                    handleSectionClick(event, link)
                  }
                  aria-current={active ? "page" : undefined}
                  className={desktopLinkClass(active)}
                >
                  {link.name}

                  <span
                    className={`absolute bottom-1.5 left-3 right-3 h-[2px] origin-center rounded-full bg-orange-500 transition-transform duration-300 xl:left-4 xl:right-4 ${
                      active
                        ? "scale-x-100"
                        : "scale-x-0 group-hover:scale-x-100"
                    }`}
                  />
                </Link>
              );
            })}
          </div>

          {/* Desktop CTA */}
          <div className="hidden shrink-0 items-center gap-2 lg:flex 2xl:gap-3">
            <Link
              to="/dashboard"
              className="group flex items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-xs font-semibold text-white/80 transition-all duration-300 hover:border-orange-400/40 hover:bg-orange-500/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 xl:px-4 xl:text-sm 2xl:px-5"
            >
              <LayoutDashboard
                size={16}
                className="shrink-0 text-orange-400"
              />
              <span>Go to Dashboard</span>
            </Link>

            <button
              type="button"
              onClick={openWalletModal}
              title={
                connected ? walletTitle : "Connect a wallet"
              }
              className="group relative flex items-center gap-2 overflow-hidden rounded-xl bg-orange-500 px-3 py-3 text-xs font-semibold text-white shadow-lg shadow-orange-500/15 transition-all duration-300 hover:-translate-y-0.5 hover:bg-orange-400 hover:shadow-orange-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 xl:gap-3 xl:px-4 xl:text-sm 2xl:px-5 3xl:px-6"
            >
              {connected ? (
                <>
                  <span
                    aria-hidden="true"
                    className="relative z-10 h-2 w-2 shrink-0 rounded-full bg-emerald-300"
                  />

                  <span className="relative z-10 max-w-[115px] truncate font-mono tracking-tight xl:max-w-[145px] 2xl:max-w-[180px] 3xl:max-w-[220px]">
                    {walletLabel}
                  </span>
                </>
              ) : (
                <>
                  <Wallet
                    size={17}
                    className="relative z-10 shrink-0"
                  />

                  <span className="relative z-10 whitespace-nowrap">
                    Connect Wallet
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Mobile Header Actions */}
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            {/* Dashboard Link - Always Visible */}
            <Link
              to="/dashboard"
              aria-label="Go to Dashboard"
              title="Go to Dashboard"
              className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 sm:h-11 sm:gap-2 sm:px-3 sm:text-sm ${
                location.pathname === "/dashboard"
                  ? "border-orange-400/30 bg-orange-500/10 text-orange-400"
                  : "border-white/10 bg-white/[0.04] text-white/85 hover:border-orange-400/40 hover:bg-orange-500/10 hover:text-white"
              }`}
            >
              <LayoutDashboard
                size={16}
                className="shrink-0 text-orange-400"
              />
              <span className="whitespace-nowrap">
                Dashboard
              </span>
            </Link>

            {/* Mobile Menu Toggle */}
            <button
              type="button"
              onClick={() =>
                setMenuOpen((previous) => !previous)
              }
              aria-label={
                menuOpen
                  ? "Close navigation menu"
                  : "Open navigation menu"
              }
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition-all duration-300 hover:border-orange-400/50 hover:bg-orange-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 sm:h-11 sm:w-11"
            >
              {menuOpen ? (
                <X size={21} />
              ) : (
                <Menu size={21} />
              )}
            </button>
          </div>
        </nav>

        {/* Mobile Navigation */}
        <div
          id="mobile-navigation"
          aria-hidden={!menuOpen}
          inert={!menuOpen}
          className={`mx-auto mt-3 w-full max-w-[1440px] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0B0C16]/90 shadow-2xl shadow-black/40 backdrop-blur-2xl transition-all duration-300 xl:max-w-[1536px] 2xl:max-w-[1760px] 3xl:max-w-[1920px] 4xl:max-w-[2200px] lg:hidden ${
            menuOpen
              ? "max-h-[80vh] translate-y-0 overflow-y-auto p-4 opacity-100"
              : "pointer-events-none max-h-0 -translate-y-2 border-transparent p-0 opacity-0"
          }`}
        >
          <div className="flex flex-col gap-2">
            {/* Mobile Home */}
            <button
              type="button"
              onClick={handleHomeClick}
              tabIndex={menuOpen ? 0 : -1}
              className={mobileLinkClass(
                location.pathname === "/" &&
                  activeSection === "home",
              )}
            >
              Home

              <ArrowUpRight
                size={15}
                className="text-white/30 transition-all duration-300 group-hover:text-orange-400"
              />
            </button>

            {/* Mobile Navigation Links */}
            {navLinks.map((link) => {
              const active = isLinkActive(link);

              return (
                <Link
                  key={link.name}
                  to={link.href}
                  onClick={(event) =>
                    handleSectionClick(event, link)
                  }
                  tabIndex={menuOpen ? 0 : -1}
                  aria-current={active ? "page" : undefined}
                  className={mobileLinkClass(active)}
                >
                  {link.name}

                  <ArrowUpRight
                    size={15}
                    className="text-white/30 transition-all duration-300 group-hover:text-orange-400"
                  />
                </Link>
              );
            })}

            <div className="my-2 border-t border-white/[0.08]" />

            {/* Mobile CTA */}
            <button
              type="button"
              onClick={openWalletModal}
              title={
                connected ? walletTitle : "Connect a wallet"
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/15 transition-all duration-300 hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
            >
              {connected ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full bg-emerald-300"
                  />

                  <span className="max-w-[220px] truncate font-mono tracking-tight">
                    {walletLabel}
                  </span>
                </>
              ) : (
                <>
                  <Wallet size={17} />
                  Connect Wallet
                </>
              )}
            </button>
          </div>
        </div>
      </header>
    </>
  );
}

export default Navbar;
