import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

const PALETTE = {
  bg: '#ffffff',
  bgSubtle: '#f6f9fc',
  ink: '#0a2540',
  body: '#425466',
  muted: '#8898aa',
  accent: '#0a6e5c',
  accentHover: '#085a4b',
  accentSoft: 'rgba(10,110,92,0.08)',
  border: '#e3e8ee',
  borderStrong: '#c4cdd5',
  shadow1: 'rgba(50,50,93,0.25)',
  shadow2: 'rgba(0,0,0,0.08)',
  amber: '#c4841d',
};

const FONTS = {
  sans: "'DM Sans', system-ui, sans-serif",
  mono: "'Geist Mono', 'SF Mono', monospace",
};

const EASE = [0.16, 1, 0.3, 1];

const PROOF_POINTS = [
  { label: 'Setup', value: 'Connect Stripe in 60 seconds' },
  { label: 'Every action', value: 'Evidence trail + your approval' },
  { label: 'Day one', value: 'Starts in review mode, earns autonomy' },
];

const HOW_STEPS = [
  {
    step: '01',
    title: 'Connect Stripe',
    body: 'One API key. Nooterra reads your customers, invoices, payments, and disputes. Full picture in minutes.',
  },
  {
    step: '02',
    title: 'Set the rules',
    body: 'Dollar thresholds, contact limits, business hours. You define the boundaries. The system enforces them on every action.',
  },
  {
    step: '03',
    title: 'Review with evidence',
    body: 'Each recommendation comes with the payment history, dispute status, and reasoning behind it. Approve or reject in one click.',
  },
  {
    step: '04',
    title: 'Earn autonomy',
    body: 'As outcomes improve, more actions move out of the review lane. You stay in control of what that threshold is.',
  },
];

const STRIPE_HANDLES = [
  'Retries the payment method on file',
  'Sends the same dunning email to every customer',
  'Gives you a list of overdue invoices',
];

const NOOTERRA_HANDLES = [
  'Reads the full payment history before deciding what to do',
  'Sends different follow-ups to different customers based on their pattern',
  'Holds outreach when there\'s an active dispute',
  'Escalates to your team when the situation is ambiguous',
];

const TRUST_POINTS = [
  {
    title: 'Nothing happens without you',
    body: 'Every follow-up is proposed, not sent. You approve each action until the system earns enough track record to act on its own.',
  },
  {
    title: 'Your rules, not ours',
    body: 'You set the dollar limits, contact frequency, and escalation triggers. The system enforces them \u2014 it cannot override your policies.',
  },
  {
    title: 'Every decision is recorded',
    body: 'What was recommended, what evidence supported it, what you decided, and what happened after. Exportable. Audit-ready.',
  },
];

const DOSSIER_EVIDENCE = [
  'Paid 8 of last 10 invoices within terms',
  'No disputes filed in the past 12 months',
  'Similar overdue invoices resolved after one follow-up',
];

const DOSSIER_AUDIT = [
  '11:42 UTC  Ranked #3 of 48 overdue accounts',
  '11:42 UTC  All policy checks passed',
  '11:43 UTC  Flagged for approval \u2014 invoice exceeds $5,000',
];

/* ── Helpers ── */

function revealProps(reducedMotion, delay = 0) {
  if (reducedMotion) return {};
  return {
    initial: { opacity: 0, y: 6 },
    whileInView: { opacity: 1, y: 0 },
    transition: { duration: 0.22, delay, ease: EASE },
    viewport: { once: true, margin: '-48px' },
  };
}

function loadProps(reducedMotion, delay = 0) {
  if (reducedMotion) return {};
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.22, delay, ease: EASE },
  };
}

/* ── Logo ── */

function NooterraLogo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="3" stroke={PALETTE.ink} strokeWidth="1.5" />
      <circle cx="9.5" cy="10" r="2" fill={PALETTE.ink} />
      <circle cx="22.5" cy="10" r="2" fill={PALETTE.ink} />
      <circle cx="16" cy="22" r="2" fill={PALETTE.accent} />
      <path d="M9.5 12L16 20M22.5 12L16 20M11.5 10H20.5" stroke={PALETTE.ink} strokeWidth="1.35" />
    </svg>
  );
}

