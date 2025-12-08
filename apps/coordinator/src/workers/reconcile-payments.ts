import pino from "pino";
import { PaymentService } from "../services/payment-service.js";

const logger = pino({ name: "reconcile-payments" });

async function main() {
  try {
    const service = new PaymentService();
    const report = await service.reconcile();
    logger.info(
      {
        checkedSince: report.checkedSince,
        checkedUntil: report.checkedUntil,
        chargesWithoutCredit: report.chargesWithoutCredit?.length || 0,
        creditedWithoutCharge: report.creditedWithoutCharge?.length || 0,
        amountMismatch: report.amountMismatch?.length || 0,
      },
      "stripe_reconcile_report"
    );

    if (report.chargesWithoutCredit?.length) {
      logger.warn({ refs: report.chargesWithoutCredit }, "charges_without_credit");
    }
    if (report.creditedWithoutCharge?.length) {
      logger.warn({ refs: report.creditedWithoutCharge }, "credited_without_charge");
    }
    if (report.amountMismatch?.length) {
      logger.warn({ refs: report.amountMismatch }, "amount_mismatch");
    }
  } catch (err) {
    logger.error({ err }, "reconcile_failed");
    process.exitCode = 1;
  }
}

main();
