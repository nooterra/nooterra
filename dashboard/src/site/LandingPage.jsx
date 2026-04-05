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

const NOOTERRA_ADDS = [
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

  const dossierReveal = (delay) => {
    if (reducedMotion) return {};
    return {
      initial: { opacity: 0, y: 8 },
      whileInView: { opacity: 1, y: 0 },
      transition: { duration: 0.35, delay, ease: EASE },
      viewport: { once: true, margin: '-32px' },
    };
  };

  return (
    <aside
      className="w-full max-w-[30rem] select-none cursor-default"
      style={{
        transform: 'perspective(1200px) rotateY(-3deg) rotateX(1.5deg)',
      }}
    >
      <div
        className="border"
        style={{
          background: PALETTE.panel,
          borderColor: PALETTE.lineStrong,
          boxShadow: '0 24px 60px rgba(23,20,17,0.12), 0 8px 20px rgba(23,20,17,0.06)',
        }}
      >
        {/* Header */}
        <motion.div
          {...dossierReveal(0)}
          className="flex items-center justify-between gap-4 border-b px-4 py-3 text-[11px] uppercase tracking-[0.18em] sm:px-5"
          style={{ borderColor: PALETTE.line, fontFamily: FONTS.mono, color: PALETTE.steelSoft }}
        >
          <span>INV-8842 / Overdue Review</span>
          <span className="inline-flex items-center gap-2" style={{ color: PALETTE.amber }}>
            <span className="h-2 w-2 rounded-full" style={{ background: PALETTE.amber }} />
            Awaiting approval
          </span>
        </motion.div>

        {/* Customer info */}
        <motion.div {...dossierReveal(0.15)} className="border-b px-4 py-4 sm:px-5" style={{ borderColor: PALETTE.line }}>
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

        {/* Probability + action */}
        <div className="grid border-b md:grid-cols-[1.25fr_0.95fr]" style={{ borderColor: PALETTE.line }}>
          <motion.div {...dossierReveal(0.4)} className="border-b px-4 py-4 md:border-b-0 md:border-r sm:px-5" style={{ borderColor: PALETTE.line }}>
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
                <motion.div
                  initial={reducedMotion ? false : { scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
                  viewport={{ once: true }}
                  className="absolute left-[24%] right-[18%] top-0 h-full origin-left"
                  style={{ background: PALETTE.tealSoft, borderLeft: `1px solid ${PALETTE.teal}`, borderRight: `1px solid ${PALETTE.teal}` }}
                />
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.9, ease: EASE }}
                  viewport={{ once: true }}
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

          <motion.div {...dossierReveal(0.55)} className="px-4 py-4 sm:px-5">
            <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
              Recommended action
            </div>
            <div className="mt-3 border px-3 py-3 text-sm font-medium" style={{ borderColor: PALETTE.lineStrong, background: '#191715', color: PALETTE.panel }}>
              Send formal follow-up email
            </div>
            <div className="mt-4 grid gap-2 text-sm" style={{ color: PALETTE.steel }}>
              <div className="flex items-center justify-between gap-4">
                <span>Alternative considered</span>
                <span style={{ fontFamily: FONTS.mono, color: PALETTE.amber }}>Hold</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Expected next outcome</span>
                <span style={{ fontFamily: FONTS.mono, color: PALETTE.teal }}>Payment within 10d</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Evidence + approval */}
        <div className="grid md:grid-cols-[1.1fr_0.9fr]">
          <motion.div {...dossierReveal(0.75)} className="border-b px-4 py-4 md:border-b-0 md:border-r sm:px-5" style={{ borderColor: PALETTE.line }}>
            <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
              Evidence panel
            </div>
            <div className="mt-3 space-y-2 text-sm leading-relaxed" style={{ color: PALETTE.steel }}>
              {DOSSIER_EVIDENCE.map((item, i) => (
                <motion.div
                  key={item}
                  initial={reducedMotion ? false : { opacity: 0, x: -6 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: 0.8 + i * 0.1, ease: EASE }}
                  viewport={{ once: true }}
                  className="border-l pl-3"
                  style={{ borderColor: PALETTE.teal }}
                >
                  {item}
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div {...dossierReveal(0.9)} className="px-4 py-4 sm:px-5">
            <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: PALETTE.steelSoft, fontFamily: FONTS.mono }}>
              Approval
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

        .nav-link { position: relative; padding-bottom: 2px; }
        .nav-link::after {
          content: ''; position: absolute; left: 0; bottom: -2px;
          width: 0; height: 1px; background: currentColor;
          transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .nav-link:hover::after { width: 100%; }

        .btn-primary { transition: opacity 0.15s ease, transform 0.15s ease; }
        .btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .btn-primary:active { opacity: 1; transform: translateY(0); }

        .btn-ghost { transition: background 0.15s ease; }
        .btn-ghost:hover { background: rgba(23,20,17,0.04); }
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
            <a href="/login" className="nav-link hidden text-[11px] uppercase tracking-[0.2em] no-underline sm:block" style={{ color: PALETTE.steel, fontFamily: FONTS.mono }}>
              Sign in
            </a>
            <a
              href="/setup"
              className="btn-primary inline-flex items-center justify-center border px-4 py-2 text-[14px] tracking-[-0.01em] no-underline"
              style={{ borderColor: PALETTE.lineStrong, background: PALETTE.ink, color: PALETTE.panel, fontFamily: FONTS.sans, fontWeight: 500 }}
            >
              Get started
            </a>
          </div>
        </div>
      </nav>

      <main>
        {/* ── Section 1: Hero ── */}
        <section className="scroll-mt-24">
          <div className="grid lg:grid-cols-[1.1fr_1fr]">
            {/* Left: copy — dark panel for contrast */}
            <div
              className="flex flex-col justify-center px-6 py-16 sm:px-10 lg:px-14 lg:py-24"
              style={{ background: PALETTE.ink, color: '#F4F0E8' }}
            >
              <motion.h1
                {...loadProps(reducedMotion, 0.06)}
                className="text-[clamp(2.8rem,6vw,4.6rem)] leading-[1] tracking-[-0.035em]"
                style={{ fontWeight: 700 }}
              >
                Stop chasing
                <br />
                overdue invoices.
              </motion.h1>

              <motion.p
                {...loadProps(reducedMotion, 0.14)}
                className="mt-6 max-w-[28rem] text-[1.05rem] leading-[1.7]"
                style={{ color: 'rgba(244,240,232,0.65)' }}
              >
                Nooterra connects to Stripe, reads your payment history, and follows up on every overdue account — with evidence and your approval.
              </motion.p>

              <motion.div {...loadProps(reducedMotion, 0.22)} className="mt-10 flex items-center gap-5">
                <a
                  href="/setup"
                  className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-3.5 text-[15px] tracking-[-0.01em] no-underline"
                  style={{ background: PALETTE.paper, color: PALETTE.ink, fontFamily: FONTS.sans, fontWeight: 600, borderRadius: '4px' }}
                >
                  Get started
                  <ArrowRight size={16} />
                </a>
                <a
                  href="#how-it-works"
                  className="nav-link text-[14px] no-underline"
                  style={{ color: 'rgba(244,240,232,0.5)', fontWeight: 500 }}
                >
                  Explore product &rarr;
                </a>
              </motion.div>
            </div>

            {/* Right: dossier */}
            <div
              className="flex items-center justify-center overflow-hidden px-6 py-10 sm:px-8 lg:px-10 lg:py-16"
              style={{ background: PALETTE.paperAlt }}
            >
              <DecisionDossierMockup />
            </div>
          </div>

          {/* Proof points */}
          <div className="mx-auto max-w-[78rem] border-t border-b" style={{ borderColor: PALETTE.lineStrong }}>
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
              <h2 className="max-w-[18ch] text-[clamp(2rem,4vw,3.4rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                Four steps from Stripe to first recommendation.
              </h2>
              <p className="mt-5 max-w-[34rem] text-base leading-7 sm:text-lg" style={{ color: PALETTE.steel }}>
                No implementation project. No data migration. Nooterra reads directly from Stripe and starts working with whatever you already have.
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
              <SectionLabel>Stripe handles recovery. You still need judgment.</SectionLabel>
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
                  {NOOTERRA_ADDS.map((item) => (
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
                <SectionLabel>Get started</SectionLabel>
                <h2 className="max-w-[20ch] text-[clamp(2rem,4vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                  See it work on your own data.
                </h2>
                <p className="mt-5 max-w-[38rem] text-base leading-7 sm:text-lg" style={{ color: PALETTE.steel }}>
                  Connect Stripe and watch Nooterra analyze your overdue invoices in your first session. No commitment. No credit card.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                <a
                  href="/setup"
                  className="btn-primary inline-flex items-center justify-center gap-2 border px-5 py-3 text-[14px] tracking-[-0.01em] no-underline"
                  style={{ borderColor: PALETTE.lineStrong, background: PALETTE.ink, color: PALETTE.panel, fontFamily: FONTS.sans, fontWeight: 500 }}
                >
                  Get started
                  <ArrowRight size={15} />
                </a>
                <a
                  href="/docs"
                  className="btn-ghost inline-flex items-center justify-center border px-5 py-3 text-[14px] tracking-[-0.01em] no-underline"
                  style={{ borderColor: PALETTE.lineStrong, color: PALETTE.ink, fontFamily: FONTS.sans, fontWeight: 500 }}
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
            <a href="/docs" className="nav-link no-underline" style={{ color: 'inherit' }}>Docs</a>
            <a href="/privacy" className="nav-link no-underline" style={{ color: 'inherit' }}>Privacy</a>
            <a href="/terms" className="nav-link no-underline" style={{ color: 'inherit' }}>Terms</a>
            <a href="https://github.com/nooterra/nooterra" className="nav-link no-underline" style={{ color: 'inherit' }}>GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
