import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Zap, Shield, Activity } from 'lucide-react';

/* ── Design tokens ── */
const PALETTE = {
  bg: '#ffffff',
  surface: '#f8f9ff',
  surfaceLow: '#eff4ff',
  surfaceHigh: '#edf2f7',
  ink: '#0d1c2e',
  body: '#515f74',
  muted: '#94a3b8',
  accent: '#DDF047',
  accentDark: '#5a6400',
  border: '#e2e8f0',
  dark: '#0d1c2e',
  darkSurface: 'rgba(255,255,255,0.05)',
};

const FONTS = {
  sans: "'Inter', system-ui, sans-serif",
  mono: "'Geist Mono', 'SF Mono', monospace",
};

const EASE = [0.16, 1, 0.3, 1];

/* ── Content data ── */
const CAPABILITIES = [
  {
    ref: 'REF // 01A',
    title: 'Instant\nIntegration',
    body: 'Connect Stripe in 60 seconds. Nooterra reads your customers, invoices, payments, and disputes. Full picture in minutes.',
    Icon: Zap,
  },
  {
    ref: 'REF // 02B',
    title: 'Immutable\nProof',
    body: 'Every action comes with an evidence trail. No outreach is sent without your explicit approval and a full audit log.',
    Icon: Shield,
  },
  {
    ref: 'REF // 03C',
    title: 'Autonomous\nScale',
    body: 'Nooterra learns your institutional tone. Once trust is earned, the system scales recovery at machine speed.',
    Icon: Activity,
  },
];

const HOW_STEPS = [
  {
    step: 'ST-01',
    title: 'Connect Stripe',
    body: 'One API key. Nooterra reads your customers, invoices, payments, and disputes. Full picture in minutes.',
  },
  {
    step: 'ST-02',
    title: 'Set the Rules',
    body: 'Dollar thresholds, contact limits, business hours. You define the boundaries. The system enforces them on every action.',
  },
  {
    step: 'ST-03',
    title: 'Review with Evidence',
    body: 'Each recommendation comes with the payment history, dispute status, and reasoning behind it. Approve or reject in one click.',
  },
  {
    step: 'ST-04',
    title: 'Earn Autonomy',
    body: 'As outcomes improve, more actions move out of the review lane. You stay in control of what that threshold is.',
  },
];

const COMPARISON_POINTS = [
  {
    title: 'Beyond Standard Automation',
    body: 'Stripe sends generic reminders. Nooterra reads the full payment history before deciding what to do — different follow-ups for different customers based on their pattern.',
  },
  {
    title: 'Dispute Awareness Protocol',
    body: 'Active disputes trigger an immediate outreach freeze. Nooterra holds all contact when there\'s an active dispute, preventing reputational friction while escalating high-risk signals.',
  },
];

const COMPARISON_TABLE = [
  { vector: 'Reminders', legacy: 'Static', nooterra: 'Context-Aware' },
  { vector: 'History', legacy: 'Surface', nooterra: 'Full Deep-Context' },
  { vector: 'Dispute Hold', legacy: 'Manual', nooterra: 'Real-Time' },
  { vector: 'Autonomy', legacy: 'Zero', nooterra: 'Earned Trust' },
];

const TRUST_POINTS = [
  {
    title: 'Nothing Happens Without You',
    body: 'Every follow-up is proposed, not sent. You approve each action until the system earns enough track record to act on its own.',
  },
  {
    title: 'Your Rules, Not Ours',
    body: 'You set the dollar limits, contact frequency, and escalation triggers. The system enforces them — it cannot override your policies.',
  },
  {
    title: 'Every Decision is Recorded',
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

/* ── Animation helpers ── */
function revealProps(reducedMotion, delay = 0) {
  if (reducedMotion) return {};
  return {
    initial: { opacity: 0, y: 14 },
    whileInView: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: EASE },
    viewport: { once: true, margin: '-60px' },
  };
}

function loadProps(reducedMotion, delay = 0) {
  if (reducedMotion) return {};
  return {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: EASE },
  };
}

/* ── Micro-label ── */
function MicroLabel({ children, style: extraStyle }) {
  return (
    <div
      style={{
        fontFamily: FONTS.mono,
        fontSize: 10,
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        color: PALETTE.muted,
        ...extraStyle,
      }}
    >
      {children}
    </div>
  );
}

