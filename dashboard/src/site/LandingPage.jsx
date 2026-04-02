/**
 * Nooterra Landing Page — Editorial precision.
 *
 * Aesthetic: Monocle meets Bloomberg. Intellectual confidence.
 * Every layout shape is different. Zero repeated patterns.
 * The product IS the visual — the trace walkthrough is the hero.
 *
 * Fonts: Instrument Serif (display) + Satoshi (body)
 * Palette: Warm ivory base, ink-black text, one sharp teal accent
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowRight, Check, ArrowUpRight, ChevronRight,
  CreditCard, Mail, Users, Brain, Shield, Activity,
  Eye, Zap, TrendingUp, BarChart3, Lock,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Design tokens — warm ivory + ink + teal
// ---------------------------------------------------------------------------

const T = {
  // Surfaces
  ivory: '#FAFAF7',
  paper: '#F4F3EF',
  chalk: '#ECEAE4',
  // Text
  ink: '#1A1A1A',
  iron: '#52524E',
  stone: '#8C8C86',
  // Accent — saturated teal (not blue, not green — in between)
  teal: '#0D9488',
  tealDeep: '#0A7A70',
  tealSoft: '#F0FDFA',
  tealMid: '#CCFBF1',
  // Semantic
  ember: '#C2410C',
  emberSoft: '#FFF7ED',
  gold: '#A16207',
  goldSoft: '#FEFCE8',
  sage: '#15803D',
  sageSoft: '#F0FDF4',
  slate: '#475569',
  // Structure
  rule: '#D6D3CC',
  ruleLight: '#E8E6E0',
};

const font = {
  display: "'Instrument Serif', 'Georgia', serif",
  body: "'Satoshi', 'DM Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', monospace",
};

// ---------------------------------------------------------------------------
// Interactive Trace — the hero visual. Click-driven, not auto-play.
// ---------------------------------------------------------------------------

function TraceWalkthrough() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      phase: 'OBSERVE',
      title: 'Stripe detects an overdue invoice',
      detail: 'Invoice #1247 — $4,200.00 — Acme Corp — 18 days past due',
      meta: 'webhook received 340ms ago',
      accent: T.teal,
    },
    {
      phase: 'MODEL',
      title: 'Business graph updated',
      detail: 'Customer linked: 3 prior invoices (2 on-time, 1 late). 2 active email threads. Last contact 5 days ago.',
      meta: '7 objects · 4 relationships',
      accent: T.slate,
    },
    {
      phase: 'PREDICT',
      title: 'Payment probability: 72% within 7 days',
      detail: 'Customer mentioned "cash flow timing" in recent email. Historical on-time rate: 67%. Dispute risk: 8%.',
      meta: 'calibration score 0.82',
      accent: '#7C3AED',
    },
    {
      phase: 'PLAN',
      title: 'Stage 1: Personalized friendly reminder',
      detail: 'Referencing their specific situation. Empathetic tone — they mentioned cash flow. Include payment link.',
      meta: 'priority 0.84 · cost $0.003',
      accent: T.gold,
    },
    {
      phase: 'GOVERN',
      title: 'Gateway: 11 checks passed',
      detail: 'Authority ✓ Policy ✓ Budget ✓ Rate limit ✓ Disclosure appended ✓ Evidence bundle attached.',
      meta: 'pipeline 12ms',
      accent: T.sage,
    },
    {
      phase: 'ACT',
      title: 'Email sent. Outcome tracked.',
      detail: 'Prediction model will update when Acme Corp responds or pays. Every action feeds the next prediction.',
      meta: 'trace complete',
      accent: T.teal,
    },
  ];

  return (
    <div style={{ background: T.ivory, border: `1px solid ${T.rule}`, borderRadius: 2, padding: 0, overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{
        padding: '12px 20px', borderBottom: `1px solid ${T.ruleLight}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.teal }} />
          <span style={{ fontSize: 10, fontFamily: font.mono, fontWeight: 500, color: T.stone, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            System trace
          </span>
        </div>
        <span style={{ fontSize: 10, fontFamily: font.mono, color: T.stone }}>
          {activeStep + 1}/{steps.length}
        </span>
      </div>

      {/* Steps */}
      <div style={{ padding: '8px 0' }}>
        {steps.map((step, i) => {
          const isActive = i === activeStep;
          const isPast = i < activeStep;
          const isFuture = i > activeStep;

          return (
            <button
              key={i}
              onClick={() => setActiveStep(i)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 16,
                width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                padding: '14px 20px', background: isActive ? T.paper : 'transparent',
                opacity: isFuture ? 0.3 : 1,
                transition: 'all 0.2s ease',
              }}
            >
              {/* Phase label */}
              <span style={{
                fontSize: 9, fontFamily: font.mono, fontWeight: 600,
                letterSpacing: '0.1em', color: isPast ? T.sage : isActive ? step.accent : T.stone,
                width: 56, flexShrink: 0, paddingTop: 2,
              }}>
                {isPast ? '✓' : step.phase}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: isActive ? T.ink : T.iron,
                  fontFamily: font.body, lineHeight: 1.3,
                }}>
                  {step.title}
                </div>
                {(isActive || isPast) && (
                  <div style={{
                    fontSize: 12, color: T.stone, marginTop: 4, lineHeight: 1.5,
                    fontFamily: font.body,
                  }}>
                    {step.detail}
                  </div>
                )}
                {isActive && (
                  <span style={{
                    display: 'inline-block', marginTop: 6,
                    fontSize: 10, fontFamily: font.mono, color: step.accent,
                    letterSpacing: '0.02em',
                  }}>
                    {step.meta}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Navigation */}
      <div style={{
        padding: '12px 20px', borderTop: `1px solid ${T.ruleLight}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <button
          onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
          disabled={activeStep === 0}
          style={{
            fontSize: 11, fontFamily: font.body, fontWeight: 500,
            color: activeStep === 0 ? T.stone : T.iron,
            background: 'none', border: 'none', cursor: activeStep === 0 ? 'default' : 'pointer',
            padding: '4px 0',
          }}
        >
          Previous
        </button>
        <button
          onClick={() => setActiveStep(Math.min(steps.length - 1, activeStep + 1))}
          disabled={activeStep === steps.length - 1}
          style={{
            fontSize: 11, fontFamily: font.body, fontWeight: 600,
            color: activeStep === steps.length - 1 ? T.stone : T.teal,
            background: 'none', border: 'none', cursor: activeStep === steps.length - 1 ? 'default' : 'pointer',
            padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          Next step <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LandingPage() {
  return (
    <div style={{ background: T.ivory, color: T.ink, minHeight: '100vh' }}>

      {/* Font imports */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet" />

      {/* ═══ NAV ═══ */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: `${T.ivory}F0`, backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${T.ruleLight}`,
      }}>
        <div style={{
          maxWidth: 1120, margin: '0 auto', padding: '0 32px',
          height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, fontFamily: font.body, letterSpacing: '-0.01em', color: T.ink }}>
            nooterra
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <a href="#how" style={{ fontSize: 13, color: T.iron, textDecoration: 'none', fontFamily: font.body }}>How it works</a>
            <a href="#pricing" style={{ fontSize: 13, color: T.iron, textDecoration: 'none', fontFamily: font.body }}>Pricing</a>
            <a href="/login" style={{ fontSize: 13, color: T.iron, textDecoration: 'none', fontFamily: font.body }}>Sign in</a>
            <a href="/setup" style={{
              fontSize: 12, fontWeight: 600, fontFamily: font.body,
              color: T.ivory, background: T.ink, padding: '7px 16px',
              borderRadius: 2, textDecoration: 'none', letterSpacing: '0.01em',
            }}>
              Get started
            </a>
          </div>
        </div>
      </nav>

      {/* ═══ HERO — asymmetric: text left, trace right ═══ */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '80px 32px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '5fr 4fr', gap: 64, alignItems: 'start' }}>
          <div>
            <p style={{
              fontSize: 11, fontFamily: font.mono, fontWeight: 500,
              color: T.teal, letterSpacing: '0.1em', textTransform: 'uppercase',
              marginBottom: 20,
            }}>
              Enterprise World Runtime
            </p>
            <h1 style={{
              fontSize: 'clamp(40px, 4.5vw, 64px)',
              fontFamily: font.display, fontWeight: 400, fontStyle: 'normal',
              lineHeight: 1.05, letterSpacing: '-0.02em',
              color: T.ink, margin: 0,
            }}>
              Give your business<br />
              a mind.
            </h1>
            <p style={{
              fontSize: 17, lineHeight: 1.65, color: T.iron,
              fontFamily: font.body, fontWeight: 400,
              marginTop: 24, maxWidth: 440,
            }}>
              AI agents that see your entire business, predict what's coming,
              and handle the work you don't have time for — governed by your
              rules, earning trust from real results.
            </p>
            <div style={{ marginTop: 36, display: 'flex', alignItems: 'center', gap: 16 }}>
              <a href="/setup" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                fontSize: 14, fontWeight: 600, fontFamily: font.body,
                color: T.ivory, background: T.ink, padding: '13px 28px',
                borderRadius: 2, textDecoration: 'none',
              }}>
                Start free <ArrowRight size={14} />
              </a>
              <a href="#how" style={{
                fontSize: 13, color: T.iron, textDecoration: 'none',
                fontFamily: font.body, fontWeight: 500,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                See a live trace <ArrowUpRight size={13} />
              </a>
            </div>

            {/* Credibility strip — not logos, just text */}
            <div style={{
              marginTop: 56, paddingTop: 24, borderTop: `1px solid ${T.rule}`,
              display: 'flex', gap: 32,
            }}>
              {[
                { label: 'Powered by', value: 'Anthropic + OpenAI' },
                { label: 'Payments via', value: 'Stripe' },
                { label: 'Infrastructure', value: 'Railway' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <span style={{ fontSize: 10, fontFamily: font.mono, color: T.stone, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block' }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 13, fontFamily: font.body, fontWeight: 500, color: T.iron, marginTop: 2, display: 'block' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Interactive trace */}
          <TraceWalkthrough />
        </div>
      </section>

      {/* ═══ SOCIAL PROOF ═══ */}
      <div style={{ borderTop: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`, background: T.paper }}>
        <div style={{
          maxWidth: 720, margin: '0 auto', padding: '40px 32px',
          textAlign: 'center',
        }}>
          <p style={{
            fontSize: 18, fontFamily: font.display, fontStyle: 'italic',
            lineHeight: 1.55, color: T.ink, margin: 0,
          }}>
            "We replaced three Zapier automations and a part-time VA.
            The agent caught a $12K invoice we'd missed for two weeks."
          </p>
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.teal }} />
            <span style={{ fontSize: 12, fontFamily: font.body, fontWeight: 500, color: T.iron }}>
              Early access design partner — B2B SaaS, 40 employees
            </span>
          </div>
        </div>
      </div>

      {/* ═══ PROBLEM — full-width prose, no cards ═══ */}
      <section style={{ maxWidth: 640, margin: '0 auto', padding: '80px 32px' }}>
        <p style={{
          fontSize: 11, fontFamily: font.mono, fontWeight: 500, color: T.ember,
          letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16,
        }}>
          The problem
        </p>
        <p style={{
          fontSize: 21, fontFamily: font.display, fontStyle: 'italic',
          lineHeight: 1.5, color: T.ink,
        }}>
          Every morning you check Stripe, cross-reference Gmail, update QuickBooks,
          draft follow-up emails, and hope you didn't miss one from last week.
          Your business isn't short on tools. It's short on you.
        </p>
        <p style={{
          fontSize: 15, fontFamily: font.body, lineHeight: 1.7, color: T.iron,
          marginTop: 20,
        }}>
          Invoices slip because nobody followed up. Customers churn because the
          warning signs were in three different apps. Revenue leaks through the
          cracks between your systems. Not because you're negligent — because
          there's only one of you and the business needs thirty.
        </p>
      </section>

      {/* ═══ HOW IT WORKS — vertical timeline, not cards ═══ */}
      <section id="how" style={{
        background: T.paper, borderTop: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`,
        padding: '80px 32px',
      }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <p style={{
            fontSize: 11, fontFamily: font.mono, fontWeight: 500, color: T.teal,
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16,
          }}>
            How it works
          </p>
          <h2 style={{
            fontSize: 36, fontFamily: font.display, fontWeight: 400,
            lineHeight: 1.15, color: T.ink, marginBottom: 48, maxWidth: 500,
          }}>
            Connect your tools.<br />
            We build the brain.
          </h2>

          {/* Timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxWidth: 640 }}>
            {[
              { step: 'Connect', time: 'Minute 1', body: 'One-click OAuth for Stripe, Gmail, QuickBooks, Calendar. No API keys. No configuration. The system starts observing immediately.' },
              { step: 'Model', time: 'Minute 10', body: 'Every customer, invoice, payment, and email thread appears in a live, linked object graph. Entity resolution matches records across systems automatically.' },
              { step: 'Predict', time: 'Hour 1', body: 'Hidden state estimates appear on every object. Payment probability. Churn risk. Urgency scores. Each prediction shows its confidence level and what evidence it used.' },
              { step: 'Operate', time: 'Day 1', body: 'The collections agent proposes its first actions in shadow mode. You review every one. Nothing sends without your approval. Evidence bundles show exactly why each action was chosen.' },
              { step: 'Trust', time: 'Week 3', body: 'After 20+ proposals with 85%+ quality scores, the system recommends expanding autonomy. You approve. Now routine reminders send automatically. One incident and it stops.' },
            ].map(({ step, time, body }, i) => (
              <div key={step} style={{ display: 'flex', gap: 32, position: 'relative' }}>
                {/* Vertical line */}
                <div style={{ width: 56, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: i === 0 ? T.teal : T.rule, flexShrink: 0, marginTop: 6,
                  }} />
                  {i < 4 && <div style={{ width: 1, flex: 1, background: T.rule }} />}
                </div>
                <div style={{ paddingBottom: 40 }}>
                  <span style={{
                    fontSize: 10, fontFamily: font.mono, fontWeight: 500,
                    color: T.teal, letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>
                    {time}
                  </span>
                  <h3 style={{
                    fontSize: 18, fontFamily: font.body, fontWeight: 600,
                    color: T.ink, marginTop: 4, marginBottom: 6,
                  }}>
                    {step}
                  </h3>
                  <p style={{
                    fontSize: 14, fontFamily: font.body, lineHeight: 1.65,
                    color: T.iron, margin: 0,
                  }}>
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ DIFFERENCE — table, not cards ═══ */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '80px 32px' }}>
        <h2 style={{
          fontSize: 32, fontFamily: font.display, fontWeight: 400,
          lineHeight: 1.15, color: T.ink, marginBottom: 40,
        }}>
          Not another AI tool.<br />A different category entirely.
        </h2>

        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontFamily: font.body, fontSize: 13,
        }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${T.ink}` }}>
              <th style={{ textAlign: 'left', padding: '10px 16px 10px 0', fontWeight: 600, fontSize: 11, fontFamily: font.mono, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.stone }}>Capability</th>
              <th style={{ textAlign: 'center', padding: '10px 16px', fontWeight: 600, fontSize: 11, color: T.stone }}>ChatGPT</th>
              <th style={{ textAlign: 'center', padding: '10px 16px', fontWeight: 600, fontSize: 11, color: T.stone }}>Zapier</th>
              <th style={{ textAlign: 'center', padding: '10px 16px', fontWeight: 600, fontSize: 11, color: T.teal }}>Nooterra</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Knows your business data', '—', '—', '✓'],
              ['Predicts outcomes', '—', '—', '✓'],
              ['Takes real actions', '—', '✓', '✓'],
              ['Governed by policy', '—', '—', '✓'],
              ['Earns autonomy over time', '—', '—', '✓'],
              ['Evidence trail on every action', '—', '—', '✓'],
              ['Gets smarter from outcomes', '—', '—', '✓'],
            ].map(([cap, chatgpt, zapier, nooterra], i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${T.ruleLight}` }}>
                <td style={{ padding: '12px 16px 12px 0', color: T.ink }}>{cap}</td>
                <td style={{ textAlign: 'center', padding: '12px 16px', color: T.stone }}>{chatgpt}</td>
                <td style={{ textAlign: 'center', padding: '12px 16px', color: T.stone }}>{zapier}</td>
                <td style={{ textAlign: 'center', padding: '12px 16px', color: T.teal, fontWeight: 600 }}>{nooterra}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ═══ TRUST — horizontal progression, not cards ═══ */}
      <section style={{
        background: T.paper, borderTop: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`,
        padding: '80px 32px',
      }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <h2 style={{
            fontSize: 32, fontFamily: font.display, fontWeight: 400,
            lineHeight: 1.15, color: T.ink, marginBottom: 12, maxWidth: 440,
          }}>
            Trust isn't a setting.<br />
            It's a track record.
          </h2>
          <p style={{ fontSize: 14, fontFamily: font.body, color: T.iron, maxWidth: 480, lineHeight: 1.6, marginBottom: 48 }}>
            Every action is graded on two dimensions: did it follow the right process,
            and did it achieve the goal. Autonomy expands when both scores are consistently high.
          </p>

          {/* Horizontal progression */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
            {[
              { phase: 'Shadow', range: 'Week 1–2', desc: 'Agent proposes actions. Nothing executes. You see every decision it would make.', score: '0 executions', color: T.gold },
              { phase: 'Supervised', range: 'Week 3–4', desc: 'Agent drafts actions. You approve with one click. The system tracks your approval patterns.', score: '38/40 approved', color: T.teal },
              { phase: 'Autonomous', range: 'Week 5+', desc: 'Proven action types run automatically. Still logged, still auditable, still governed. One incident demotes immediately.', score: '94% procedural', color: T.sage },
            ].map(({ phase, range, desc, score, color }, i) => (
              <div key={phase} style={{
                flex: 1, padding: '28px 24px',
                borderTop: `3px solid ${color}`,
                background: T.ivory,
                borderRight: i < 2 ? `1px solid ${T.rule}` : 'none',
              }}>
                <span style={{ fontSize: 10, fontFamily: font.mono, fontWeight: 600, color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {range}
                </span>
                <h3 style={{ fontSize: 18, fontFamily: font.body, fontWeight: 600, color: T.ink, marginTop: 8, marginBottom: 8 }}>
                  {phase}
                </h3>
                <p style={{ fontSize: 13, fontFamily: font.body, lineHeight: 1.55, color: T.iron, margin: 0 }}>
                  {desc}
                </p>
                <span style={{ display: 'inline-block', marginTop: 12, fontSize: 10, fontFamily: font.mono, color, letterSpacing: '0.02em' }}>
                  {score}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PRICING — minimal, asymmetric ═══ */}
      <section id="pricing" style={{ maxWidth: 1120, margin: '0 auto', padding: '80px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 64, alignItems: 'start' }}>
          <div>
            <h2 style={{
              fontSize: 32, fontFamily: font.display, fontWeight: 400,
              lineHeight: 1.15, color: T.ink,
            }}>
              Pricing
            </h2>
            <p style={{
              fontSize: 14, fontFamily: font.body, lineHeight: 1.6,
              color: T.iron, marginTop: 12,
            }}>
              Start with observation.<br />
              Add autonomy when you're ready.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { name: 'Starter', price: '$149', desc: 'See your business as a live model. One agent in shadow mode.', highlight: false },
              { name: 'Business', price: '$499', desc: 'Full autonomy progression. Predictions. Policy editor. The system runs itself.', highlight: true },
              { name: 'Enterprise', price: 'Custom', desc: 'Unlimited agents. What-if simulator. SSO. SLA. SOC 2.', highlight: false },
            ].map(({ name, price, desc, highlight }) => (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '24px 0',
                borderBottom: `1px solid ${T.rule}`,
                background: highlight ? T.tealSoft : 'transparent',
                marginLeft: highlight ? -16 : 0, marginRight: highlight ? -16 : 0,
                paddingLeft: highlight ? 16 : 0, paddingRight: highlight ? 16 : 0,
                borderRadius: highlight ? 2 : 0,
              }}>
                <div>
                  <span style={{ fontSize: 16, fontFamily: font.body, fontWeight: 600, color: T.ink }}>{name}</span>
                  <p style={{ fontSize: 13, fontFamily: font.body, color: T.iron, marginTop: 2, margin: 0 }}>{desc}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
                  <span style={{ fontSize: 20, fontFamily: font.display, fontWeight: 400, color: T.ink }}>
                    {price}<span style={{ fontSize: 13, color: T.stone }}>{price !== 'Custom' ? '/mo' : ''}</span>
                  </span>
                  <a href="/setup" style={{
                    fontSize: 12, fontWeight: 600, fontFamily: font.body,
                    color: highlight ? T.ivory : T.ink,
                    background: highlight ? T.ink : 'transparent',
                    border: highlight ? 'none' : `1px solid ${T.rule}`,
                    padding: '8px 16px', borderRadius: 2, textDecoration: 'none',
                  }}>
                    {price === 'Custom' ? 'Contact us' : 'Start free'}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ EARLY ACCESS SIGNAL ═══ */}
      <div style={{
        maxWidth: 1120, margin: '0 auto', padding: '0 32px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24,
          padding: '20px 0',
        }}>
          {[
            'Currently in early access with 5 design partners',
            'Processing live business data since March 2026',
          ].map((text, i) => (
            <span key={i} style={{
              fontSize: 12, fontFamily: font.body, color: T.stone,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.teal, flexShrink: 0 }} />
              {text}
            </span>
          ))}
        </div>
      </div>

      {/* ═══ FINAL CTA — stark, confident ═══ */}
      <section style={{
        borderTop: `1px solid ${T.rule}`,
        padding: '80px 32px',
        textAlign: 'center',
      }}>
        <h2 style={{
          fontSize: 40, fontFamily: font.display, fontWeight: 400,
          lineHeight: 1.1, color: T.ink, marginBottom: 16,
        }}>
          The most advanced way<br />
          to deploy AI to your business.
        </h2>
        <p style={{ fontSize: 15, fontFamily: font.body, color: T.iron, maxWidth: 400, margin: '0 auto' }}>
          Five minutes to connect. One hour to predict.<br />
          One week to trust. Then it runs itself.
        </p>
        <a href="/setup" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 14, fontWeight: 600, fontFamily: font.body,
          color: T.ivory, background: T.ink, padding: '14px 32px',
          borderRadius: 2, textDecoration: 'none', marginTop: 32,
        }}>
          Get started free <ArrowRight size={14} />
        </a>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer style={{
        borderTop: `1px solid ${T.rule}`, padding: '24px 32px',
        maxWidth: 1120, margin: '0 auto',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, fontFamily: font.body, color: T.stone }}>Nooterra Labs, Inc.</span>
        <div style={{ display: 'flex', gap: 20 }}>
          {['Docs', 'Privacy', 'Terms', 'GitHub'].map(link => (
            <a key={link} href={`/${link.toLowerCase()}`} style={{
              fontSize: 11, fontFamily: font.body, color: T.stone, textDecoration: 'none',
            }}>
              {link}
            </a>
          ))}
        </div>
      </footer>
    </div>
  );
}
