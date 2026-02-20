export const pricingPlans = [
  {
    id: "open",
    name: "Open Access",
    monthlyUsd: 0,
    settledFeePercent: 0,
    includes: [
      "All core primitives and docs",
      "Auth, policy, receipts, reversals, and verification flows",
      "Operator workflows and API surfaces",
      "Open iteration while platform matures"
    ]
  }
];

export const valueEventPricing = [
  "No platform fees during open buildout",
  "No settled volume fee during open buildout"
];

export function blendedMonthlyCost({ monthlyBaseUsd, settledVolumeUsd, settledFeePercent }) {
  if (!Number.isFinite(monthlyBaseUsd) || !Number.isFinite(settledVolumeUsd) || !Number.isFinite(settledFeePercent)) {
    return null;
  }
  const fee = settledVolumeUsd * (settledFeePercent / 100);
  return Math.round((monthlyBaseUsd + fee) * 100) / 100;
}
