from river.drift import ADWIN
from datetime import datetime, timezone


class DriftMonitor:
    """Monitors prediction residuals for distribution drift using ADWIN.

    Maintains one ADWIN instance per (model_id, prediction_type, tenant_id).
    """

    def __init__(self):
        self._monitors: dict[str, ADWIN] = {}
        self._drift_flags: dict[str, bool] = {}
        self._last_checked: dict[str, str] = {}

    def _key(self, model_id: str, prediction_type: str, tenant_id: str) -> str:
        return f"{tenant_id}:{model_id}:{prediction_type}"

    def update(
        self,
        model_id: str,
        prediction_type: str,
        tenant_id: str,
        predicted: float,
        actual: float,
    ) -> bool:
        """Feed a new prediction-outcome pair. Returns True if drift detected."""
        key = self._key(model_id, prediction_type, tenant_id)
        if key not in self._monitors:
            self._monitors[key] = ADWIN()
            self._drift_flags[key] = False

        residual = predicted - actual
        self._monitors[key].update(residual)
        self._drift_flags[key] = self._monitors[key].drift_detected
        self._last_checked[key] = datetime.now(timezone.utc).isoformat()
        return self._drift_flags[key]

    def get_status(self, model_id: str, prediction_type: str, tenant_id: str) -> dict:
        """Returns {"drift_detected": bool, "adwin_value": float, "last_checked": str}"""
        key = self._key(model_id, prediction_type, tenant_id)
        if key not in self._monitors:
            return {
                "drift_detected": False,
                "adwin_value": 0.0,
                "last_checked": datetime.now(timezone.utc).isoformat(),
            }
        return {
            "drift_detected": self._drift_flags.get(key, False),
            "adwin_value": self._monitors[key].estimation,
            "last_checked": self._last_checked.get(
                key, datetime.now(timezone.utc).isoformat()
            ),
        }

    def get_all_status(self, tenant_id: str) -> list[dict]:
        """Returns drift status for all monitored models for a tenant."""
        prefix = f"{tenant_id}:"
        results = []
        for key in self._monitors:
            if key.startswith(prefix):
                # key format: tenant_id:model_id:prediction_type
                parts = key[len(prefix) :].split(":", 1)
                model_id, prediction_type = parts[0], parts[1]
                results.append(
                    {
                        "model_id": model_id,
                        "prediction_type": prediction_type,
                        **self.get_status(model_id, prediction_type, tenant_id),
                    }
                )
        return results

    def rebuild_from_pairs(
        self,
        model_id: str,
        prediction_type: str,
        tenant_id: str,
        pairs: list[tuple[float, float]],
    ) -> None:
        """Rebuild ADWIN state from historical prediction-outcome pairs.
        Called on service restart."""
        key = self._key(model_id, prediction_type, tenant_id)
        self._monitors[key] = ADWIN()
        self._drift_flags[key] = False
        for predicted, actual in pairs:
            residual = predicted - actual
            self._monitors[key].update(residual)
            self._drift_flags[key] = self._monitors[key].drift_detected
        self._last_checked[key] = datetime.now(timezone.utc).isoformat()


# Module-level singleton
drift_monitor = DriftMonitor()


async def check_all_models(pool, tenant_id: str) -> list[dict]:
    """Query recent outcomes from DB and return drift status per model.

    Returns list of:
    {
        "model_id": str,
        "prediction_type": str,
        "drift_detected": bool,
        "adwin_value": float,
        "last_checked": str (ISO datetime)
    }
    """
    rows = await pool.fetch(
        """
        SELECT p.model_id, p.prediction_type, p.predicted_value, o.outcome_value
        FROM world_prediction_outcomes o
        JOIN world_predictions p ON p.id = o.prediction_id AND p.tenant_id = o.tenant_id
        WHERE o.tenant_id = $1
        ORDER BY o.outcome_at ASC
        """,
        tenant_id,
    )

    for row in rows:
        drift_monitor.update(
            model_id=row["model_id"],
            prediction_type=row["prediction_type"],
            tenant_id=tenant_id,
            predicted=float(row["predicted_value"]),
            actual=float(row["outcome_value"]),
        )

    return drift_monitor.get_all_status(tenant_id)
