import numpy as np


class DistributionMonitor:
    """Monitors feature distributions for OOD detection using KL divergence.

    Stores training feature distributions as histograms.
    At inference time, computes KL divergence between new features and training distribution.
    """

    def __init__(self, n_bins: int = 50, threshold: float = 0.5):
        self.n_bins = n_bins
        self.threshold = threshold
        self._distributions: dict[str, dict] = {}  # key -> {feature_name -> {edges, counts}}

    def _key(self, tenant_id: str, prediction_type: str) -> str:
        return f"{tenant_id}:{prediction_type}"

    def fit(
        self,
        tenant_id: str,
        prediction_type: str,
        feature_matrix: dict[str, list[float]],
    ) -> None:
        """Fit reference distributions from training data.

        feature_matrix: {"amount_cents": [100, 200, ...], "days_overdue": [1, 5, ...], ...}
        """
        key = self._key(tenant_id, prediction_type)
        distributions: dict[str, dict] = {}

        for feature_name, values in feature_matrix.items():
            arr = np.asarray(values, dtype=np.float64)
            counts, edges = np.histogram(arr, bins=self.n_bins)
            # Normalize to a probability distribution
            total = counts.sum()
            if total > 0:
                probs = counts.astype(np.float64) / total
            else:
                probs = np.ones_like(counts, dtype=np.float64) / len(counts)
            distributions[feature_name] = {"edges": edges, "probs": probs}

        self._distributions[key] = distributions

    def check(
        self,
        tenant_id: str,
        prediction_type: str,
        features: dict[str, float],
    ) -> dict:
        """Check if a feature vector is in-distribution.

        For each feature, looks up the reference probability of the bin
        the value falls into, then computes a KL-inspired divergence score:

            score = log(1 / q_bin) - H(ref)

        where q_bin is the (smoothed) reference probability of the point's bin
        and H(ref) is the entropy of the reference distribution. This yields
        ~0 for typical points and grows large for points in low-probability or
        out-of-range bins. The score is floored at 0.

        Returns: {"in_distribution": bool, "kl_divergence": float, "per_feature": {name: kl}}
        """
        key = self._key(tenant_id, prediction_type)
        ref = self._distributions.get(key)

        if ref is None:
            return {
                "in_distribution": True,
                "kl_divergence": 0.0,
                "per_feature": {},
            }

        per_feature: dict[str, float] = {}
        matched_features = 0

        for feature_name, value in features.items():
            if feature_name not in ref:
                continue

            edges = ref[feature_name]["edges"]
            ref_probs = ref[feature_name]["probs"]
            n_bins = len(ref_probs)

            # Smooth the reference to avoid log(0)
            eps = 1e-10
            q = ref_probs + eps
            q = q / q.sum()

            # Entropy of the reference distribution (baseline surprise)
            h_ref = -float(np.sum(q * np.log(q)))

            # Check if the value falls outside the histogram range entirely
            if value < edges[0] or value > edges[-1]:
                # Far out of range — assign maximum surprise.
                # Use the min-probability bin as a proxy.
                surprise = -np.log(q.min())
            else:
                # Find the bin for this value
                bin_idx = np.searchsorted(edges[1:], value, side="right")
                bin_idx = int(np.clip(bin_idx, 0, n_bins - 1))
                surprise = -np.log(q[bin_idx])

            # Score: how much more surprising than average (entropy)
            score = max(0.0, surprise - h_ref)
            per_feature[feature_name] = score
            matched_features += 1

        if matched_features == 0:
            return {
                "in_distribution": True,
                "kl_divergence": 0.0,
                "per_feature": per_feature,
            }

        avg_kl = sum(per_feature.values()) / matched_features

        return {
            "in_distribution": bool(avg_kl < self.threshold),
            "kl_divergence": float(avg_kl),
            "per_feature": per_feature,
        }

    def _kl_divergence(self, p: np.ndarray, q: np.ndarray) -> float:
        """Compute KL(p || q) with smoothing to avoid log(0)."""
        eps = 1e-10
        p_smooth = p + eps
        q_smooth = q + eps
        # Re-normalize after smoothing
        p_smooth = p_smooth / p_smooth.sum()
        q_smooth = q_smooth / q_smooth.sum()
        return float(np.sum(p_smooth * np.log(p_smooth / q_smooth)))


# Module-level singleton
distribution_monitor = DistributionMonitor()
