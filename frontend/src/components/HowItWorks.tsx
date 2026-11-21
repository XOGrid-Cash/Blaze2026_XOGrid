
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  ScanSearch,
  SlidersHorizontal,
  Wallet,
  ArrowUpRight,
  CheckCircle2,
  Fingerprint,
  FileCheck2,
  Scale,
  Users,
} from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Discover",
    description:
      "Explore an open registry of XO wallet templates. Browse different templates and find options for wallets, payments, and other use cases.",
    icon: Search,
    label: "Explore the registry",
    details: ["Browse published templates", "Search and filter the collection"],
    link: "/explore",
    linkLabel: "Browse templates",
  },
  {
    number: "02",
    title: "Inspect",
    description:
      "Look beyond a template's name. Examine its content-addressed identity, automated audit results, community flags, and human reviews.",
    icon: ScanSearch,
    label: "Understand each template",
    details: [
      "Inspect automated check results",
      "Read flags and signed reviews",
    ],
    link: "/explore",
    linkLabel: "Inspect templates",
  },
  {
    number: "03",
    title: "Evaluate",
    description:
      "Use the policy preview to see whether a template meets your wallet's trust requirements before deciding how to proceed.",
    icon: SlidersHorizontal,
    label: "Your policy, your decision",
    details: [
      "Set your own trust requirements",
      "Preview allow or block decisions",
    ],
    link: "/policy",
    linkLabel: "Explore policy",
  },
  {
    number: "04",
    title: "Use",
    description:
      "Try the voucher demo with a wallet. Review the transaction, let your wallet sign it, and verify the result before broadcasting.",
    icon: Wallet,
    label: "Put templates to work",
    details: ["Connect a supported wallet", "Review and sign transactions"],
    link: "/demo",
    linkLabel: "Try it out",
  },
];

const principles = [
  {
    icon: Fingerprint,
    title: "Content-addressed identity",
    description:
      "Every template receives an identifier derived from its canonical content. Changes produce a different identity.",
  },
  {
    icon: FileCheck2,
    title: "Transparent automated checks",
    description:
      "Inspect individual audit results. An automated pass is not a guarantee that a template is safe.",
  },
  {
    icon: Users,
    title: "Community accountability",
    description:
      "See open flags and signed human reviews associated with the exact template identifier.",
  },
  {
    icon: Scale,
    title: "Your policy, your decision",
    description:
      "Preview how your own trust requirements evaluate a template before choosing to use it.",
  },
];

