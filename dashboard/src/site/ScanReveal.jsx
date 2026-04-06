import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ShieldAlert, ShieldCheck, Siren, TriangleAlert } from "lucide-react";

const COLORS = {
  bg: "#060606",
  bgSoft: "#0d0d0d",
  panel: "#111111",
  panelSoft: "#151515",
  ink: "#f5f1e8",
  steel: "#9b9489",
  steelSoft: "#6b655d",
  line: "rgba(245, 241, 232, 0.12)",
  lineStrong: "rgba(245, 241, 232, 0.2)",
  alert: "#d94d3f",
  alertSoft: "rgba(217, 77, 63, 0.12)",
  amber: "#c88731",
  amberSoft: "rgba(200, 135, 49, 0.12)",
  teal: "#3a8f88",
  tealSoft: "rgba(58, 143, 136, 0.12)",
};

const FONTS = {
  sans: "'Satoshi', 'Geist', system-ui, sans-serif",
  mono: "'Geist Mono', 'SF Mono', monospace",
};

const EASE = [0.16, 1, 0.3, 1];

const SCAN_FIXTURE = {
  schema_version: "stripe.scan.result.v1",
  scan_id: "scn_09a47fb2",
  timestamp: "2026-04-04T15:29:28Z",
  lookback_days: 30,
  metrics: {
    total_exposure_cents: 14285000,
    total_flagged_events: 19,
  },
  buckets: [
    {
      id: "bkt_invoices",
      label: "Overdue Invoices (Baseline Recovery Candidates)",
      count: 12,
      exposure_cents: 8400000,
      status: "actionable",
    },
    {
      id: "bkt_refunds",
      label: "Refunds & Credits (Policy Threshold Exceeded)",
      count: 4,
      exposure_cents: 4250000,
      status: "flagged",
    },
    {
      id: "bkt_disputes",
      label: "Open Disputes (Missing Evidence SLA)",
      count: 3,
      exposure_cents: 1635000,
      status: "at_risk",
    },
  ],
  featured_artifact: {
    entity_name: "Acme Manufacturing",
    event_type: "Invoice Overdue",
    object_id: "NT-INV-8842",
    amount_cents: 1420000,
    priority_label: "high",
    priority_score: 68,
    recommended_action: "Review governed recovery workflow before outreach.",
    evidence_log: [
      "Invoice overdue by 12 days.",
      "Collection method: charge_automatically.",
    ],
  },
};

function loadProps(reducedMotion, delay = 0) {
  if (reducedMotion) return {};
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.24, delay, ease: EASE },
  };
}

function formatCurrencyValue(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMoney(centsValue, legacyMajorValue = null) {
  const cents = Number(centsValue);
  if (Number.isFinite(cents)) return formatCurrencyValue(cents / 100);
  const legacy = Number(legacyMajorValue);
  return formatCurrencyValue(Number.isFinite(legacy) ? legacy : 0);
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function statusTheme(status) {
  switch (status) {
    case "actionable":
      return {
        label: "Actionable",
        color: COLORS.teal,
        background: COLORS.tealSoft,
        icon: ShieldCheck,
      };
    case "flagged":
      return {
        label: "Flagged",
        color: COLORS.amber,
        background: COLORS.amberSoft,
        icon: TriangleAlert,
      };
    default:
      return {
        label: "At risk",
        color: COLORS.alert,
        background: COLORS.alertSoft,
        icon: Siren,
      };
  }
}

function NooterraMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="2.5" stroke={COLORS.ink} strokeWidth="1.4" />
      <circle cx="9.5" cy="10" r="2" fill={COLORS.ink} />
      <circle cx="22.5" cy="10" r="2" fill={COLORS.ink} />
      <circle cx="16" cy="22" r="2" fill={COLORS.teal} />
      <path d="M9.5 12L16 20M22.5 12L16 20M11.5 10H20.5" stroke={COLORS.ink} strokeWidth="1.3" />
    </svg>
  );
}