/* ── Section Label ── */

function SectionLabel({ children }) {
  return (
    <div
      className="mb-5 text-xs font-medium uppercase tracking-[0.14em]"
      style={{ color: PALETTE.muted, fontFamily: FONTS.mono, fontSize: '11px' }}
    >
      {children}
    </div>
  );
}

/* ── Decision Dossier Mockup ── */

function DecisionDossierMockup() {
  const reducedMotion = useReducedMotion();

  function reveal(delay) {
    if (reducedMotion) return {};
    return {
      initial: { opacity: 0, y: 8 },
      whileInView: { opacity: 1, y: 0 },
      transition: { duration: 0.5, delay, ease: EASE },
      viewport: { once: true, margin: '-20px' },
    };
  }

  return (
    <aside
      className="w-full select-none cursor-default"
      style={{
        background: PALETTE.bg,
        border: `1px solid ${PALETTE.border}`,
        borderRadius: '8px',
        boxShadow: `${PALETTE.shadow1} 0px 30px 60px -12px, ${PALETTE.shadow2} 0px 18px 36px -18px`,
      }}
    >
      {/* Header */}
      <motion.div
        {...reveal(0)}
        className="flex items-center justify-between gap-4 px-4 py-3 text-[11px] uppercase tracking-[0.18em] sm:px-5"
        style={{
          borderBottom: `1px solid ${PALETTE.border}`,
          fontFamily: FONTS.mono,
          color: PALETTE.muted,
        }}
      >
        <span>INV-8842 / Overdue Review</span>
        <span className="inline-flex items-center gap-2" style={{ color: PALETTE.amber }}>
          <span className="h-2 w-2 rounded-full" style={{ background: PALETTE.amber }} />
          Awaiting approval
        </span>
      </motion.div>

      {/* Customer info */}
      <motion.div
        {...reveal(0.15)}
        className="px-4 py-4 sm:px-5"
        style={{ borderBottom: `1px solid ${PALETTE.border}` }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div
              className="mb-1 text-[11px] uppercase tracking-[0.16em]"
              style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
            >
              Customer
            </div>
            <div
              className="text-[1.5rem] leading-none sm:text-[1.8rem]"
              style={{ fontWeight: 500, letterSpacing: '-0.03em', color: PALETTE.ink, fontFamily: FONTS.sans }}
            >
              Acme Manufacturing
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm" style={{ color: PALETTE.body }}>
              <span>$14,200 due</span>
              <span>42 days overdue</span>
              <span>Tier 1 account</span>
            </div>
          </div>
          <div
            className="min-w-[6rem] px-3 py-2 text-right"
            style={{
              border: `1px solid ${PALETTE.border}`,
              background: PALETTE.bgSubtle,
              borderRadius: '6px',
            }}
          >
            <div
              className="text-[10px] uppercase tracking-[0.18em]"
              style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
            >
              Queue rank
            </div>
            <div className="mt-1 text-xl" style={{ fontWeight: 500, color: PALETTE.ink }}>
              03 / 48
            </div>
          </div>
        </div>
      </motion.div>

      {/* Analysis */}
      <div
        className="grid md:grid-cols-[1.25fr_0.95fr]"
        style={{ borderBottom: `1px solid ${PALETTE.border}` }}
      >
        <motion.div
          {...reveal(0.4)}
          className="border-b px-4 py-4 md:border-b-0 md:border-r sm:px-5"
          style={{ borderColor: PALETTE.border }}
        >
          <div
            className="text-[11px] uppercase tracking-[0.16em]"
            style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
          >
            Recovery likelihood
          </div>
          <div className="mt-3 flex items-end gap-3">
            <motion.div
              className="text-[2.2rem] leading-none sm:text-[2.6rem]"
              style={{ color: PALETTE.ink, fontWeight: 500, letterSpacing: '-0.02em' }}
              {...(reducedMotion
                ? {}
                : {
                    initial: { opacity: 0 },
                    whileInView: { opacity: 1 },
                    transition: { duration: 0.3, delay: 0.6 },
                    viewport: { once: true },
                  })}
            >
              64%
            </motion.div>
            <div
              className="pb-1 text-xs uppercase tracking-[0.16em]"
              style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
            >
              High confidence
            </div>
          </div>
          <motion.div
            className="mt-4"
            {...(reducedMotion
              ? {}
              : {
                  initial: { scaleX: 0, transformOrigin: 'left' },
                  whileInView: { scaleX: 1 },
                  transition: { duration: 0.8, delay: 0.5, ease: EASE },
                  viewport: { once: true },
                })}
          >
            <div
              className="relative h-2"
              style={{
                border: `1px solid ${PALETTE.borderStrong}`,
                background: PALETTE.bgSubtle,
                borderRadius: '2px',
              }}
            >
              <div
                className="absolute left-[24%] right-[18%] top-0 h-full"
                style={{
                  background: PALETTE.accentSoft,
                  borderLeft: `1px solid ${PALETTE.accent}`,
                  borderRight: `1px solid ${PALETTE.accent}`,
                }}
              />
              <div
                className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2"
                style={{
                  left: '64%',
                  background: PALETTE.accent,
                  border: `2px solid ${PALETTE.bg}`,
                  borderRadius: '2px',
                }}
              />
            </div>
            <div
              className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.16em]"
              style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
            >
              <span>52%</span>
              <span>71%</span>
            </div>
          </motion.div>
        </motion.div>

        <motion.div {...reveal(0.55)} className="px-4 py-4 sm:px-5">
          <div
            className="text-[11px] uppercase tracking-[0.16em]"
            style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
          >
            Recommended action
          </div>
          <div
            className="mt-3 px-3 py-3 text-sm"
            style={{
              background: PALETTE.ink,
              color: PALETTE.bg,
              borderRadius: '6px',
              fontWeight: 500,
              fontFamily: FONTS.sans,
            }}
          >
            Send formal follow-up email
          </div>
          <div className="mt-4 grid gap-2 text-sm" style={{ color: PALETTE.body }}>
            <div className="flex items-center justify-between gap-4">
              <span>Alternative considered</span>
              <span style={{ fontFamily: FONTS.mono, color: PALETTE.amber }}>Escalate now</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Expected next outcome</span>
              <span style={{ fontFamily: FONTS.mono, color: PALETTE.accent }}>Response within 3d</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Evidence + Audit */}
      <div className="grid md:grid-cols-[1.1fr_0.9fr]">
        <motion.div
          {...reveal(0.75)}
          className="border-b px-4 py-4 md:border-b-0 md:border-r sm:px-5"
          style={{ borderColor: PALETTE.border }}
        >
          <div
            className="text-[11px] uppercase tracking-[0.16em]"
            style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
          >
            Evidence
          </div>
          <div className="mt-3 space-y-2 text-sm leading-relaxed" style={{ color: PALETTE.body }}>
            {DOSSIER_EVIDENCE.map((item, i) => (
              <motion.div
                key={item}
                className="pl-3"
                style={{ borderLeft: `2px solid ${PALETTE.accent}` }}
                {...(reducedMotion
                  ? {}
                  : {
                      initial: { opacity: 0, x: -4 },
                      whileInView: { opacity: 1, x: 0 },
                      transition: { duration: 0.3, delay: 0.85 + i * 0.1 },
                      viewport: { once: true },
                    })}
              >
                {item}
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div {...reveal(0.9)} className="px-4 py-4 sm:px-5">
          <div
            className="text-[11px] uppercase tracking-[0.16em]"
            style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
          >
            Approval + audit
          </div>
          <div
            className="mt-3 px-3 py-3"
            style={{
              border: `1px solid ${PALETTE.border}`,
              background: PALETTE.bgSubtle,
              borderRadius: '6px',
            }}
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span style={{ color: PALETTE.body }}>Your approval</span>
              <span style={{ color: PALETTE.amber, fontFamily: FONTS.mono }}>Required</span>
            </div>
            <div
              className="mt-3 text-[11px] uppercase tracking-[0.16em]"
              style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
            >
              Activity log
            </div>
            <div
              className="mt-2 space-y-2 text-xs leading-relaxed"
              style={{ color: PALETTE.body, fontFamily: FONTS.mono }}
            >
              {DOSSIER_AUDIT.map((item, i) => (
                <motion.div
                  key={item}
                  {...(reducedMotion
                    ? {}
                    : {
                        initial: { opacity: 0 },
                        whileInView: { opacity: 1 },
                        transition: { duration: 0.25, delay: 1.0 + i * 0.08 },
                        viewport: { once: true },
                      })}
                >
                  {item}
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </aside>
  );
}

/* ── Main Page ── */

export default function LandingPage() {
  const reducedMotion = useReducedMotion();

  return (
    <div
      className="min-h-screen"
      style={{
        background: PALETTE.bg,
        color: PALETTE.ink,
        fontFamily: FONTS.sans,
      }}
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          html { scroll-behavior: smooth; }
        }
        .nav-link {
          position: relative;
          padding-bottom: 2px;
        }
        .nav-link::after {
          content: '';
          position: absolute;
          left: 0;
          bottom: -2px;
          width: 0;
          height: 1.5px;
          background: currentColor;
          transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .nav-link:hover::after {
          width: 100%;
        }
        .btn-primary {
          transition: background 0.2s ease, box-shadow 0.2s ease;
        }
        .btn-primary:hover {
          background: ${PALETTE.accentHover} !important;
        }
        .btn-primary:active {
          background: ${PALETTE.accentHover} !important;
          box-shadow: none !important;
        }
        .btn-ghost {
          transition: background 0.2s ease;
        }
        .btn-ghost:hover {
          background: ${PALETTE.bgSubtle};
        }
      `}</style>

      {/* ── Nav ── */}
      <nav
        className="sticky top-0 z-50"
        style={{
          borderBottom: `1px solid ${PALETTE.border}`,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div className="mx-auto flex max-w-[78rem] items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <a href="/" className="inline-flex items-center gap-3 no-underline">
            <NooterraLogo />
            <span
              className="text-[1.05rem] tracking-[-0.04em]"
              style={{ color: PALETTE.ink, fontWeight: 600, fontFamily: FONTS.sans }}
            >
              Nooterra
            </span>
          </a>

          <div className="hidden items-center gap-7 md:flex">
            {[
              ['#how-it-works', 'How it works'],
              ['#why-nooterra', 'Why Nooterra'],
              ['/docs', 'Docs'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="nav-link text-sm no-underline"
                style={{ color: PALETTE.body, fontWeight: 500, fontFamily: FONTS.sans }}
              >
                {label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <a
              href="/login"
              className="hidden text-sm no-underline sm:block"
              style={{ color: PALETTE.body, fontWeight: 500, fontFamily: FONTS.sans }}
            >
              Sign in
            </a>
            <a
              href="/setup"
              className="btn-primary inline-flex items-center justify-center px-4 py-2 text-sm no-underline"
              style={{
                background: PALETTE.accent,
                color: '#fff',
                fontWeight: 500,
                fontFamily: FONTS.sans,
                borderRadius: '6px',
                boxShadow: `${PALETTE.shadow1} 0px 2px 5px -1px, ${PALETTE.shadow2} 0px 1px 3px -1px`,
              }}
            >
              Get started
            </a>
          </div>
        </div>
      </nav>

      <main>
        {/* ── Hero ── */}
        <section
          className="scroll-mt-24"
          style={{
            borderBottom: `1px solid ${PALETTE.border}`,
            background: 'linear-gradient(180deg, #f0f4f8 0%, #ffffff 50%)',
          }}
        >
          <div className="mx-auto grid max-w-[78rem] lg:grid-cols-[1.15fr_1fr]">
            {/* Left: headline + CTA */}
            <div className="flex flex-col justify-center px-4 py-14 sm:px-6 lg:px-10 lg:py-24">
              <motion.h1
                {...loadProps(reducedMotion, 0.04)}
                className="text-[clamp(2.4rem,5vw,3.25rem)] leading-[1.08]"
                style={{
                  fontFamily: FONTS.sans,
                  fontWeight: 500,
                  letterSpacing: '-0.03em',
                  color: PALETTE.ink,
                }}
              >
                Overdue invoices.{' '}
                <br className="hidden sm:block" />
                Recovered.
              </motion.h1>

              <motion.p
                {...loadProps(reducedMotion, 0.12)}
                className="mt-6 max-w-[30rem] text-lg leading-[1.7]"
                style={{ color: PALETTE.body, fontWeight: 400 }}
              >
                AI-powered collections that connect to Stripe, read every payment pattern, and follow up on overdue accounts — with evidence and your approval.
              </motion.p>

              <motion.div
                {...loadProps(reducedMotion, 0.2)}
                className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center"
              >
                <a
                  href="/setup"
                  className="btn-primary inline-flex items-center justify-center gap-2 px-7 py-3 text-[15px] no-underline"
                  style={{
                    background: PALETTE.accent,
                    color: '#fff',
                    fontFamily: FONTS.sans,
                    fontWeight: 500,
                    borderRadius: '6px',
                    boxShadow: `${PALETTE.shadow1} 0px 4px 12px -2px, ${PALETTE.shadow2} 0px 2px 6px -2px`,
                  }}
                >
                  Get started
                  <ArrowRight size={16} strokeWidth={2} />
                </a>
                <a
                  href="#how-it-works"
                  className="nav-link inline-flex items-center gap-1.5 py-2 text-[15px] no-underline"
                  style={{ color: PALETTE.ink, fontFamily: FONTS.sans, fontWeight: 500 }}
                >
                  Explore product
                  <ArrowRight size={15} strokeWidth={1.5} />
                </a>
              </motion.div>

              {/* Proof strip */}
              <motion.div
                {...loadProps(reducedMotion, 0.3)}
                className="mt-14 flex flex-wrap gap-6 pt-6"
                style={{ borderTop: `1px solid ${PALETTE.border}` }}
              >
                {PROOF_POINTS.map((item) => (
                  <div key={item.label}>
                    <div
                      className="text-[10px] uppercase tracking-[0.18em]"
                      style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
                    >
                      {item.label}
                    </div>
                    <div
                      className="mt-1.5 text-sm"
                      style={{ color: PALETTE.ink, fontWeight: 500 }}
                    >
                      {item.value}
                    </div>
                  </div>
                ))}
              </motion.div>
            </div>

            {/* Right: product visual */}
            <div
              className="relative flex items-center justify-center overflow-hidden px-6 py-10 lg:px-10 lg:py-14"
              style={{
                background: `
                  radial-gradient(ellipse 80% 70% at 60% 40%, rgba(10,110,92,0.06) 0%, transparent 70%),
                  radial-gradient(ellipse 60% 50% at 30% 80%, rgba(50,50,93,0.04) 0%, transparent 60%),
                  ${PALETTE.bgSubtle}
                `,
              }}
            >
              <div
                className="w-full max-w-[32rem]"
                style={{
                  transform: 'perspective(1200px) rotateY(-4deg) rotateX(2deg)',
                  transformStyle: 'preserve-3d',
                }}
              >
                <DecisionDossierMockup />
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section
          id="how-it-works"
          className="scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
          style={{ background: PALETTE.bg }}
        >
          <div className="mx-auto grid max-w-[78rem] gap-12 lg:grid-cols-[0.9fr_1.4fr]">
            <motion.div {...revealProps(reducedMotion, 0.04)}>
              <SectionLabel>How it works</SectionLabel>
              <h2
                className="max-w-[22ch] text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1]"
                style={{ fontWeight: 500, letterSpacing: '-0.03em', color: PALETTE.ink }}
              >
                Four steps from Stripe to first recommendation.
              </h2>
              <p
                className="mt-5 max-w-[34rem] text-base leading-7 sm:text-lg"
                style={{ color: PALETTE.body }}
              >
                No implementation project. No data migration. Nooterra reads directly from Stripe and starts
                working with whatever you already have.
              </p>
            </motion.div>

            <div
              style={{
                border: `1px solid ${PALETTE.border}`,
                background: PALETTE.bg,
                borderRadius: '8px',
                boxShadow: `${PALETTE.shadow1} 0px 30px 60px -12px, ${PALETTE.shadow2} 0px 18px 36px -18px`,
              }}
            >
              <div className="grid md:grid-cols-2">
                {HOW_STEPS.map((item, index) => {
                  const isLeft = index % 2 === 0;
                  const isTopRow = index < 2;
                  return (
                  <motion.div
                    key={item.step}
                    {...revealProps(reducedMotion, index * 0.06)}
                    className={`px-5 py-6 ${index < 3 ? 'border-b' : ''} ${isLeft ? 'md:border-r' : ''} ${!isTopRow ? 'md:border-b-0' : ''}`}
                    style={{ borderColor: PALETTE.border }}
                  >
                    <div
                      className="text-[11px] uppercase tracking-[0.18em]"
                      style={{ color: PALETTE.accent, fontFamily: FONTS.mono }}
                    >
                      {item.step}
                    </div>
                    <h3
                      className="mt-4 text-xl"
                      style={{ fontWeight: 500, letterSpacing: '-0.02em', color: PALETTE.ink }}
                    >
                      {item.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7" style={{ color: PALETTE.body }}>
                      {item.body}
                    </p>
                  </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── Stripe vs Nooterra ── */}
        <section
          id="why-nooterra"
          className="scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
          style={{ background: PALETTE.bgSubtle }}
        >
          <div className="mx-auto max-w-[78rem]">
            <motion.div {...revealProps(reducedMotion, 0.04)} className="mb-12 max-w-[48rem]">
              <SectionLabel>The gap in your collections process</SectionLabel>
              <h2
                className="text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1]"
                style={{ fontWeight: 500, letterSpacing: '-0.03em', color: PALETTE.ink }}
              >
                Stripe retries the card.{' '}
                <span style={{ color: PALETTE.body }}>
                  Nobody follows up on the rest.
                </span>
              </h2>
            </motion.div>

            <div
              className="grid md:grid-cols-2"
              style={{
                border: `1px solid ${PALETTE.border}`,
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: `${PALETTE.shadow1} 0px 13px 27px -5px, ${PALETTE.shadow2} 0px 8px 16px -8px`,
              }}
            >
              <motion.div
                {...revealProps(reducedMotion, 0.04)}
                className="px-6 py-7"
                style={{ background: PALETTE.bg, borderRight: `1px solid ${PALETTE.border}` }}
              >
                <div
                  className="text-[11px] uppercase tracking-[0.18em]"
                  style={{ color: PALETTE.muted, fontFamily: FONTS.mono }}
                >
                  What Stripe handles
                </div>
                <div className="mt-5 space-y-3.5">
                  {STRIPE_HANDLES.map((item) => (
                    <div key={item} className="flex items-start gap-3 text-sm" style={{ color: PALETTE.body }}>
                      <span
                        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center text-[10px]"
                        style={{
                          border: `1px solid ${PALETTE.border}`,
                          borderRadius: '4px',
                          fontFamily: FONTS.mono,
                          color: PALETTE.muted,
                        }}
                      >
                        OK
                      </span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              <motion.div
                {...revealProps(reducedMotion, 0.08)}
                className="px-6 py-7"
                style={{ background: PALETTE.bg }}
              >
                <div
                  className="text-[11px] uppercase tracking-[0.18em]"
                  style={{ color: PALETTE.accent, fontFamily: FONTS.mono }}
                >
                  What Nooterra adds
                </div>
                <div className="mt-5 space-y-3.5">
                  {NOOTERRA_HANDLES.map((item) => (
                    <div key={item} className="flex items-start gap-3 text-sm" style={{ color: PALETTE.ink }}>
                      <span
                        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center text-[10px]"
                        style={{
                          border: `1px solid ${PALETTE.accent}`,
                          background: PALETTE.accentSoft,
                          borderRadius: '4px',
                          fontFamily: FONTS.mono,
                          color: PALETTE.accent,
                        }}
                      >
                        GO
                      </span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── Trust ── */}
        <section className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24" style={{ background: PALETTE.bg }}>
          <div className="mx-auto max-w-[78rem]">
            <motion.div {...revealProps(reducedMotion, 0.04)} className="mb-12 max-w-[48rem]">
              <SectionLabel>Why this is safe to try</SectionLabel>
              <h2
                className="text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1]"
                style={{ fontWeight: 500, letterSpacing: '-0.03em', color: PALETTE.ink }}
              >
                You stay in control. Always.
              </h2>
            </motion.div>

            <div
              style={{
                border: `1px solid ${PALETTE.border}`,
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: `${PALETTE.shadow1} 0px 13px 27px -5px, ${PALETTE.shadow2} 0px 8px 16px -8px`,
              }}
            >
              <div className="grid lg:grid-cols-3">
                {TRUST_POINTS.map((item, index) => (
                  <motion.div
                    key={item.title}
                    {...revealProps(reducedMotion, index * 0.05)}
                    className={`px-6 py-7 ${index < TRUST_POINTS.length - 1 ? 'border-b lg:border-b-0 lg:border-r' : ''}`}
                    style={{
                      background: PALETTE.bg,
                      borderColor: PALETTE.border,
                    }}
                  >
                    <h3
                      className="text-lg"
                      style={{ fontWeight: 500, letterSpacing: '-0.02em', color: PALETTE.ink }}
                    >
                      {item.title}
                    </h3>
                    <p className="mt-4 text-sm leading-7" style={{ color: PALETTE.body }}>
                      {item.body}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section
          className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
          style={{ background: PALETTE.bgSubtle }}
        >
          <motion.div
            {...revealProps(reducedMotion, 0.04)}
            className="mx-auto max-w-[78rem] p-8 sm:p-10 lg:p-14"
            style={{
              background: PALETTE.bg,
              border: `1px solid ${PALETTE.border}`,
              borderRadius: '8px',
              boxShadow: `${PALETTE.shadow1} 0px 30px 60px -12px, ${PALETTE.shadow2} 0px 18px 36px -18px`,
            }}
          >
            <div className="grid gap-8 lg:grid-cols-[1.25fr_0.85fr] lg:items-end">
              <div>
                <h2
                  className="max-w-[18ch] text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1]"
                  style={{ fontWeight: 500, letterSpacing: '-0.03em', color: PALETTE.ink }}
                >
                  See it work on your own data.
                </h2>
                <p
                  className="mt-5 max-w-[38rem] text-base leading-7 sm:text-lg"
                  style={{ color: PALETTE.body }}
                >
                  Connect Stripe and watch Nooterra analyze your overdue invoices in your first session. No commitment. No credit card.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                <a
                  href="/setup"
                  className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-3 text-sm no-underline"
                  style={{
                    background: PALETTE.accent,
                    color: '#fff',
                    fontWeight: 500,
                    fontFamily: FONTS.sans,
                    borderRadius: '6px',
                    boxShadow: `${PALETTE.shadow1} 0px 4px 12px -2px, ${PALETTE.shadow2} 0px 2px 6px -2px`,
                  }}
                >
                  Get started
                  <ArrowRight size={15} />
                </a>
                <a
                  href="/docs"
                  className="btn-ghost inline-flex items-center justify-center px-6 py-3 text-sm no-underline"
                  style={{
                    border: `1px solid ${PALETTE.border}`,
                    color: PALETTE.ink,
                    fontWeight: 500,
                    fontFamily: FONTS.sans,
                    borderRadius: '6px',
                  }}
                >
                  Read the docs
                </a>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer
        className="px-4 py-8 sm:px-6 lg:px-8"
        style={{ borderTop: `1px solid ${PALETTE.border}`, background: PALETTE.bg }}
      >
        <div className="mx-auto flex max-w-[78rem] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-3">
            <NooterraLogo size={18} />
            <span className="text-sm" style={{ color: PALETTE.body }}>
              Nooterra
            </span>
          </div>
          <div
            className="flex flex-wrap gap-5 text-sm"
            style={{ color: PALETTE.body, fontFamily: FONTS.sans }}
          >
            <a href="/docs" className="no-underline" style={{ color: 'inherit' }}>Docs</a>
            <a href="/privacy" className="no-underline" style={{ color: 'inherit' }}>Privacy</a>
            <a href="/terms" className="no-underline" style={{ color: 'inherit' }}>Terms</a>
            <a href="https://github.com/nooterra/nooterra" className="no-underline" style={{ color: 'inherit' }}>GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
