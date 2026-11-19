
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ShieldCheck,
  ArrowUp,
  ArrowUpRight,
} from "lucide-react";
import { SiGithub } from "react-icons/si";

import xogridlogo from "../assets/images/xogridlogo.png";

interface FooterLink {
  name: string;
  href: string;
}

function Footer() {
  const currentYear = new Date().getFullYear();
  const location = useLocation();

  const GITHUB_URL = "https://github.com/YOUR_GITHUB";

  const footerLinks: Record<string, FooterLink[]> = {
    Platform: [
      { name: "Home", href: "/" },
      { name: "How It Works", href: "/#how-it-works" },
      { name: "Build Template", href: "/publish" },
    ],
    Resources: [
      { name: "Policy", href: "/policy" },
      { name: "Demo", href: "/demo" },
      { name: "Documentation", href: "/docs" },
    ],
  };

  useEffect(() => {
    if (!location.hash) return;

    const sectionId = decodeURIComponent(location.hash.slice(1));

    const timeout = window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);

    return () => window.clearTimeout(timeout);
  }, [location.pathname, location.hash]);

  const isActiveLink = (href: string): boolean => {
    const [pathname, hash] = href.split("#");

    if (hash) {
      return location.pathname === pathname && location.hash === `#${hash}`;
    }

    if (href === "/") {
      return location.pathname === "/" && !location.hash;
    }

    return location.pathname === href;
  };

  const footerLinkClass = (href: string): string =>
    `xogrid-footer-link group inline-flex items-center gap-2 text-sm ${
      isActiveLink(href) ? "is-active" : ""
    }`;

  const renderLinks = (links: FooterLink[]): ReactNode =>
    links.map((link) => {
      const active = isActiveLink(link.href);

      return (
        <li key={link.name}>
          <Link
            to={link.href}
            aria-current={active ? "page" : undefined}
            className={footerLinkClass(link.href)}
          >
            <span>{link.name}</span>
            <ArrowUpRight size={13} className="footer-link-arrow" />
          </Link>
        </li>
      );
    });

  return (
    <footer className="relative overflow-hidden border-t border-white/[0.08] bg-[#05070b]">
      <style>{`
        .xogrid-footer-link {
          color: rgba(255,255,255,.45) !important;
          text-decoration: none !important;
          transition: color 250ms ease !important;
        }

        .xogrid-footer-link:hover,
        .xogrid-footer-link:focus-visible,
        .xogrid-footer-link.is-active {
          color: #F97316 !important;
          text-decoration: none !important;
        }

        .xogrid-footer-link.is-active {
          font-weight: 600;
        }

        .footer-link-arrow {
          opacity: 0;
          transform: translate(-4px,0);
          transition: all 250ms ease;
          flex-shrink: 0;
        }

        .xogrid-footer-link:hover .footer-link-arrow,
        .xogrid-footer-link:focus-visible .footer-link-arrow,
        .xogrid-footer-link.is-active .footer-link-arrow {
          opacity: 1;
          transform: translate(0,0);
        }

        .xogrid-footer-policy {
          color: rgba(255,255,255,.4) !important;
          text-decoration: none !important;
          transition: color 250ms ease !important;
        }

        .xogrid-footer-policy:hover,
        .xogrid-footer-policy:focus-visible,
        .xogrid-footer-policy.is-active {
          color: #F97316 !important;
          text-decoration: none !important;
        }

        .xogrid-footer-social {
          display: flex;
          width: 36px;
          height: 36px;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255,255,255,.1);
          border-radius: 10px;
          background: rgba(255,255,255,.03);
          color: rgba(255,255,255,.55);
          transition: all 250ms ease;
        }

        .xogrid-footer-social:hover {
          color: #F97316;
          border-color: rgba(249,115,22,.4);
          background: rgba(249,115,22,.08);
          transform: translateY(-3px);
        }

        @keyframes waveFlow {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }

        @keyframes waveFlowReverse {
          from { transform: translateX(-50%); }
          to { transform: translateX(0); }
        }

        @keyframes waveHighlight {
          0%,100% {
            transform: translateX(0) translateY(0);
            opacity: .5;
          }
          50% {
            transform: translateX(-2%) translateY(-7px);
            opacity: 1;
          }
        }

        .animate-wave {
          animation: waveFlow 20s linear infinite;
        }

        .animate-wave-reverse {
          animation: waveFlowReverse 27s linear infinite;
        }

        .animate-wave-highlight {
          animation: waveHighlight 9s ease-in-out infinite;
        }

        @media (max-width: 640px) {
          .animate-wave { animation-duration: 25s; }
          .animate-wave-reverse { animation-duration: 32s; }
        }

        @media (prefers-reduced-motion: reduce) {
          .animate-wave,
          .animate-wave-reverse,
          .animate-wave-highlight {
            animation: none;
          }
        }
      `}</style>

      {/* Ambient lighting */}
      <div className="pointer-events-none absolute -top-32 left-1/4 h-72 w-72 rounded-full bg-purple-600/[0.07] blur-[120px]" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-64 w-64 rounded-full bg-orange-500/[0.05] blur-[110px]" />

      <div className="relative z-10 mx-auto max-w-7xl px-6 pb-8 pt-16 sm:px-8 lg:px-12 2xl:max-w-[1600px] 2xl:px-16 2xl:pb-10 2xl:pt-20 3xl:max-w-[1850px] 3xl:px-20 3xl:pb-12 3xl:pt-24 4xl:max-w-[2100px] 4xl:px-24">
        {/* Main footer */}
        <div className="grid grid-cols-1 gap-12 border-b border-white/[0.08] pb-14 md:grid-cols-2 lg:grid-cols-4 lg:gap-10 2xl:gap-14 2xl:pb-16 3xl:gap-16 3xl:pb-20">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link to="/" className="inline-flex items-center gap-3">
              <img
                src={xogridlogo}
                alt="XOGrid logo"
                className="h-10 w-auto object-contain 2xl:h-12 3xl:h-14"
              />
            </Link>

            <p className="mt-6 max-w-md text-sm leading-7 text-white/45 2xl:mt-8 2xl:max-w-2xl 2xl:text-base 2xl:leading-8 3xl:text-lg 3xl:leading-9">
              Discover, publish, and evaluate XO wallet templates.
              XOGrid gives developers a transparent registry for
              exploring template identities, automated checks, and
              community accountability.
            </p>

            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-2 2xl:mt-8 2xl:gap-3 2xl:px-4 2xl:py-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 2xl:h-2.5 2xl:w-2.5" />
              <span className="text-xs text-white/55 2xl:text-sm">
                Built for the Bitcoin Cash ecosystem
              </span>
            </div>
          </div>

          {/* Platform */}
          <div>
            <h3 className="text-sm font-semibold text-white 2xl:text-base 3xl:text-lg">
              Platform
            </h3>
            <ul className="mt-6 space-y-5 2xl:mt-8 2xl:space-y-6">
              {renderLinks(footerLinks.Platform)}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-sm font-semibold text-white 2xl:text-base 3xl:text-lg">
              Resources
            </h3>
            <ul className="mt-6 space-y-5 2xl:mt-8 2xl:space-y-6">
              {renderLinks(footerLinks.Resources)}
            </ul>
          </div>
        </div>

        {/* Bottom section */}
        <div className="flex flex-col gap-6 pt-8 sm:flex-row sm:items-center sm:justify-between 2xl:gap-10 2xl:pt-10 3xl:pt-12">
          <p className="text-xs text-white/35 2xl:text-sm">
            © {currentYear} XOGrid. All rights reserved.
          </p>

          <div className="flex flex-wrap items-center gap-4 2xl:gap-6">
            <a
              href="https://github.com/XOGrid-Cash/Blaze2026_XOGrid"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="XOGrid GitHub"
              title="GitHub"
              className="xogrid-footer-social 2xl:!h-11 2xl:!w-11"
            >
              <SiGithub size={17} />
            </a>

            <Link
              to="/policy"
              className={`xogrid-footer-policy text-xs 2xl:text-sm ${
                location.pathname === "/policy" ? "is-active" : ""
              }`}
            >
              Trust &amp; Policy
            </Link>

            <button
              type="button"
              onClick={() =>
                window.scrollTo({ top: 0, behavior: "smooth" })
              }
              aria-label="Back to top"
              className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/50 transition-all duration-300 hover:-translate-y-1 hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-500 2xl:h-11 2xl:w-11"
            >
              <ArrowUp
                size={16}
                className="transition-transform duration-300 group-hover:-translate-y-1 2xl:h-5 2xl:w-5"
              />
            </button>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-8 flex items-start gap-3 border-t border-white/[0.06] pt-6 2xl:mt-10 2xl:gap-4 2xl:pt-8 3xl:mt-12">
          <ShieldCheck
            size={16}
            className="mt-0.5 shrink-0 text-orange-500/70 2xl:h-5 2xl:w-5"
          />

          <p className="max-w-3xl text-[11px] leading-6 text-white/30 2xl:max-w-5xl 2xl:text-xs 2xl:leading-7">
            XOGrid is a template registry, not a wallet or security
            certification service. Automated checks and community
            reviews provide information to help users make their own
            decisions. They do not guarantee that a template is safe.
          </p>
        </div>
      </div>

      {/* Animated waves */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-40 overflow-hidden sm:h-48 lg:h-60 2xl:h-72 3xl:h-80">
        {/* Purple wave */}
        <svg
          className="absolute bottom-0 left-0 h-full w-[200%] animate-wave"
          viewBox="0 0 1440 240"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M0 105 C120 35 240 35 360 105 C480 175 600 175 720 105 C840 35 960 35 1080 105 C1200 175 1320 175 1440 105 V240 H0 Z"
            fill="#8B5CF6"
            fillOpacity="0.10"
          />
          <path
            d="M0 135 C150 65 270 65 420 135 C570 205 690 205 840 135 C990 65 1110 65 1260 135 C1350 175 1400 175 1440 155 V240 H0 Z"
            fill="#A78BFA"
            fillOpacity="0.07"
          />
        </svg>

        {/* Orange wave */}
        <svg
          className="absolute bottom-0 left-0 h-full w-[200%] animate-wave-reverse"
          viewBox="0 0 1440 240"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M0 150 C120 210 240 210 360 150 C480 90 600 90 720 150 C840 210 960 210 1080 150 C1200 90 1320 90 1440 150 V240 H0 Z"
            fill="#F97316"
            fillOpacity="0.055"
          />
          <path
            d="M0 175 C150 115 270 115 420 175 C570 235 690 235 840 175 C990 115 1110 115 1260 175 C1350 210 1400 210 1440 190 V240 H0 Z"
            fill="#8B5CF6"
            fillOpacity="0.065"
          />
        </svg>

        {/* Highlight wave */}
        <svg
          className="absolute bottom-0 left-0 h-full w-[200%] animate-wave-highlight"
          viewBox="0 0 1440 240"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M0 125 C180 55 300 55 480 125 C660 195 780 195 960 125 C1140 55 1260 55 1440 125"
            stroke="#A78BFA"
            strokeOpacity="0.18"
            strokeWidth="1.5"
          />
        </svg>
      </div>
    </footer>
  );
}

export default Footer;
