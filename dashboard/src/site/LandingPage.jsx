import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

const PALETTE = {
  paper: '#F4F0E8',
  paperAlt: '#ECE4D7',
  panel: '#FAF7F1',
  line: 'rgba(23,20,17,0.14)',
  lineStrong: 'rgba(23,20,17,0.26)',
  ink: '#171411',
  steel: '#655E56',
  steelSoft: '#8B8379',
  teal: '#255C59',
  tealSoft: 'rgba(37,92,89,0.12)',
  amber: '#B66A17',
};

const FONTS = {
  sans: "'Satoshi', 'Geist', system-ui, sans-serif",
  mono: "'Geist Mono', 'SF Mono', monospace",
  serif: "'Instrument Serif', Georgia, serif",
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
    body: 'You set the dollar limits, contact frequency, and escalation triggers. The system enforces them — it cannot override your policies.',
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
  '11:43 UTC  Flagged for approval — invoice exceeds $5,000',
];

function NooterraLogo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="3" stroke={PALETTE.ink} strokeWidth="1.5" />
      <circle cx="9.5" cy="10" r="2" fill={PALETTE.ink} />
      <circle cx="22.5" cy="10" r="2" fill={PALETTE.ink} />
      <circle cx="16" cy="22" r="2" fill={PALETTE.teal} />
      <path d="M9.5 12L16 20M22.5 12L16 20M11.5 10H20.5" stroke={PALETTE.ink} strokeWidth="1.35" />
    </svg>
  );
}

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

function SectionLabel({ children }) {
  return (
    <div
      className="mb-5 text-[11px] uppercase tracking-[0.28em]"
      style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}
    >
      {children}
    </div>
  );
}