function BucketCard({ bucket, index, reducedMotion }) {
  const theme = statusTheme(bucket.status);
  const Icon = theme.icon;

  return (
    <motion.div
      {...loadProps(reducedMotion, 0.14 + index * 0.06)}
      className="border p-5 transition-colors"
      style={{ borderColor: COLORS.lineStrong, background: COLORS.panelSoft }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-[24rem]">
          <div className="mb-3 inline-flex items-center gap-2 border px-2 py-1 text-[10px] uppercase tracking-[0.18em]" style={{ borderColor: theme.color, color: theme.color, background: theme.background, fontFamily: FONTS.mono }}>
            <Icon size={12} />
            {theme.label}
          </div>
          <h3 className="text-lg font-medium leading-7 text-white">{bucket.label}</h3>
          <p className="mt-3 text-sm" style={{ color: COLORS.steel, fontFamily: FONTS.mono }}>
            {bucket.count} items detected
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
            Exposure
          </div>
          <div className="mt-2 text-2xl font-medium tracking-[-0.05em] text-white">
            {formatMoney(bucket.exposure_cents, bucket.exposure_usd)}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function FeaturedArtifact({ artifact, reducedMotion }) {
  return (
    <motion.section
      {...loadProps(reducedMotion, 0.28)}
      className="relative overflow-hidden border"
      style={{
        borderColor: COLORS.lineStrong,
        background: "linear-gradient(180deg, rgba(17,17,17,0.98), rgba(10,10,10,0.96))",
        boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
      }}
    >
      <div className="absolute left-0 top-0 h-full w-[3px]" style={{ background: COLORS.alert }} />

      <div className="border-b px-6 py-4" style={{ borderColor: COLORS.line }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
              Highest priority artifact
            </div>
            <h3 className="mt-2 text-[1.7rem] font-medium tracking-[-0.05em] text-white">
              {artifact.entity_name}
            </h3>
            <div className="mt-2 text-sm" style={{ color: COLORS.steel, fontFamily: FONTS.mono }}>
              {artifact.object_id}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
              Exposure
            </div>
            <div className="mt-2 text-[1.8rem] font-medium tracking-[-0.05em]" style={{ color: COLORS.alert }}>
              {formatMoney(artifact.amount_cents, artifact.exposure_usd)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-0 border-b md:grid-cols-2" style={{ borderColor: COLORS.line }}>
        <div className="border-b px-6 py-5 md:border-b-0 md:border-r" style={{ borderColor: COLORS.line }}>
          <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
            Event
          </div>
          <div className="mt-2 text-base text-white">{artifact.event_type}</div>
        </div>
        <div className="px-6 py-5">
          <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
            {artifact.priority_label ? "Priority label" : "Recovery score"}
          </div>
          <div className="mt-2 text-base capitalize" style={{ color: COLORS.teal, fontFamily: FONTS.mono }}>
            {artifact.priority_label ?? artifact.recovery_score?.toFixed(2) ?? "n/a"}
          </div>
        </div>
      </div>

      <div className="border-b px-6 py-5" style={{ borderColor: COLORS.line }}>
        <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
          Recommended governance action
        </div>
        <div className="mt-3 border px-4 py-4 text-sm text-white" style={{ borderColor: COLORS.lineStrong, background: COLORS.bgSoft, fontFamily: FONTS.mono }}>
          {artifact.recommended_action}
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
          Evidence panel
        </div>
        <div className="mt-4 space-y-3">
          {artifact.evidence_log.map((item) => (
            <div
              key={item}
              className="border-l pl-4 text-sm leading-7"
              style={{ borderColor: COLORS.steelSoft, color: COLORS.steel, fontFamily: FONTS.mono }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}

export default function ScanReveal({ data = SCAN_FIXTURE }) {
  const reducedMotion = useReducedMotion();

  return (
    <main
      className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      style={{ background: COLORS.bg, color: COLORS.ink, fontFamily: FONTS.sans }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-40"
        style={{
          backgroundImage: `linear-gradient(to right, ${COLORS.line} 1px, transparent 1px), linear-gradient(to bottom, ${COLORS.line} 1px, transparent 1px)`,
          backgroundSize: "88px 100%, 100% 128px",
          maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.85), transparent 94%)",
          WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.85), transparent 94%)",
        }}
      />

      <div className="relative mx-auto max-w-[78rem]">
        <motion.header
          {...loadProps(reducedMotion, 0.04)}
          className="flex flex-col gap-5 border-b pb-5 sm:flex-row sm:items-end sm:justify-between"
          style={{ borderColor: COLORS.lineStrong }}
        >
          <div>
            <div className="inline-flex items-center gap-3">
              <NooterraMark />
              <span className="text-[0.95rem] font-medium tracking-[-0.03em] text-white">Nooterra</span>
            </div>
            <div className="mt-5 text-[11px] uppercase tracking-[0.22em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
              World model baseline scan
            </div>
            <h1 className="mt-2 text-[2rem] font-medium tracking-[-0.05em] text-white sm:text-[2.4rem]">
              Scan complete
            </h1>
          </div>

          <div className="grid gap-2 text-right text-[11px] uppercase tracking-[0.16em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
            <div>Scan ID: {data.scan_id}</div>
            <div>Timestamp: {formatTimestamp(data.timestamp)}</div>
          </div>
        </motion.header>

        <section className="grid gap-8 border-b py-10 lg:grid-cols-[1.35fr_0.65fr] lg:items-end" style={{ borderColor: COLORS.lineStrong }}>
          <motion.div {...loadProps(reducedMotion, 0.1)}>
            <div className="text-[11px] uppercase tracking-[0.22em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
              Ungoverned revenue exposure
            </div>
            <div className="mt-4 text-[clamp(4.2rem,11vw,8.5rem)] font-semibold leading-[0.92] tracking-[-0.09em]" style={{ color: COLORS.alert }}>
              {formatMoney(data.metrics.total_exposure_cents, data.metrics.total_exposure_usd)}
            </div>
            <p className="mt-5 max-w-[44rem] text-base leading-8 sm:text-lg" style={{ color: COLORS.steel }}>
              Detected across {data.metrics.total_flagged_events} high-risk surfaces in the last {data.lookback_days} days.
              This scan is deterministic and read-only. It identifies financial events that currently lack policy enforcement,
              approval logic, or timely operator review.
            </p>
          </motion.div>

          <motion.div
            {...loadProps(reducedMotion, 0.18)}
            className="border p-5"
            style={{ borderColor: COLORS.lineStrong, background: COLORS.panel }}
          >
            <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
              Baseline finding
            </div>
            <div className="mt-4 flex items-start gap-3">
              <ShieldAlert size={18} style={{ color: COLORS.amber, flexShrink: 0, marginTop: 2 }} />
              <p className="text-sm leading-7" style={{ color: COLORS.steel }}>
                Governance is currently reactive. High-value Stripe events are visible, but approvals and policy gates are not
                consistently intercepting them before financial impact occurs.
              </p>
            </div>
          </motion.div>
        </section>

        <section className="grid gap-10 py-10 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <motion.div {...loadProps(reducedMotion, 0.14)} className="mb-5 text-[11px] uppercase tracking-[0.22em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
              Exposure breakdown
            </motion.div>
            <div className="space-y-4">
              {data.buckets.map((bucket, index) => (
                <BucketCard key={bucket.id} bucket={bucket} index={index} reducedMotion={reducedMotion} />
              ))}
            </div>
          </div>

          <div>
            <motion.div {...loadProps(reducedMotion, 0.2)} className="mb-5 text-[11px] uppercase tracking-[0.22em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
              Featured artifact
            </motion.div>
            <FeaturedArtifact artifact={data.featured_artifact} reducedMotion={reducedMotion} />
          </div>
        </section>

        <motion.section
          {...loadProps(reducedMotion, 0.34)}
          className="border p-6 sm:p-7"
          style={{ borderColor: COLORS.lineStrong, background: "linear-gradient(180deg, rgba(17,17,17,0.96), rgba(11,11,11,0.92))" }}
        >
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em]" style={{ color: COLORS.steelSoft, fontFamily: FONTS.mono }}>
                Shadow mode
              </div>
              <h2 className="mt-3 text-[1.8rem] font-medium tracking-[-0.05em] text-white">
                Your revenue state is mapped. Governance is still disabled.
              </h2>
              <p className="mt-4 max-w-[48rem] text-sm leading-8 sm:text-base" style={{ color: COLORS.steel }}>
                Unlock the Gateway to activate policy enforcement, approval workflows, and governed execution across refunds,
                disputes, recovery actions, and other Stripe revenue operations.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <a
                href="/setup"
                className="inline-flex items-center justify-center gap-2 border px-5 py-3 text-[11px] uppercase tracking-[0.18em] no-underline"
                style={{ borderColor: COLORS.lineStrong, background: COLORS.ink, color: COLORS.bg, fontFamily: FONTS.mono }}
              >
                Initialize Gateway
                <ArrowRight size={14} />
              </a>
              <a
                href="/"
                className="inline-flex items-center justify-center border px-5 py-3 text-[11px] uppercase tracking-[0.18em] no-underline"
                style={{ borderColor: COLORS.lineStrong, color: COLORS.ink, fontFamily: FONTS.mono }}
              >
                Back to homepage
              </a>
            </div>
          </div>
        </motion.section>
      </div>
    </main>
  );
}

export { SCAN_FIXTURE };
