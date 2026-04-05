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
  { label: 'Stripe setup', value: '60 seconds' },
  { label: 'Every decision', value: 'Evidence + audit trail' },
  { label: 'Go-live model', value: 'Approval-first' },
];

const HOW_STEPS = [
  {
    step: '01',
    title: 'Connect Stripe',
    body: 'Add your Stripe key. Nooterra backfills customers, invoices, payments, and dispute signals in minutes.',
  },
  {
    step: '02',
    title: 'Set your policies',
    body: 'Set approval thresholds, outreach cadence, and business-hours guardrails. Riley follows them on every recommendation.',
  },
  {
    step: '03',
    title: 'Review flagged decisions',
    body: 'Riley ranks overdue accounts, recommends the next action, and shows the evidence behind it. Your team approves or rejects.',
  },
  {
    step: '04',
    title: 'Watch it sharpen',
    body: 'Payment outcomes feed back in. Coverage expands, confidence improves, and more decisions move out of the review lane over time.',
  },
];

const STRIPE_HANDLES = [
  'Payment retries and standard dunning',
  'Invoice delivery and payment collection',
  'Basic subscription billing',
];

const NOOTERRA_GOVERNS = [
  'Which overdue accounts need a follow-up now',
  'Which invoices should wait vs. escalate',
  'When dispute signals should block outreach',
  'Which actions can move automatically vs. stay in review',
];