/* ── Decision Dossier mockup (hero right) ── */
function DecisionDossierMockup({ reducedMotion }) {
  const dossierReveal = (delay) => {
    if (reducedMotion) return {};
    return {
      initial: { opacity: 0, y: 8 },
      whileInView: { opacity: 1, y: 0 },
      transition: { duration: 0.35, delay, ease: EASE },
      viewport: { once: true, margin: '-32px' },
    };
  };

  const cellStyle = {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
  };

  return (
    <div
      style={{
        background: PALETTE.dark,
        borderLeft: `4px solid ${PALETTE.accent}`,
        boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Corner marker */}
      <div style={{ position: 'absolute', top: 16, right: 16, ...cellStyle, color: 'rgba(255,255,255,0.15)' }}>
        LIVE_DOSSIER_FEED
      </div>

      {/* Header */}
      <motion.div
        {...dossierReveal(0)}
        style={{
          padding: '20px 28px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ ...cellStyle }}>INV-8842 / Overdue Review</span>
        <span style={{ ...cellStyle, color: PALETTE.accent, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, background: PALETTE.accent, display: 'inline-block' }} />
          Awaiting Approval
        </span>
      </motion.div>

      {/* Customer + amount */}
      <motion.div {...dossierReveal(0.15)} style={{ padding: '24px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ ...cellStyle, marginBottom: 8 }}>Customer</div>
        <div style={{ fontSize: 28, fontWeight: 900, color: '#ffffff', letterSpacing: '-0.03em', fontFamily: FONTS.sans }}>
          Acme Manufacturing
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 20, ...cellStyle, fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
          <span>$14,200 due</span>
          <span>42 days overdue</span>
          <span>Tier 1</span>
        </div>
      </motion.div>

      {/* Recovery + Action */}
      <div className="noo-dossier-2col" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <motion.div {...dossierReveal(0.4)} style={{ padding: '24px 28px', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ ...cellStyle, marginBottom: 12 }}>Recovery likelihood</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <span style={{ fontSize: 40, fontWeight: 900, color: '#ffffff', lineHeight: 1, fontFamily: FONTS.sans, letterSpacing: '-0.04em' }}>64%</span>
            <span style={{ ...cellStyle, paddingBottom: 4 }}>High confidence</span>
          </div>
          {/* Mini bar chart */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40, marginTop: 20 }}>
            {[30, 45, 65, 100, 80, 50].map((h, i) => (
              <motion.div
                key={i}
                initial={reducedMotion ? false : { scaleY: 0 }}
                whileInView={{ scaleY: 1 }}
                transition={{ duration: 0.4, delay: 0.5 + i * 0.06, ease: EASE }}
                viewport={{ once: true }}
                style={{
                  flex: 1,
                  height: `${h}%`,
                  background: i === 3 ? PALETTE.accent : `rgba(255,255,255,${0.05 + i * 0.06})`,
                  transformOrigin: 'bottom',
                }}
              />
            ))}
          </div>
        </motion.div>

        <motion.div {...dossierReveal(0.55)} style={{ padding: '24px 28px' }}>
          <div style={{ ...cellStyle, marginBottom: 12 }}>Recommended action</div>
          <div style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '12px 14px',
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: FONTS.sans,
          }}>
            Send formal follow-up email
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
              <span>Alternative</span>
              <span style={{ fontFamily: FONTS.mono, color: PALETTE.accent }}>Hold</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
              <span>Expected outcome</span>
              <span style={{ fontFamily: FONTS.mono, color: PALETTE.accent }}>Payment in 10d</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Evidence + Audit */}
      <div className="noo-dossier-2col" style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr' }}>
        <motion.div {...dossierReveal(0.75)} style={{ padding: '24px 28px', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ ...cellStyle, marginBottom: 12 }}>Evidence panel</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DOSSIER_EVIDENCE.map((item, i) => (
              <motion.div
                key={item}
                initial={reducedMotion ? false : { opacity: 0, x: -6 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: 0.8 + i * 0.1, ease: EASE }}
                viewport={{ once: true }}
                style={{
                  paddingLeft: 12,
                  borderLeft: `2px solid ${PALETTE.accent}`,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'rgba(255,255,255,0.55)',
                }}
              >
                {item}
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div {...dossierReveal(0.9)} style={{ padding: '24px 28px' }}>
          <div style={{ ...cellStyle, marginBottom: 12 }}>Activity log</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {DOSSIER_AUDIT.map((item) => (
              <div key={item} style={{ fontFamily: FONTS.mono, fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>
                {item}
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            border: `1px solid rgba(255,255,255,0.1)`,
            background: 'rgba(255,255,255,0.03)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
            color: 'rgba(255,255,255,0.5)',
          }}>
            <span>Your approval</span>
            <span style={{ fontFamily: FONTS.mono, color: PALETTE.accent, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Required</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ── Main component ── */
export default function LandingPage() {
  const reducedMotion = useReducedMotion();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: PALETTE.bg,
        color: PALETTE.ink,
        fontFamily: FONTS.sans,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          html { scroll-behavior: smooth; }
        }

        .noo-nav-link { position: relative; padding-bottom: 2px; text-decoration: none; }
        .noo-nav-link::after {
          content: ''; position: absolute; left: 0; bottom: -2px;
          width: 0; height: 1px; background: currentColor;
          transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .noo-nav-link:hover::after { width: 100%; }

        .noo-btn-primary { transition: transform 0.15s ease, box-shadow 0.15s ease; text-decoration: none; }
        .noo-btn-primary:hover { transform: scale(1.03); box-shadow: 0 8px 30px rgba(221,240,71,0.25); }
        .noo-btn-primary:active { transform: scale(1); }

        .noo-btn-outline { transition: background 0.15s ease, border-color 0.15s ease; text-decoration: none; }
        .noo-btn-outline:hover { background: ${PALETTE.surface}; }

        .noo-step-card { transition: border-color 0.25s ease; }
        .noo-step-card:hover { border-color: ${PALETTE.accent} !important; }
        .noo-step-card .noo-active-tag { opacity: 0; transition: opacity 0.25s ease; }
        .noo-step-card:hover .noo-active-tag { opacity: 1; }

        .noo-grid-bg {
          background-image: linear-gradient(to right, ${PALETTE.border} 1px, transparent 1px),
                            linear-gradient(to bottom, ${PALETTE.border} 1px, transparent 1px);
          background-size: 80px 80px;
        }

        ::selection { background: rgba(221,240,71,0.25); color: ${PALETTE.ink}; }

        /* Responsive overrides */
        @media (max-width: 1024px) {
          .noo-hero-flex { flex-direction: column !important; }
          .noo-hero-flex > div { flex: 1 1 auto !important; }
          .noo-cap-grid { grid-template-columns: 1fr !important; }
          .noo-step-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .noo-compare-grid { grid-template-columns: 1fr !important; }
          .noo-trust-grid { grid-template-columns: 1fr !important; }
          .noo-cta-inner { flex-direction: column !important; }
          .noo-footer-top { flex-direction: column !important; gap: 48px !important; }
          .noo-footer-links { grid-template-columns: repeat(2, 1fr) !important; gap: 32px !important; }
          .noo-flow-header { flex-direction: column !important; align-items: flex-start !important; }
          .noo-dossier-2col { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .noo-step-grid { grid-template-columns: 1fr !important; }
          .noo-nav-center { display: none !important; }
          .noo-nav-signin { display: none !important; }
          .noo-section-pad { padding-left: 20px !important; padding-right: 20px !important; }
          .noo-nav-inner { padding-left: 20px !important; padding-right: 20px !important; }
        }
      `}</style>

      {/* ── Nav ── */}
      <nav
        style={{
          position: 'fixed',
          top: 0,
          width: '100%',
          zIndex: 50,
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <div className="noo-nav-inner" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 48px',
          maxWidth: 1440,
          margin: '0 auto',
        }}>
          {/* Left: logo + version */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <a
              href="/"
              style={{
                fontFamily: FONTS.sans,
                fontSize: 22,
                fontWeight: 900,
                letterSpacing: '-0.04em',
                color: PALETTE.ink,
                textDecoration: 'none',
              }}
            >
              NOOTERRA
            </a>
            <div style={{ width: 1, height: 16, background: PALETTE.border }} />
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.2em', color: PALETTE.body }}>
              V1.0 // AR
            </span>
          </div>

          {/* Center: nav links */}
          <div className="noo-nav-center" style={{ display: 'flex', gap: 48, alignItems: 'center' }}>
            {[
              ['#how-it-works', 'How it works'],
              ['#why-nooterra', 'Why Nooterra'],
              ['/docs', 'Docs'],
            ].map(([href, label]) => (
              <a
                key={label}
                href={href}
                className="noo-nav-link"
                style={{
                  fontFamily: FONTS.sans,
                  fontWeight: 600,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.2em',
                  color: PALETTE.body,
                }}
              >
                {label}
              </a>
            ))}
          </div>

          {/* Right: sign in + CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <a
              href="/login"
              className="noo-nav-link noo-nav-signin"
              style={{
                fontFamily: FONTS.sans,
                fontWeight: 600,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
                color: PALETTE.body,
              }}
            >
              Sign in
            </a>
            <a
              href="/setup"
              className="noo-btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '14px 32px',
                background: PALETTE.ink,
                color: '#ffffff',
                fontFamily: FONTS.sans,
                fontWeight: 900,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
                border: 'none',
              }}
            >
              Get Started
            </a>
          </div>
        </div>
      </nav>

      <main>
        {/* ── Hero ── */}
        <section
          className="noo-grid-bg noo-section-pad"
          style={{
            position: 'relative',
            paddingTop: 200,
            paddingBottom: 140,
            paddingLeft: 48,
            paddingRight: 48,
            overflow: 'hidden',
            borderBottom: `1px solid ${PALETTE.border}`,
          }}
        >
          {/* Corner markers */}
          <MicroLabel style={{ position: 'absolute', top: 16, left: 16 }}>COORD // 0.0.1</MicroLabel>
          <MicroLabel style={{ position: 'absolute', bottom: 16, right: 16 }}>RECOVERY_ENGINE_INIT</MicroLabel>

          <div style={{ maxWidth: 1440, margin: '0 auto', position: 'relative', zIndex: 10 }}>
            <div className="noo-hero-flex" style={{ display: 'flex', gap: 80, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Left: 3/5 */}
              <div style={{ flex: '3 1 500px', minWidth: 0 }}>
                {/* Accent label */}
                <motion.div
                  {...loadProps(reducedMotion, 0)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 48 }}
                >
                  <div style={{ width: 48, height: 1, background: PALETTE.accent }} />
                  <span style={{
                    fontFamily: FONTS.sans,
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: '0.4em',
                    textTransform: 'uppercase',
                    color: PALETTE.accentDark,
                  }}>
                    AI Collections Specialist
                  </span>
                </motion.div>

                {/* Headline */}
                <motion.h1
                  {...loadProps(reducedMotion, 0.08)}
                  style={{
                    fontFamily: FONTS.sans,
                    fontSize: 'clamp(56px, 10vw, 140px)',
                    fontWeight: 900,
                    letterSpacing: '-0.06em',
                    lineHeight: 0.85,
                    color: PALETTE.ink,
                    marginBottom: 64,
                    margin: 0,
                  }}
                >
                  Debt is a{' '}
                  <br />
                  <span style={{ color: PALETTE.accentDark }}>data problem.</span>
                </motion.h1>

                {/* Subline */}
                <motion.p
                  {...loadProps(reducedMotion, 0.16)}
                  style={{
                    marginTop: 48,
                    fontSize: 22,
                    fontWeight: 300,
                    lineHeight: 1.6,
                    color: PALETTE.body,
                    maxWidth: 640,
                  }}
                >
                  Nooterra transforms chaotic overdue invoices into a high-yield recovery engine. No emails. No collection calls.{' '}
                  <span style={{ fontWeight: 700, color: PALETTE.ink }}>Just mathematical precision.</span>
                </motion.p>

                {/* CTAs */}
                <motion.div {...loadProps(reducedMotion, 0.24)} style={{ marginTop: 56, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                  <a
                    href="/setup"
                    className="noo-btn-primary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '22px 48px',
                      background: PALETTE.accent,
                      color: PALETTE.ink,
                      fontFamily: FONTS.sans,
                      fontWeight: 900,
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: '0.3em',
                      boxShadow: '0 12px 40px rgba(221,240,71,0.3)',
                    }}
                  >
                    Get Started
                    <ArrowRight size={16} />
                  </a>
                  <a
                    href="#how-it-works"
                    className="noo-btn-outline"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '22px 48px',
                      border: `1px solid rgba(13,28,46,0.1)`,
                      color: PALETTE.ink,
                      fontFamily: FONTS.sans,
                      fontWeight: 900,
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: '0.3em',
                    }}
                  >
                    How It Works
                  </a>
                </motion.div>
              </div>

              {/* Right: 2/5 — Decision dossier */}
              <motion.div
                {...loadProps(reducedMotion, 0.3)}
                style={{ flex: '2 1 400px', minWidth: 0 }}
              >
                <DecisionDossierMockup reducedMotion={reducedMotion} />
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── Core Capabilities (3-column grid) ── */}
        <section className="noo-section-pad" style={{ padding: '160px 48px', borderBottom: `1px solid ${PALETTE.border}` }}>
          <div style={{ maxWidth: 1440, margin: '0 auto' }}>
            <div className="noo-cap-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 1,
              background: PALETTE.border,
              border: `1px solid ${PALETTE.border}`,
            }}>
              {CAPABILITIES.map((item, index) => (
                <motion.div
                  key={item.ref}
                  {...revealProps(reducedMotion, index * 0.08)}
                  style={{
                    background: PALETTE.bg,
                    padding: 72,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: 480,
                  }}
                >
                  <MicroLabel>{item.ref}</MicroLabel>
                  <div>
                    <h3 style={{
                      fontFamily: FONTS.sans,
                      fontSize: 36,
                      fontWeight: 900,
                      letterSpacing: '-0.03em',
                      lineHeight: 1,
                      textTransform: 'uppercase',
                      marginBottom: 28,
                      whiteSpace: 'pre-line',
                    }}>
                      {item.title}
                    </h3>
                    <p style={{ fontSize: 17, fontWeight: 300, lineHeight: 1.7, color: PALETTE.body }}>
                      {item.body}
                    </p>
                  </div>
                  <div style={{ marginTop: 40, color: PALETTE.accentDark }}>
                    <item.Icon size={36} />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Operational Flow (4-step with hover) ── */}
        <section id="how-it-works" className="noo-section-pad" style={{ padding: '160px 48px', maxWidth: 1440, margin: '0 auto', scrollMarginTop: 100 }}>
          {/* Section header */}
          <div className="noo-flow-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 48, marginBottom: 100 }}>
            <motion.h2
              {...revealProps(reducedMotion, 0)}
              style={{
                fontFamily: FONTS.sans,
                fontSize: 'clamp(40px, 5vw, 72px)',
                fontWeight: 900,
                letterSpacing: '-0.04em',
                lineHeight: 0.9,
                textTransform: 'uppercase',
                maxWidth: 600,
              }}
            >
              Four Steps to First Recommendation.
            </motion.h2>
            <motion.div {...revealProps(reducedMotion, 0.1)} style={{ maxWidth: 360 }}>
              <p style={{
                fontSize: 18,
                fontWeight: 300,
                lineHeight: 1.7,
                color: PALETTE.body,
                paddingLeft: 28,
                borderLeft: `2px solid ${PALETTE.accent}`,
              }}>
                No implementation project. No data migration. Nooterra reads directly from Stripe and starts working with whatever you already have.
              </p>
            </motion.div>
          </div>

          {/* Steps grid */}
          <div className="noo-step-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 40 }}>
            {HOW_STEPS.map((item, index) => (
              <motion.div
                key={item.step}
                {...revealProps(reducedMotion, index * 0.06)}
                className="noo-step-card"
                style={{ borderBottom: `1px solid ${PALETTE.border}`, paddingBottom: 24, cursor: 'default' }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 24,
                  fontFamily: FONTS.sans,
                  fontWeight: 900,
                  fontSize: 13,
                  letterSpacing: '0.12em',
                  color: PALETTE.ink,
                }}>
                  <span>{item.step}</span>
                  <span
                    className="noo-active-tag"
                    style={{ fontFamily: FONTS.mono, fontSize: 10, color: PALETTE.accent, letterSpacing: '0.1em' }}
                  >
                    &#9679; ACTIVE
                  </span>
                </div>
                <h4 style={{
                  fontFamily: FONTS.sans,
                  fontSize: 20,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  marginBottom: 14,
                  letterSpacing: '-0.01em',
                }}>
                  {item.title}
                </h4>
                <p style={{ fontSize: 15, fontWeight: 300, lineHeight: 1.7, color: PALETTE.body }}>
                  {item.body}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Comparison (dark section) ── */}
        <section
          id="why-nooterra"
          className="noo-section-pad"
          style={{
            background: PALETTE.dark,
            color: '#ffffff',
            padding: '160px 48px',
            position: 'relative',
            overflow: 'hidden',
            scrollMarginTop: 100,
          }}
        >
          {/* Accent glow */}
          <div style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: '33%',
            height: '100%',
            background: `${PALETTE.accent}10`,
            filter: 'blur(150px)',
            pointerEvents: 'none',
          }} />

          <div style={{ maxWidth: 1440, margin: '0 auto', position: 'relative', zIndex: 10 }}>
            <div className="noo-compare-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 100, alignItems: 'center' }}>
              {/* Left: copy */}
              <div>
                <motion.div {...revealProps(reducedMotion, 0)}>
                  <MicroLabel style={{ color: PALETTE.accent, fontWeight: 900, marginBottom: 28, letterSpacing: '0.5em' }}>
                    STRIPE_RECOVERY_GAP
                  </MicroLabel>
                  <h2 style={{
                    fontFamily: FONTS.sans,
                    fontSize: 'clamp(40px, 5vw, 72px)',
                    fontWeight: 900,
                    letterSpacing: '-0.04em',
                    lineHeight: 0.95,
                    textTransform: 'uppercase',
                    marginBottom: 56,
                  }}>
                    The Recovery<br />Gap.
                  </h2>
                </motion.div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
                  {COMPARISON_POINTS.map((item, index) => (
                    <motion.div
                      key={item.title}
                      {...revealProps(reducedMotion, 0.1 + index * 0.08)}
                      style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}
                    >
                      <div style={{ width: 16, height: 16, background: PALETTE.accent, flexShrink: 0, marginTop: 4 }} />
                      <div>
                        <h5 style={{
                          fontFamily: FONTS.sans,
                          fontSize: 18,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          marginBottom: 10,
                        }}>
                          {item.title}
                        </h5>
                        <p style={{ fontSize: 15, fontWeight: 300, lineHeight: 1.7, color: 'rgba(255,255,255,0.5)' }}>
                          {item.body}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Right: comparison table */}
              <motion.div {...revealProps(reducedMotion, 0.15)}>
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  padding: 4,
                }}>
                  <div style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    padding: 48,
                  }}>
                    <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Vector', 'Stripe', 'Nooterra'].map((h, i) => (
                            <th
                              key={h}
                              style={{
                                paddingBottom: 36,
                                fontFamily: FONTS.mono,
                                fontSize: 10,
                                fontWeight: 900,
                                textTransform: 'uppercase',
                                letterSpacing: '0.4em',
                                color: i === 2 ? PALETTE.accent : 'rgba(255,255,255,0.35)',
                                border: 'none',
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {COMPARISON_TABLE.map((row, i) => (
                          <tr key={row.vector} style={{ borderBottom: i < COMPARISON_TABLE.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                            <td style={{
                              padding: '24px 0',
                              fontFamily: FONTS.mono,
                              fontSize: 12,
                              textTransform: 'uppercase',
                              letterSpacing: '0.12em',
                              color: 'rgba(255,255,255,0.7)',
                            }}>
                              {row.vector}
                            </td>
                            <td style={{
                              padding: '24px 0',
                              fontFamily: FONTS.mono,
                              fontSize: 12,
                              textTransform: 'uppercase',
                              letterSpacing: '0.12em',
                              color: 'rgba(255,255,255,0.3)',
                            }}>
                              {row.legacy}
                            </td>
                            <td style={{
                              padding: '24px 0',
                              fontFamily: FONTS.mono,
                              fontSize: 12,
                              fontWeight: 900,
                              textTransform: 'uppercase',
                              letterSpacing: '0.12em',
                              color: PALETTE.accent,
                            }}>
                              [{row.nooterra}]
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── The Protocol (trust cards) ── */}
        <section className="noo-section-pad" style={{ padding: '160px 48px', maxWidth: 1440, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 100 }}>
            <motion.div {...revealProps(reducedMotion, 0)}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 20px',
                background: PALETTE.surfaceHigh,
                marginBottom: 40,
              }}>
                <span style={{
                  fontFamily: FONTS.sans,
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: '0.4em',
                  textTransform: 'uppercase',
                  color: PALETTE.ink,
                }}>
                  SECURED BY DESIGN // AUDIT-READY
                </span>
              </div>
            </motion.div>
            <motion.h2
              {...revealProps(reducedMotion, 0.06)}
              style={{
                fontFamily: FONTS.sans,
                fontSize: 'clamp(40px, 5vw, 72px)',
                fontWeight: 900,
                letterSpacing: '-0.04em',
                lineHeight: 1,
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              The Protocol
            </motion.h2>
            <motion.p
              {...revealProps(reducedMotion, 0.1)}
              style={{
                fontFamily: FONTS.sans,
                fontSize: 12,
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
                color: PALETTE.body,
              }}
            >
              Non-Negotiable Transparency
            </motion.p>
          </div>

          {/* Cards */}
          <div className="noo-trust-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1,
            background: PALETTE.border,
            border: `1px solid ${PALETTE.border}`,
          }}>
            {TRUST_POINTS.map((item, index) => (
              <motion.div
                key={item.title}
                {...revealProps(reducedMotion, index * 0.06)}
                style={{
                  background: PALETTE.bg,
                  padding: 56,
                }}
              >
                <div style={{ width: 48, height: 3, background: PALETTE.accent, marginBottom: 36 }} />
                <h4 style={{
                  fontFamily: FONTS.sans,
                  fontSize: 22,
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '-0.01em',
                  marginBottom: 20,
                }}>
                  {item.title}
                </h4>
                <p style={{ fontSize: 15, fontWeight: 300, lineHeight: 1.7, color: PALETTE.body }}>
                  {item.body}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Bottom CTA (dark) ── */}
        <section className="noo-section-pad" style={{ maxWidth: 1440, margin: '0 auto', padding: '0 48px 160px' }}>
          <motion.div
            {...revealProps(reducedMotion, 0)}
            className="noo-cta-inner"
            style={{
              background: PALETTE.dark,
              border: '1px solid rgba(255,255,255,0.1)',
              padding: 80,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 64,
              alignItems: 'center',
              justifyContent: 'space-between',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Left copy */}
            <div style={{ maxWidth: 520, position: 'relative', zIndex: 10 }}>
              <h2 style={{
                fontFamily: FONTS.sans,
                fontSize: 'clamp(36px, 5vw, 64px)',
                fontWeight: 900,
                letterSpacing: '-0.04em',
                lineHeight: 0.9,
                textTransform: 'uppercase',
                color: '#ffffff',
                marginBottom: 32,
              }}>
                See It Work<br />On Your Data.
              </h2>
              <p style={{ fontSize: 18, fontWeight: 300, lineHeight: 1.7, color: 'rgba(255,255,255,0.5)', marginBottom: 40 }}>
                Connect Stripe and watch Nooterra analyze your overdue invoices in your first session. No commitment. No credit card.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                <a
                  href="/setup"
                  className="noo-btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '22px 48px',
                    background: PALETTE.accent,
                    color: PALETTE.ink,
                    fontFamily: FONTS.sans,
                    fontWeight: 900,
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: '0.3em',
                  }}
                >
                  Get Started
                  <ArrowRight size={16} />
                </a>
                <a
                  href="/docs"
                  className="noo-nav-link"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '22px 12px',
                    color: '#ffffff',
                    fontFamily: FONTS.sans,
                    fontWeight: 900,
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: '0.3em',
                    borderBottom: `1px solid ${PALETTE.accent}`,
                  }}
                >
                  Documentation
                </a>
              </div>
            </div>

            {/* Right: terminal mockup */}
            <div style={{ flex: '1 1 380px', maxWidth: 480, position: 'relative', zIndex: 10 }}>
              <div style={{
                background: '#1a2b3c',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: 4,
                boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
              }}>
                <div style={{
                  background: PALETTE.dark,
                  border: '1px solid rgba(255,255,255,0.05)',
                  padding: 28,
                }}>
                  {/* Window dots */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[
                        { bg: 'rgba(239,68,68,0.2)', border: 'rgba(239,68,68,0.5)' },
                        { bg: 'rgba(234,179,8,0.2)', border: 'rgba(234,179,8,0.5)' },
                        { bg: 'rgba(34,197,94,0.2)', border: 'rgba(34,197,94,0.5)' },
                      ].map((dot, i) => (
                        <div key={i} style={{ width: 10, height: 10, background: dot.bg, border: `1px solid ${dot.border}` }} />
                      ))}
                    </div>
                    <MicroLabel style={{ color: PALETTE.accent }}>LIVE_SIMULATION</MicroLabel>
                  </div>

                  {/* Content lines */}
                  <div style={{ height: 2, background: 'rgba(255,255,255,0.05)', marginBottom: 20 }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
                    <div style={{
                      width: 40,
                      height: 40,
                      background: `${PALETTE.accent}20`,
                      border: `1px solid ${PALETTE.accent}50`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <Activity size={18} color={PALETTE.accent} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.2)', width: '75%', marginBottom: 6 }} />
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', width: '50%' }} />
                    </div>
                  </div>

                  {/* Metric cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ padding: 14, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                        RECOVERY_PROB
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff' }}>92.4%</div>
                    </div>
                    <div style={{ padding: 14, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                        LATENT_REVENUE
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: PALETTE.accent }}>$42.8K</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Decorative markers */}
            <MicroLabel style={{ position: 'absolute', bottom: 16, left: 24, color: 'rgba(255,255,255,0.12)' }}>0,0 // NULL</MicroLabel>
            <MicroLabel style={{ position: 'absolute', top: 16, right: 24, color: 'rgba(255,255,255,0.12)' }}>1,1 // FULL_AUTH</MicroLabel>
          </motion.div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="noo-section-pad" style={{
        padding: '80px 48px',
        background: PALETTE.bg,
        borderTop: `1px solid ${PALETTE.border}`,
      }}>
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>
          {/* Top row */}
          <div className="noo-footer-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 80 }}>
            <div>
              <div style={{
                fontFamily: FONTS.sans,
                fontSize: 28,
                fontWeight: 900,
                letterSpacing: '-0.04em',
                color: PALETTE.ink,
                marginBottom: 24,
              }}>
                NOOTERRA
              </div>
              <p style={{ maxWidth: 300, fontSize: 14, fontWeight: 300, lineHeight: 1.7, color: PALETTE.body }}>
                Precision recovery for modern finance teams. Built for those who treat data as the ultimate leverage.
              </p>
            </div>

            <div className="noo-footer-links" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 64, marginTop: 0 }}>
              {[
                { heading: 'Product', links: [['How it works', '#how-it-works'], ['Why Nooterra', '#why-nooterra']] },
                { heading: 'Support', links: [['Docs', '/docs'], ['API', '/docs']] },
                { heading: 'Legal', links: [['Privacy', '/privacy'], ['Terms', '/terms']] },
                { heading: 'Connect', links: [['GitHub', 'https://github.com/nooterra/nooterra'], ['X', 'https://x.com/nooterra']] },
              ].map((col) => (
                <div key={col.heading} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <span style={{
                    fontFamily: FONTS.sans,
                    fontSize: 10,
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    letterSpacing: '0.2em',
                    color: PALETTE.ink,
                    marginBottom: 8,
                  }}>
                    {col.heading}
                  </span>
                  {col.links.map(([label, href]) => (
                    <a
                      key={label}
                      href={href}
                      style={{
                        fontSize: 13,
                        color: PALETTE.body,
                        textDecoration: 'none',
                        lineHeight: 1.8,
                      }}
                    >
                      {label}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Bottom rule */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 36,
            borderTop: `1px solid ${PALETTE.border}`,
          }}>
            <p style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              letterSpacing: '0.12em',
              color: PALETTE.muted,
            }}>
              &copy; 2026 NOOTERRA
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 8, height: 8, background: PALETTE.accent }} />
              <div style={{ width: 8, height: 8, background: PALETTE.ink }} />
              <div style={{ width: 8, height: 8, background: PALETTE.border }} />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