function HowItWorks() {
  const sectionRef = useRef<HTMLElement | null>(null);

  const [visibleCards, setVisibleCards] = useState<number[]>([]);
  const [principlesVisible, setPrinciplesVisible] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;

    if (!section) return;

    const elements =
      section.querySelectorAll<HTMLElement>("[data-reveal]");

    if (!("IntersectionObserver" in window)) {
      setVisibleCards([0, 1, 2, 3]);
      setPrinciplesVisible(true);
      setCtaVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const revealId =
            (entry.target as HTMLElement).dataset.reveal ?? "";

          if (revealId.startsWith("card-")) {
            const index = Number(revealId.replace("card-", ""));

            if (Number.isInteger(index)) {
              setVisibleCards((previous) =>
                previous.includes(index)
                  ? previous
                  : [...previous, index]
              );
            }
          }

          if (revealId === "principles") {
            setPrinciplesVisible(true);
          }

          if (revealId === "cta") {
            setCtaVisible(true);
          }

          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.12,
        rootMargin: "0px 0px -35px 0px",
      }
    );

    elements.forEach((element: HTMLElement) =>
      observer.observe(element)
    );

    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      className="relative isolate overflow-hidden px-5 py-24 text-white sm:px-8 sm:py-28 lg:px-10 lg:py-32 xl:px-12 xl:py-36 2xl:px-16 2xl:py-40 3xl:px-20 3xl:py-44 4xl:px-24 4xl:py-52"
    >
      <style>{`
        @keyframes how-pulse {
          0%, 100% {
            opacity: .25;
            transform: scale(.85);
          }
          50% {
            opacity: .9;
            transform: scale(1.2);
          }
        }

        @keyframes how-flow {
          to {
            stroke-dashoffset: -180;
          }
        }

        @keyframes how-glow {
          0%, 100% {
            opacity: .25;
          }
          50% {
            opacity: .65;
          }
        }

        @keyframes how-mobile-flow {
          to {
            background-position: 0 160px;
          }
        }

        .how-pulse {
          animation: how-pulse 3s ease-in-out infinite;
        }

        .how-flow-line {
          stroke-dasharray: 8 13;
          animation: how-flow 9s linear infinite;
        }

        .how-glow {
          animation: how-glow 5s ease-in-out infinite;
        }

        .how-card {
          transition:
            transform .4s ease,
            border-color .4s ease,
            background .4s ease,
            box-shadow .4s ease;
        }

        .how-card:hover {
          transform: translateY(-9px);
          border-color: rgba(167, 139, 250, .38);
          background: rgba(139, 92, 246, .055);
          box-shadow: 0 25px 75px rgba(109, 40, 217, .12);
        }

        .how-reveal {
          opacity: 0;
          transform: translateY(35px);
          transition:
            opacity .8s ease,
            transform .8s cubic-bezier(.2,.8,.2,1);
        }

        .how-reveal.is-visible {
          opacity: 1;
          transform: translateY(0);
        }

        .how-mobile-line {
          background: repeating-linear-gradient(
            to bottom,
            rgba(167,139,250,.8) 0px,
            rgba(167,139,250,.8) 5px,
            transparent 5px,
            transparent 13px
          );
          background-size: 2px 160px;
          animation: how-mobile-flow 5s linear infinite;
        }

        @media (min-width: 1280px) {
          .how-reveal {
            transition:
              opacity .9s ease,
              transform .9s cubic-bezier(.2,.8,.2,1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .how-pulse,
          .how-flow-line,
          .how-glow,
          .how-mobile-line {
            animation: none !important;
          }

          .how-card,
          .how-reveal {
            transition: none !important;
          }

          .how-reveal {
            opacity: 1;
            transform: none;
          }

          .how-card:hover {
            transform: none;
          }
        }
      `}</style>

      {/* Ambient lighting */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="how-glow absolute left-1/2 top-20 h-72 w-[650px] -translate-x-1/2 rounded-full bg-violet-600/[0.09] blur-[130px] 2xl:h-96 2xl:w-[900px] 3xl:h-[480px] 3xl:w-[1200px]" />

        <div className="absolute -right-40 top-1/2 h-80 w-80 rounded-full bg-indigo-600/[0.07] blur-[120px] 2xl:h-[450px] 2xl:w-[450px] 3xl:h-[600px] 3xl:w-[600px]" />

        <div className="absolute -left-40 bottom-0 h-80 w-80 rounded-full bg-purple-600/[0.06] blur-[120px] 2xl:h-[450px] 2xl:w-[450px] 3xl:h-[600px] 3xl:w-[600px]" />
      </div>

      <div className="mx-auto w-full max-w-7xl xl:max-w-[1440px] 2xl:max-w-[1600px] 3xl:max-w-[1800px] 4xl:max-w-[2100px]">

        {/* Section heading */}
        <div className="mx-auto mb-16 max-w-3xl text-center sm:mb-20 xl:mb-24 2xl:max-w-4xl 2xl:mb-28 3xl:max-w-5xl 3xl:mb-32">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/[0.07] px-4 py-2 2xl:mb-8 2xl:px-5 2xl:py-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-300 shadow-[0_0_12px_rgba(167,139,250,.9)]" />

            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200 sm:text-xs 2xl:text-sm">
              Simple by design
            </span>
          </div>

          <h2 className="text-4xl font-semibold tracking-[-0.055em] sm:text-5xl lg:text-6xl 2xl:text-7xl 3xl:text-[84px] 4xl:text-[100px]">
            How XO<span className="text-orange-500">Grid</span> works.
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-sm leading-7 text-white/45 sm:text-base sm:leading-8 2xl:mt-8 2xl:max-w-3xl 2xl:text-lg 2xl:leading-9 3xl:max-w-4xl 3xl:text-xl 3xl:leading-10">
            Discover, inspect, evaluate, and use XO wallet templates.
            Everything you need to understand a template before making
            your own decision.
          </p>
        </div>

        {/* Four-step workflow */}
        <div className="relative pb-0 xl:pb-20 2xl:pb-24 3xl:pb-28">

          {/* Desktop connectors */}
          <div className="pointer-events-none absolute inset-0 z-0 hidden xl:block">
            <svg
              viewBox="0 0 1200 420"
              preserveAspectRatio="none"
              className="h-full w-full overflow-visible"
              fill="none"
            >
              <defs>
                <linearGradient
                  id="howFlowGradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.15" />
                  <stop offset="50%" stopColor="#C4B5FD" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#6366F1" stopOpacity="0.2" />
                </linearGradient>
              </defs>

              <path
                d="M 270 65 C 300 65, 300 105, 325 105"
                stroke="url(#howFlowGradient)"
                strokeWidth="2"
              />

              <path
                d="M 570 105 C 600 105, 600 145, 625 145"
                stroke="url(#howFlowGradient)"
                strokeWidth="2"
              />

              <path
                d="M 870 145 C 900 145, 900 185, 925 185"
                stroke="url(#howFlowGradient)"
                strokeWidth="2"
              />

              <path
                d="M 270 65 C 300 65, 300 105, 325 105 M 570 105 C 600 105, 600 145, 625 145 M 870 145 C 900 145, 900 185, 925 185"
                className="how-flow-line"
                stroke="#C4B5FD"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {[270, 325, 570, 625, 870, 925].map((x, index) => (
                <circle
                  key={index}
                  cx={x}
                  cy={[65, 105, 105, 145, 145, 185][index]}
                  r="4"
                  fill={index % 2 === 0 ? "#A78BFA" : "#C4B5FD"}
                />
              ))}

              <circle
                cx="270"
                cy="65"
                r="10"
                fill="#A78BFA"
                opacity=".2"
                className="how-pulse"
              />

              <circle
                cx="925"
                cy="185"
                r="10"
                fill="#818CF8"
                opacity=".2"
                className="how-pulse"
                style={{ animationDelay: "1.5s" }}
              />
            </svg>
          </div>

          {/* Mobile and tablet vertical connector */}
          <div className="pointer-events-none absolute bottom-10 left-[23px] top-10 z-0 w-[2px] overflow-hidden xl:hidden">
            <div className="how-mobile-line h-full w-full opacity-60" />
          </div>

          {/* Workflow cards */}
          <div className="relative z-10 grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-7 lg:gap-8 xl:grid-cols-4 xl:gap-6 2xl:gap-8 3xl:gap-10 4xl:gap-12">

            {steps.map((step, index) => {
              const Icon = step.icon;
              const isVisible = visibleCards.includes(index);

              return (
                <article
                  key={step.number}
                  data-reveal={`card-${index}`}
                  className={`
                    how-card how-reveal
                    ${isVisible ? "is-visible" : ""}
                    group relative flex min-w-0 flex-col
                    rounded-2xl border border-white/[0.09]
                    bg-white/[0.018] p-6 backdrop-blur-sm
                    sm:p-7 lg:p-8
                    xl:min-h-[570px] xl:p-6
                    2xl:min-h-[620px] 2xl:rounded-3xl 2xl:p-8
                    3xl:min-h-[680px] 3xl:p-10
                    4xl:min-h-[740px] 4xl:p-12
                    ${index === 1 ? "xl:translate-y-8" : ""}
                    ${index === 2 ? "xl:translate-y-16" : ""}
                    ${index === 3 ? "xl:translate-y-24" : ""}
                  `}
                  style={{
                    transitionDelay: `${index * 140}ms`,
                  }}
                >
                  {/* Number and icon */}
                  <div className="relative z-10 mb-7 flex items-center justify-between sm:mb-9 2xl:mb-12">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-500/[0.10] text-violet-200 shadow-[0_0_30px_rgba(139,92,246,.08)] transition-all duration-300 group-hover:border-violet-300/40 group-hover:bg-violet-500/[0.16] 2xl:h-14 2xl:w-14 2xl:rounded-2xl 3xl:h-16 3xl:w-16">
                      <Icon
                        size={22}
                        strokeWidth={1.7}
                        className="2xl:h-6 2xl:w-6 3xl:h-7 3xl:w-7"
                      />
                    </div>

                    <span className="font-mono text-sm tracking-widest text-white/25 2xl:text-base 3xl:text-lg">
                      / {step.number}
                    </span>
                  </div>

                  <h3 className="text-2xl font-semibold tracking-tight text-white 2xl:text-3xl 3xl:text-4xl 4xl:text-[42px]">
                    {step.title}
                  </h3>

                  <p className="mt-4 text-sm leading-7 text-white/45 sm:min-h-[125px] lg:min-h-[140px] xl:min-h-[175px] 2xl:mt-5 2xl:min-h-[190px] 2xl:text-base 2xl:leading-8 3xl:min-h-[220px] 3xl:text-lg 3xl:leading-9">
                    {step.description}
                  </p>

                  {/* Details */}
                  <div className="mt-5 space-y-3 border-t border-white/[0.08] pt-6 2xl:mt-7 2xl:space-y-4 2xl:pt-8">
                    {step.details.map((detail) => (
                      <div
                        key={detail}
                        className="flex items-start gap-3 text-xs leading-5 text-white/55 2xl:gap-4 2xl:text-sm 2xl:leading-6 3xl:text-base"
                      >
                        <CheckCircle2
                          size={15}
                          className="mt-0.5 shrink-0 text-violet-300/75 2xl:h-5 2xl:w-5"
                        />

                        {detail}
                      </div>
                    ))}
                  </div>

                  {/* Card footer */}
                  <div className="mt-auto flex items-center justify-between gap-3 pt-8 2xl:pt-10">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-300/75 2xl:text-xs 3xl:text-sm">
                      {step.label}
                    </span>

                    <Link
                      to={step.link}
                      aria-label={step.linkLabel}
                      title={step.linkLabel}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/45 transition-all duration-300 hover:border-orange-400/40 hover:bg-orange-500/10 hover:text-orange-300 2xl:h-11 2xl:w-11"
                    >
                      <ArrowUpRight size={16} className="2xl:h-5 2xl:w-5" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {/* Product principles */}
        <div
          data-reveal="principles"
          className={`how-reveal mt-20 border-t border-white/[0.08] pt-12 sm:mt-24 xl:mt-32 2xl:mt-40 2xl:pt-16 3xl:mt-44 ${
            principlesVisible ? "is-visible" : ""
          }`}
        >
          <div className="mb-10 text-center 2xl:mb-14">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35 2xl:text-xs">
              Built around transparency
            </span>

            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl 2xl:text-4xl 3xl:text-5xl">
              What makes XO<span className="text-orange-500">Grid</span>{" "}
              different?
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-9 sm:grid-cols-2 lg:grid-cols-4 lg:gap-7 2xl:gap-10 3xl:gap-14">
            {principles.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  className="flex min-w-0 items-start gap-4 2xl:gap-5 3xl:gap-6"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet-300/15 bg-violet-500/[0.07] text-violet-300 2xl:h-14 2xl:w-14 2xl:rounded-2xl">
                    <Icon
                      size={19}
                      strokeWidth={1.7}
                      className="2xl:h-6 2xl:w-6"
                    />
                  </div>

                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-white/85 2xl:text-base 3xl:text-lg">
                      {item.title}
                    </h4>

                    <p className="mt-2 text-xs leading-6 text-white/40 2xl:text-sm 2xl:leading-7 3xl:text-base 3xl:leading-8">
                      {item.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom CTA */}
        <div
          data-reveal="cta"
          className={`how-reveal mt-16 flex flex-col items-center justify-between gap-6 rounded-2xl border border-violet-300/15 bg-violet-500/[0.045] p-7 text-center sm:mt-20 sm:flex-row sm:p-9 sm:text-left 2xl:mt-28 2xl:rounded-3xl 2xl:p-12 3xl:mt-32 3xl:p-16 ${
            ctaVisible ? "is-visible" : ""
          }`}
        >
          <div>
            <h3 className="text-xl font-semibold tracking-tight sm:text-2xl 2xl:text-3xl 3xl:text-4xl">
              Ready to explore the registry?
            </h3>

            <p className="mt-2 text-sm leading-7 text-white/45 2xl:mt-3 2xl:text-base 2xl:leading-8 3xl:text-lg">
              Discover templates, inspect their details, and make informed
              decisions.
            </p>
          </div>

          <Link
            to="/explore"
            className="group inline-flex shrink-0 items-center justify-center gap-3 rounded-xl bg-orange-500 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_10px_35px_rgba(249,115,22,.16)] transition-all duration-300 hover:-translate-y-1 hover:bg-orange-400 hover:shadow-[0_12px_40px_rgba(249,115,22,.3)] 2xl:rounded-2xl 2xl:px-8 2xl:py-4 2xl:text-base 3xl:px-10 3xl:py-5"
          >
            Explore templates

            <ArrowUpRight
              size={17}
              className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1 2xl:h-5 2xl:w-5"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}

export default HowItWorks;