const TRUST_POINTS = [
  {
    title: 'Approval-first',
    body: 'Riley recommends first. Your team signs off until trust is earned.',
  },
  {
    title: 'Policy enforced',
    body: 'Approval thresholds, outreach cadence, and dispute blocks are enforced on every action.',
  },
  {
    title: 'Full audit trail',
    body: 'Every recommendation, approval, override, and outcome. Immutable. Exportable. Audit-ready.',
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

  return (
    <motion.aside
      {...loadProps(reducedMotion, 0.12)}
      className="w-full border"
      style={{
        background: PALETTE.panel,
        borderColor: PALETTE.lineStrong,
        boxShadow: '0 22px 50px rgba(23,20,17,0.10)',
      }}
    >
      <div
        className="flex items-center justify-between gap-4 border-b px-4 py-3 text-[11px] uppercase tracking-[0.18em] sm:px-5"
        style={{ borderColor: PALETTE.line, fontFamily: FONTS.mono, color: PALETTE.steelSoft }}
      >
        <span>INV-8842 / Overdue Review</span>
        <span className="inline-flex items-center gap-2" style={{ color: PALETTE.amber }}>
          <span className="h-2 w-2 rounded-full" style={{ background: PALETTE.amber }} />
          Awaiting approval
        </span>
      </div>

      <div className="border-b px-4 py-4 sm:px-5" style={{ borderColor: PALETTE.line }}>
        <motion.div {...loadProps(reducedMotion, 0.24)} className="flex items-start justify-between gap-4">
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
        </motion.div>
      </div>

      <div className="grid border-b md:grid-cols-[1.25fr_0.95fr]" style={{ borderColor: PALETTE.line }}>
        <motion.div {...loadProps(reducedMotion, 0.34)} className="border-b px-4 py-4 md:border-b-0 md:border-r sm:px-5" style={{ borderColor: PALETTE.line }}>
          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
            Recovery likelihood
          </div>
          <div className="mt-3 flex items-end gap-3">
            <div className="text-[2.2rem] leading-none sm:text-[2.6rem]">64%</div>
            <div className="pb-1 text-xs uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
              High confidence
            </div>
          </div>
          <div className="mt-4">
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
          </div>
        </motion.div>

        <motion.div {...loadProps(reducedMotion, 0.42)} className="px-4 py-4 sm:px-5">
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

      <div className="grid md:grid-cols-[1.1fr_0.9fr]">
        <motion.div {...loadProps(reducedMotion, 0.52)} className="border-b px-4 py-4 md:border-b-0 md:border-r sm:px-5" style={{ borderColor: PALETTE.line }}>
          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
            Evidence panel
          </div>
          <div className="mt-3 space-y-2 text-sm leading-relaxed" style={{ color: PALETTE.steel }}>
            {DOSSIER_EVIDENCE.map((item) => (
              <div key={item} className="border-l pl-3" style={{ borderColor: PALETTE.teal }}>
                {item}
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div {...loadProps(reducedMotion, 0.62)} className="px-4 py-4 sm:px-5">
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
              {DOSSIER_AUDIT.map((item) => (
                <div key={item}>{item}</div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.aside>
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
          html {
            scroll-behavior: smooth;
          }
        }
      `}</style>

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          backgroundImage: `linear-gradient(to right, ${PALETTE.line} 1px, transparent 1px), linear-gradient(to bottom, ${PALETTE.line} 1px, transparent 1px)`,
          backgroundSize: 'min(11vw, 120px) 100%, 100% 158px',
          maskImage: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent 92%)',
          WebkitMaskImage: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent 92%)',
        }}
      />

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
            <a href="#how-it-works" className="text-[11px] uppercase tracking-[0.2em] no-underline" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              How it works
            </a>
            <a href="#why-nooterra" className="text-[11px] uppercase tracking-[0.2em] no-underline" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              Why Nooterra
            </a>
            <a href="/docs" className="text-[11px] uppercase tracking-[0.2em] no-underline" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              Docs
            </a>
          </div>

          <div className="flex items-center gap-3">
            <a href="/login" className="hidden text-[11px] uppercase tracking-[0.2em] no-underline sm:block" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              Sign in
            </a>
            <a
              href="/setup"
              className="inline-flex items-center justify-center border px-4 py-2 text-[11px] uppercase tracking-[0.18em] no-underline transition-colors"
              style={{ borderColor: PALETTE.lineStrong, background: PALETTE.ink, color: PALETTE.panel, fontFamily: FONTS.mono }}
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
              <motion.div {...loadProps(reducedMotion, 0.04)} className="inline-flex items-center gap-3 border px-3 py-2 text-[11px] uppercase tracking-[0.18em]" style={{ borderColor: PALETTE.lineStrong, background: PALETTE.panel, color: PALETTE.teal, fontFamily: FONTS.mono }}>
                <span className="h-2 w-2 rounded-full" style={{ background: PALETTE.teal }} />
                Now in early access
              </motion.div>

              <motion.h1
                {...loadProps(reducedMotion, 0.1)}
                className="mx-auto mt-8 max-w-[18ch] text-[clamp(2.6rem,6vw,4.8rem)] font-medium leading-[0.95] tracking-[-0.04em]"
              >
                Your overdue invoices deserve a specialist
              </motion.h1>

              <motion.p
                {...loadProps(reducedMotion, 0.18)}
                className="mx-auto mt-7 max-w-[36rem] text-lg leading-8"
                style={{ color: PALETTE.steel }}
              >
                Nooterra is an AI collections employee. It connects to Stripe, reads your payment history, and follows up on overdue accounts with evidence-backed recommendations and policy guardrails.
              </motion.p>

              <motion.div {...loadProps(reducedMotion, 0.26)} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="/setup"
                  className="inline-flex items-center justify-center gap-2 border px-6 py-3 text-[11px] uppercase tracking-[0.18em] no-underline"
                  style={{ borderColor: PALETTE.lineStrong, background: PALETTE.ink, color: PALETTE.panel, fontFamily: FONTS.mono }}
                >
                  Get started
                  <ArrowRight size={14} />
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center border px-6 py-3 text-[11px] uppercase tracking-[0.18em] no-underline"
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
              <h2 className="max-w-[14ch] text-[clamp(2rem,4vw,3.4rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                Connect Stripe. Set policies. See every decision.
              </h2>
              <p className="mt-5 max-w-[34rem] text-base leading-7 sm:text-lg" style={{ color: PALETTE.steel }}>
                Nooterra builds a working view of your receivables from Stripe. Overdue invoices are ranked,
                routed through policy, and surfaced with the evidence your team needs to approve or reject
                the next step.
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
              <SectionLabel>Stripe handles billing. You still need collections judgment.</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,3.2rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                Stripe automates retries.{' '}
                <span style={{ color: PALETTE.steel }}>
                  Nooterra decides what happens next.
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
                  What Nooterra governs
                </div>
                <div className="mt-5 space-y-3">
                  {NOOTERRA_GOVERNS.map((item) => (
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
              <SectionLabel>Built for finance teams who cannot afford mistakes</SectionLabel>
              <h2 className="text-[clamp(2rem,4vw,3.2rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                Go live only after the system earns trust.
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

            <motion.p
              {...revealProps(reducedMotion, 0.12)}
              className="mt-6 text-sm leading-7"
              style={{ color: PALETTE.steelSoft }}
            >
              Under the hood: event ledger, policy engine, and closed-loop learning from real payment
              outcomes.{' '}
              <a href="/docs" className="underline" style={{ color: PALETTE.teal }}>
                Read the technical deep dive
              </a>
            </motion.p>
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
                <SectionLabel>Early access</SectionLabel>
                <h2 className="max-w-[16ch] text-[clamp(2rem,4vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                  We're onboarding design partners now.
                </h2>
                <p className="mt-5 max-w-[38rem] text-base leading-7 sm:text-lg" style={{ color: PALETTE.steel }}>
                  Connect Stripe, set your approval rules, and see Riley triage overdue revenue in your
                  first session.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                <a
                  href="/setup"
                  className="inline-flex items-center justify-center gap-2 border px-5 py-3 text-[11px] uppercase tracking-[0.18em] no-underline"
                  style={{ borderColor: PALETTE.lineStrong, background: PALETTE.ink, color: PALETTE.panel, fontFamily: FONTS.mono }}
                >
                  Request access
                  <ArrowRight size={14} />
                </a>
                <a
                  href="/docs"
                  className="inline-flex items-center justify-center border px-5 py-3 text-[11px] uppercase tracking-[0.18em] no-underline"
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