function DecisionDossierMockup() {
  const reducedMotion = useReducedMotion();

  // Staggered reveal — each section appears as if the system is analyzing
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
      className="w-full border select-none"
      style={{
        background: PALETTE.panel,
        borderColor: PALETTE.lineStrong,
        boxShadow: '0 22px 50px rgba(23,20,17,0.10)',
        cursor: 'default',
      }}
    >
      {/* Header */}
      <motion.div
        {...reveal(0)}
        className="flex items-center justify-between gap-4 border-b px-4 py-3 text-[11px] uppercase tracking-[0.18em] sm:px-5"
        style={{ borderColor: PALETTE.line, fontFamily: FONTS.mono, color: PALETTE.steelSoft }}
      >
        <span>INV-8842 / Overdue Review</span>
        <span className="inline-flex items-center gap-2" style={{ color: PALETTE.amber }}>
          <span className="h-2 w-2 rounded-full" style={{ background: PALETTE.amber }} />
          Awaiting approval
        </span>
      </motion.div>

      {/* Customer info — first to appear */}
      <motion.div {...reveal(0.15)} className="border-b px-4 py-4 sm:px-5" style={{ borderColor: PALETTE.line }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
              Customer
            </div>
            <div className="text-[1.5rem] font-medium leading-none sm:text-[1.8rem]">Acme Manufacturing</div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm" style={{ color: PALETTE.steel }}>
              <span>$14,200 due</span>
              <span>42 days overdue</span>
              <span>Tier 1 account</span>
            </div>
          </div>
          <div
            className="min-w-[6rem] border px-3 py-2 text-right"
            style={{ borderColor: PALETTE.line, background: PALETTE.paper }}
          >
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
              Queue rank
            </div>
            <div className="mt-1 text-xl font-medium">03 / 48</div>
          </div>
        </div>
      </motion.div>

      {/* Analysis — appears after customer loads */}
      <div className="grid border-b md:grid-cols-[1.25fr_0.95fr]" style={{ borderColor: PALETTE.line }}>
        <motion.div {...reveal(0.4)} className="border-b px-4 py-4 md:border-b-0 md:border-r sm:px-5" style={{ borderColor: PALETTE.line }}>
          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
            Recovery likelihood
          </div>
          <div className="mt-3 flex items-end gap-3">
            <motion.div
              className="text-[2.2rem] leading-none sm:text-[2.6rem]"
              {...(reducedMotion ? {} : {
                initial: { opacity: 0 },
                whileInView: { opacity: 1 },
                transition: { duration: 0.3, delay: 0.6 },
                viewport: { once: true },
              })}
            >
              64%
            </motion.div>
            <div className="pb-1 text-xs uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
              High confidence
            </div>
          </div>
          <motion.div
            className="mt-4"
            {...(reducedMotion ? {} : {
              initial: { scaleX: 0, transformOrigin: 'left' },
              whileInView: { scaleX: 1 },
              transition: { duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] },
              viewport: { once: true },
            })}
          >
            <div className="relative h-2 border" style={{ borderColor: PALETTE.lineStrong, background: PALETTE.paperAlt }}>
              <div
                className="absolute left-[24%] right-[18%] top-0 h-full"
                style={{ background: PALETTE.tealSoft, borderLeft: `1px solid ${PALETTE.teal}`, borderRight: `1px solid ${PALETTE.teal}` }}
              />
              <div
                className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 border"
                style={{ left: '64%', background: PALETTE.teal, borderColor: PALETTE.panel }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
              <span>52%</span>
              <span>71%</span>
            </div>
          </motion.div>
        </motion.div>

        <motion.div {...reveal(0.55)} className="px-4 py-4 sm:px-5">
          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
            Recommended action
          </div>
          <div className="mt-3 border px-3 py-3 text-sm font-medium" style={{ borderColor: PALETTE.lineStrong, background: '#191715', color: PALETTE.panel }}>
            Send formal follow-up email
          </div>
          <div className="mt-4 grid gap-2 text-sm" style={{ color: PALETTE.steel }}>
            <div className="flex items-center justify-between gap-4">
              <span>Alternative considered</span>
              <span style={{ fontFamily: FONTS.mono, color: PALETTE.amber }}>Escalate now</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Expected next outcome</span>
              <span style={{ fontFamily: FONTS.mono, color: PALETTE.teal }}>Response within 3d</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Evidence + Audit — last to appear, the "why" */}
      <div className="grid md:grid-cols-[1.1fr_0.9fr]">
        <motion.div {...reveal(0.75)} className="border-b px-4 py-4 md:border-b-0 md:border-r sm:px-5" style={{ borderColor: PALETTE.line }}>
          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
            Evidence
          </div>
          <div className="mt-3 space-y-2 text-sm leading-relaxed" style={{ color: PALETTE.steel }}>
            {DOSSIER_EVIDENCE.map((item, i) => (
              <motion.div
                key={item}
                className="border-l pl-3"
                style={{ borderColor: PALETTE.teal }}
                {...(reducedMotion ? {} : {
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
          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
            Approval + audit
          </div>
          <div className="mt-3 border px-3 py-3" style={{ borderColor: PALETTE.line, background: PALETTE.paper }}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>Your approval</span>
              <span style={{ color: PALETTE.amber, fontFamily: FONTS.mono }}>Required</span>
            </div>
            <div className="mt-3 text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
              Activity log
            </div>
            <div className="mt-2 space-y-2 text-xs leading-relaxed" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              {DOSSIER_AUDIT.map((item, i) => (
                <motion.div
                  key={item}
                  {...(reducedMotion ? {} : {
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

export default function LandingPage() {
  const reducedMotion = useReducedMotion();

  return (
    <div
      className="min-h-screen"
      style={{
        background: PALETTE.paper,
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
          height: 1px;
          background: ${PALETTE.ink};
          transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .nav-link:hover::after {
          width: 100%;
        }
        .btn-primary {
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(23, 20, 17, 0.2);
        }
        .btn-primary:active {
          transform: translateY(0);
          box-shadow: none;
        }
        .btn-secondary {
          transition: background 0.2s ease, border-color 0.2s ease;
        }
        .btn-secondary:hover {
          background: ${PALETTE.paperAlt};
          border-color: ${PALETTE.ink};
        }
      `}</style>

      {/* ── Nav ── */}
      <nav
        className="sticky top-0 z-50 border-b"
        style={{ borderColor: PALETTE.line, background: 'rgba(244, 240, 232, 0.9)', backdropFilter: 'blur(14px)' }}
      >
        <div className="mx-auto flex max-w-[78rem] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <a href="/" className="inline-flex items-center gap-3 no-underline">
            <NooterraLogo />
            <span className="text-[1.05rem] font-semibold tracking-[-0.04em]" style={{ color: PALETTE.ink }}>
              Nooterra
            </span>
          </a>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#how-it-works" className="nav-link text-[11px] uppercase tracking-[0.2em] no-underline" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              How it works
            </a>
            <a href="#why-nooterra" className="nav-link text-[11px] uppercase tracking-[0.2em] no-underline" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              Why Nooterra
            </a>
            <a href="/docs" className="nav-link text-[11px] uppercase tracking-[0.2em] no-underline" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              Docs
            </a>
          </div>

          <div className="flex items-center gap-3">
            <a href="/login" className="hidden text-[11px] uppercase tracking-[0.2em] no-underline sm:block" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              Sign in
            </a>
            <a
              href="/setup"
              className="btn-primary inline-flex items-center justify-center border px-4 py-2 text-[11px] uppercase tracking-[0.18em] no-underline"
              style={{ borderColor: PALETTE.ink, background: PALETTE.ink, color: PALETTE.panel, fontFamily: FONTS.mono }}
            >
              Request access
            </a>
          </div>
        </div>
      </nav>

      <main>
        {/* ── Section 1: Hero ── */}
        <section className="scroll-mt-24 border-b" style={{ borderColor: PALETTE.lineStrong }}>
          {/* Hero text — centered */}
          <div className="mx-auto max-w-[78rem] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <div className="mx-auto max-w-[52rem] text-center">
              <motion.h1
                {...loadProps(reducedMotion, 0.06)}
                className="mx-auto text-[clamp(3rem,7.5vw,5.8rem)] font-semibold leading-[0.9] tracking-[-0.045em]"
              >
                Stop losing revenue to invoices nobody follows up on
              </motion.h1>

              <motion.p
                {...loadProps(reducedMotion, 0.14)}
                className="mx-auto mt-8 max-w-[36rem] text-[1.15rem] leading-[1.75]"
                style={{ color: PALETTE.steel }}
              >
                Nooterra is an AI collections specialist. It connects to Stripe, reads every payment pattern, and tells you exactly which accounts need attention — with the evidence to back it up.
              </motion.p>

              <motion.div {...loadProps(reducedMotion, 0.26)} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="/setup"
                  className="btn-primary inline-flex items-center justify-center gap-2 border px-7 py-3.5 text-[12px] uppercase tracking-[0.16em] no-underline"
                  style={{ borderColor: PALETTE.ink, background: PALETTE.ink, color: PALETTE.panel, fontFamily: FONTS.mono }}
                >
                  Get started
                  <ArrowRight size={15} />
                </a>
                <a
                  href="#how-it-works"
                  className="btn-secondary inline-flex items-center justify-center border px-7 py-3.5 text-[12px] uppercase tracking-[0.16em] no-underline"
                  style={{ borderColor: PALETTE.lineStrong, color: PALETTE.ink, fontFamily: FONTS.mono }}
                >
                  See how it works
                </a>
              </motion.div>
            </div>
          </div>

          {/* Product showcase — centered below hero text */}
          <div className="border-t" style={{ borderColor: PALETTE.lineStrong }}>
            <div
              className="mx-auto max-w-[78rem] px-4 py-10 sm:px-6 lg:px-8 lg:py-14"
              style={{ background: 'linear-gradient(180deg, rgba(250,247,241,0.96), rgba(236,228,215,0.92))' }}
            >
              <motion.div {...loadProps(reducedMotion, 0.1)} className="mb-5 flex items-center justify-center gap-6 border-b pb-4" style={{ borderColor: PALETTE.line, color: PALETTE.steelSoft }}>
                <span className="text-[11px] uppercase tracking-[0.22em]" style={{ fontFamily: FONTS.mono }}>
                  What a collections review looks like
                </span>
              </motion.div>
              <div className="mx-auto max-w-[54rem]">
                <DecisionDossierMockup />
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-[78rem] border-t" style={{ borderColor: PALETTE.lineStrong }}>
            <div className="grid md:grid-cols-3">
              {PROOF_POINTS.map((item, index) => (
                <motion.div
                  key={item.label}
                  {...revealProps(reducedMotion, index * 0.05)}
                  className={`border-b px-4 py-5 md:border-b-0 md:px-6 lg:px-8 ${index < PROOF_POINTS.length - 1 ? 'md:border-r' : ''}`}
                  style={{ borderColor: PALETTE.line }}
                >
                  <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
                    {item.label}
                  </div>
                  <div className="mt-2 text-base font-medium sm:text-lg">{item.value}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Section 2: How it works ── */}
        <section id="how-it-works" className="scroll-mt-24 border-b px-4 py-12 sm:px-6 lg:px-8 lg:py-16" style={{ borderColor: PALETTE.lineStrong }}>
          <div className="mx-auto grid max-w-[78rem] gap-10 lg:grid-cols-[0.95fr_1.4fr]">
            <motion.div {...revealProps(reducedMotion, 0.04)}>
              <SectionLabel>How it works</SectionLabel>
              <h2 className="max-w-[22ch] text-[clamp(2rem,4vw,3.4rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                Four steps from Stripe to first recommendation.
              </h2>
              <p className="mt-5 max-w-[34rem] text-base leading-7 sm:text-lg" style={{ color: PALETTE.steel }}>
                No implementation project. No data migration. Nooterra reads directly from Stripe and starts
                working with whatever you already have.
              </p>
            </motion.div>

            <div className="border" style={{ borderColor: PALETTE.lineStrong, background: PALETTE.panel }}>
              <div className="grid md:grid-cols-2 xl:grid-cols-4">
                {HOW_STEPS.map((item, index) => (
                  <motion.div
                    key={item.step}
                    {...revealProps(reducedMotion, index * 0.05)}
                    className={`border-b px-4 py-6 md:px-5 xl:border-b-0 ${index < HOW_STEPS.length - 1 ? 'xl:border-r' : ''}`}
                    style={{ borderColor: PALETTE.line }}
                  >
                    <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: PALETTE.teal, fontFamily: FONTS.mono }}>
                      {item.step}
                    </div>
                    <h3 className="mt-4 text-xl font-medium tracking-[-0.03em]">{item.title}</h3>
                    <p className="mt-4 text-sm leading-7" style={{ color: PALETTE.steel }}>
                      {item.body}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 3: Why not just use Stripe? ── */}
        <section id="why-nooterra" className="scroll-mt-24 border-b px-4 py-12 sm:px-6 lg:px-8 lg:py-16" style={{ borderColor: PALETTE.lineStrong }}>
          <div className="mx-auto max-w-[78rem]">
            <motion.div {...revealProps(reducedMotion, 0.04)} className="mb-10 max-w-[48rem]">
              <SectionLabel>The gap in your collections process</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,3.2rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                Stripe retries the card.{' '}
                <span style={{ color: PALETTE.steel }}>
                  Nobody follows up on the rest.
                </span>
              </h2>
            </motion.div>

            <div className="grid gap-px border md:grid-cols-2" style={{ borderColor: PALETTE.lineStrong, background: PALETTE.lineStrong }}>
              <motion.div {...revealProps(reducedMotion, 0.04)} className="px-5 py-6 sm:px-6" style={{ background: PALETTE.panel }}>
                <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
                  What Stripe handles
                </div>
                <div className="mt-5 space-y-3">
                  {STRIPE_HANDLES.map((item) => (
                    <div key={item} className="flex items-center gap-3 text-sm" style={{ color: PALETTE.steel }}>
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center border text-[10px]" style={{ borderColor: PALETTE.line, fontFamily: FONTS.mono, color: PALETTE.steelSoft }}>
                        OK
                      </span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              <motion.div {...revealProps(reducedMotion, 0.08)} className="px-5 py-6 sm:px-6" style={{ background: PALETTE.paper }}>
                <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: PALETTE.teal, fontFamily: FONTS.mono }}>
                  What Nooterra adds
                </div>
                <div className="mt-5 space-y-3">
                  {NOOTERRA_HANDLES.map((item) => (
                    <div key={item} className="flex items-center gap-3 text-sm" style={{ color: PALETTE.ink }}>
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center border text-[10px]" style={{ borderColor: PALETTE.teal, background: PALETTE.tealSoft, fontFamily: FONTS.mono, color: PALETTE.teal }}>
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

        {/* ── Section 4: Trust signals ── */}
        <section className="border-b px-4 py-12 sm:px-6 lg:px-8 lg:py-16" style={{ borderColor: PALETTE.lineStrong }}>
          <div className="mx-auto max-w-[78rem]">
            <motion.div {...revealProps(reducedMotion, 0.04)} className="mb-10 max-w-[48rem]">
              <SectionLabel>Why this is safe to try</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,3.2rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                You stay in control. Always.
              </h2>
            </motion.div>

            <div className="border" style={{ borderColor: PALETTE.lineStrong, background: PALETTE.panel }}>
              <div className="grid lg:grid-cols-3">
                {TRUST_POINTS.map((item, index) => (
                  <motion.div
                    key={item.title}
                    {...revealProps(reducedMotion, index * 0.04)}
                    className={`border-b px-5 py-6 lg:border-b-0 ${index < TRUST_POINTS.length - 1 ? 'lg:border-r' : ''}`}
                    style={{ borderColor: PALETTE.line }}
                  >
                    <h3 className="text-lg font-medium tracking-[-0.03em]">{item.title}</h3>
                    <p className="mt-4 text-sm leading-7" style={{ color: PALETTE.steel }}>
                      {item.body}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>

{/* Technical deep-dive link removed — doesn't convince a buyer */}
          </div>
        </section>

        {/* ── Section 5: Bottom CTA ── */}
        <section className="px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <motion.div
            {...revealProps(reducedMotion, 0.04)}
            className="mx-auto max-w-[78rem] border p-6 sm:p-8 lg:p-10"
            style={{ borderColor: PALETTE.lineStrong, background: 'linear-gradient(135deg, rgba(250,247,241,0.98), rgba(236,228,215,0.94))' }}
          >
            <div className="grid gap-8 lg:grid-cols-[1.25fr_0.85fr] lg:items-end">
              <div>
                <h2 className="max-w-[18ch] text-[clamp(2rem,4vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                  See it work on your own data.
                </h2>
                <p className="mt-5 max-w-[38rem] text-base leading-7 sm:text-lg" style={{ color: PALETTE.steel }}>
                  Connect Stripe and watch Nooterra analyze your overdue invoices in your first session. No commitment. No credit card.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                <a
                  href="/setup"
                  className="btn-primary inline-flex items-center justify-center gap-2 border px-6 py-3.5 text-[12px] uppercase tracking-[0.16em] no-underline"
                  style={{ borderColor: PALETTE.ink, background: PALETTE.ink, color: PALETTE.panel, fontFamily: FONTS.mono }}
                >
                  Request access
                  <ArrowRight size={15} />
                </a>
                <a
                  href="/docs"
                  className="btn-secondary inline-flex items-center justify-center border px-6 py-3.5 text-[12px] uppercase tracking-[0.16em] no-underline"
                  style={{ borderColor: PALETTE.lineStrong, color: PALETTE.ink, fontFamily: FONTS.mono }}
                >
                  Read the docs
                </a>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="border-t px-4 py-6 sm:px-6 lg:px-8" style={{ borderColor: PALETTE.lineStrong }}>
        <div className="mx-auto flex max-w-[78rem] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-3">
            <NooterraLogo size={18} />
            <span className="text-sm" style={{ color: PALETTE.steel }}>
              Nooterra
            </span>
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] uppercase tracking-[0.18em]" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
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
