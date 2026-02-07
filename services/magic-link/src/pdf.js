function pdfEscapeText(s) {
  return String(s ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function concatBuffers(buffers) {
  const total = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = Buffer.allocUnsafe(total);
  let off = 0;
  for (const b of buffers) {
    b.copy(out, off);
    off += b.length;
  }
  return out;
}

function buildPdfObjects(objs) {
  const header = Buffer.from("%PDF-1.4\n", "ascii");
  const parts = [header];
  const offsets = [0];
  let offset = header.length;

  for (let i = 0; i < objs.length; i += 1) {
    offsets.push(offset);
    const n = i + 1;
    const body = Buffer.isBuffer(objs[i]) ? objs[i] : Buffer.from(String(objs[i]), "utf8");
    const prefix = Buffer.from(`${n} 0 obj\n`, "ascii");
    const suffix = Buffer.from("\nendobj\n", "ascii");
    const chunk = concatBuffers([prefix, body, suffix]);
    parts.push(chunk);
    offset += chunk.length;
  }

  const xrefStart = offset;
  const xrefLines = [];
  xrefLines.push("xref\n");
  xrefLines.push(`0 ${objs.length + 1}\n`);
  xrefLines.push("0000000000 65535 f \n");
  for (let i = 1; i < offsets.length; i += 1) {
    const off = String(offsets[i]).padStart(10, "0");
    xrefLines.push(`${off} 00000 n \n`);
  }

  const xref = Buffer.from(xrefLines.join(""), "ascii");
  parts.push(xref);
  offset += xref.length;

  const trailer = Buffer.from(
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    "ascii"
  );
  parts.push(trailer);
  return concatBuffers(parts);
}

function formatMoneyFromCentsString({ currency, cents }) {
  const cur = String(currency ?? "").trim() || "UNK";
  const raw = String(cents ?? "").trim();
  if (!/^[0-9]+$/.test(raw)) return `${cur} ${raw}`;
  if (cur === "USD") {
    const padded = raw.padStart(3, "0");
    const dollars = padded.slice(0, -2);
    const centsPart = padded.slice(-2);
    return `$${dollars}.${centsPart}`;
  }
  return `${cur} ${raw} cents`;
}

export function buildInvoiceSummaryPdf({ title, lines }) {
  const safeTitle = String(title ?? "Invoice Summary (non-normative)");
  const safeLines = Array.isArray(lines) ? lines.map((l) => String(l ?? "")) : [];

  const pageWidth = 612;
  const pageHeight = 792;
  const fontSize = 11;
  const leading = 14;
  const startX = 72;
  const startY = 720;

  const content = [];
  content.push("BT");
  content.push(`/F1 ${fontSize} Tf`);
  content.push(`${leading} TL`);
  content.push(`${startX} ${startY} Td`);
  content.push(`(${pdfEscapeText(safeTitle)}) Tj`);
  content.push("T*");
  for (const line of safeLines) {
    content.push(`(${pdfEscapeText(line)}) Tj`);
    content.push("T*");
  }
  content.push("ET");
  const contentStream = Buffer.from(content.join("\n") + "\n", "ascii");

  const obj1 = "<< /Type /Catalog /Pages 2 0 R >>";
  const obj2 = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  const obj3 = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`;
  const obj4 = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const obj5 = concatBuffers([Buffer.from(`<< /Length ${contentStream.length} >>\nstream\n`, "ascii"), contentStream, Buffer.from("endstream", "ascii")]);

  return buildPdfObjects([obj1, obj2, obj3, obj4, obj5]);
}

export function buildInvoiceSummaryPdfFromClaim({ claim, verification, trust }) {
  const invoiceId = typeof claim?.invoiceId === "string" ? claim.invoiceId : "";
  const tenantId = typeof claim?.tenantId === "string" ? claim.tenantId : "";
  const currency = typeof claim?.currency === "string" ? claim.currency : "UNK";
  const totalCents = typeof claim?.totalCents === "string" ? claim.totalCents : "";
  const createdAt = typeof claim?.createdAt === "string" ? claim.createdAt : "";

  const status = verification?.status ?? "unknown";
  const bundleSha256 = verification?.zipSha256 ?? "";
  const manifestHash = verification?.manifestHash ?? "";
  const mode = verification?.mode ?? "";

  const trustLine = trust?.configured
    ? `Trust roots: ${Array.isArray(trust.keyIds) ? trust.keyIds.join(", ") : ""}`
    : "Trust roots: none configured";

  const lines = [];
  if (invoiceId) lines.push(`Invoice: ${invoiceId}`);
  if (tenantId) lines.push(`Tenant: ${tenantId}`);
  if (createdAt) lines.push(`Created: ${createdAt}`);
  if (totalCents) lines.push(`Total: ${formatMoneyFromCentsString({ currency, cents: totalCents })}`);
  if (mode) lines.push(`Mode: ${mode}`);
  lines.push(`Status: ${status}`);
  if (bundleSha256) lines.push(`Bundle SHA-256: ${bundleSha256}`);
  if (manifestHash) lines.push(`Manifest hash: ${manifestHash}`);
  lines.push(trustLine);

  const items = Array.isArray(claim?.lineItems) ? claim.lineItems : [];
  if (items.length) {
    lines.push("");
    lines.push("Line items:");
    for (const it of items.slice(0, 200)) {
      const code = typeof it?.code === "string" ? it.code : "";
      const qty = typeof it?.quantity === "string" ? it.quantity : "";
      const unit = typeof it?.unitPriceCents === "string" ? it.unitPriceCents : "";
      const amt = typeof it?.amountCents === "string" ? it.amountCents : "";
      const row = [code && `code=${code}`, qty && `qty=${qty}`, unit && `unitCents=${unit}`, amt && `amountCents=${amt}`].filter(Boolean).join(" ");
      if (row) lines.push(`- ${row}`);
    }
    if (items.length > 200) lines.push(`… (${items.length - 200} more)`);
  }

  return buildInvoiceSummaryPdf({ title: "Invoice Summary (non-normative)", lines });
}

