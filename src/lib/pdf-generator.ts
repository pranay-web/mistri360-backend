import PDFDocument from "pdfkit";
import type { Response } from "express";
import { readFileSync } from "fs";
import { join } from "path";

let _logoBuffer: Buffer | null = null;
function getLogoBuffer(): Buffer | null {
  if (_logoBuffer) return _logoBuffer;
  try { _logoBuffer = readFileSync(join(process.cwd(), "assets", "pfs-logo.png")); } catch { /* no logo */ }
  return _logoBuffer;
}

let _brandLogoBuffer: Buffer | null = null;
function getBrandLogoBuffer(): Buffer | null {
  if (_brandLogoBuffer) return _brandLogoBuffer;
  try { _brandLogoBuffer = readFileSync(join(__dirname, "assets", "mistri360-logo.png")); } catch { /* no logo */ }
  return _brandLogoBuffer;
}

function drawProductBrand(doc: PDFKit.PDFDocument, x: number, y: number, width: number) {
  const logo = getBrandLogoBuffer();
  if (logo) {
    doc.image(logo, x, y + 4, { fit: [width, 34], valign: "center" });
  } else {
    doc.fillColor("#58B936").font("Helvetica-Bold").fontSize(15).text("mistri360", x, y + 10);
  }
}

interface Part {
  vendorName: string;
  partDescription: string;
  partNumber?: string | null;
  quantity: string;
  unitCost: string;
  totalCost: string;
}

interface Labour {
  mechanicName?: string | null;
  hoursWorked?: string | null;
  labourType: string;
  startTime: string | Date;
  notes?: string | null;
}

interface StatusHistoryItem {
  fromStatus?: string | null;
  toStatus: string;
  changedByName?: string | null;
  notes?: string | null;
  createdAt: string | Date;
}

interface Photo {
  photoType: string;
  caption?: string | null;
  fileKey: string;
}

interface Signature {
  signatureType: string;
  signedByName?: string | null;
  signedAt: string | Date;
  signatureImageKey: string;
}

interface ChecklistItem {
  category: string;
  itemDescription: string;
  status?: string | null;
  notes?: string | null;
  measurement?: string | null;
  measurementUnit?: string | null;
  photoFileKey?: string | null;
  respondedByName?: string | null;
  respondedAt?: string | Date | null;
}

interface Checklist {
  checklistType: string;
  submittedByName?: string | null;
  submittedAt?: string | Date | null;
  isLocked: boolean;
  completedCount: number;
  totalCount: number;
  items: ChecklistItem[];
}

export interface WorkOrderPdfData {
  woNumber: string;
  status: string;
  priority: string;
  workOrderType: string;
  vehicleUnitNumber?: string | null;
  vehicleType?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  assignedMechanicName?: string | null;
  createdByName?: string | null;
  description?: string | null;
  internalNotes?: string | null;
  odometerAtService?: number | null;
  engineHoursAtService?: string | null;
  scheduledDate?: string | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  releasedAt?: string | Date | null;
  totalLabourHours?: string | null;
  totalPartsCost?: string | null;
  createdAt: string | Date;
  parts: Part[];
  labour: Labour[];
  statusHistory: StatusHistoryItem[];
  photos: Photo[];
  signatures: Signature[];
  checklist?: Checklist | null;
}

const COLORS = {
  navy: "#0A1628",
  navyLight: "#1A2744",
  red: "#DC2626",
  white: "#FFFFFF",
  lightGray: "#F3F4F6",
  gray: "#6B7280",
  darkGray: "#374151",
  border: "#E5E7EB",
};

function fmt(val: string | Date | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  return isNaN(d.getTime()) ? String(val) : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(val: string | Date | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  return isNaN(d.getTime()) ? String(val) : d.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function generateWorkOrderPdf(data: WorkOrderPdfData, res: Response, companyName = "Company Workspace") {
  const doc = new PDFDocument({ margin: 40, size: "LETTER", bufferPages: true });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="WO-${data.woNumber}.pdf"`
  );
  doc.pipe(res);

  const W = doc.page.width - 80; // usable width

  // ── Report title block ──────────────────────────────────────────────────────
  drawProductBrand(doc, 40, 49, 132);
  doc.fillColor("#334155").fontSize(8).font("Helvetica-Bold").text(companyName, 0, 53, { align: "right" });

  doc
    .fillColor("#0F172A")
    .fontSize(20)
    .font("Helvetica-Bold")
    .text(data.woNumber, 0, 78, { align: "right" })
    .fontSize(9)
    .font("Helvetica")
    .text("WORK ORDER REPORT", 0, 101, { align: "right" })
    .fillColor("#64748B")
    .text(`Generated ${new Date().toLocaleDateString("en-CA")}`, 0, 113, { align: "right" });

  // Status pill
  const pillColor = {
    completed: "#16A34A",
    released: "#16A34A",
    qc_review: "#D97706",
    approval_required: "#D97706",
    repair_in_progress: "#2563EB",
    out_of_service: "#DC2626",
    draft: "#6B7280",
  }[data.status] ?? "#6B7280";

  doc
    .rect(40, 112, 120, 20)
    .fill(pillColor)
    .fillColor(COLORS.white)
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(statusLabel(data.status), 40, 117, { width: 120, align: "center" });

  const prioColors: Record<string, string> = { critical: "#DC2626", high: "#D97706", normal: "#2563EB", low: "#6B7280" };
  doc
    .rect(170, 112, 80, 20)
    .fill(prioColors[data.priority] ?? "#6B7280")
    .fillColor(COLORS.white)
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(statusLabel(data.priority) + " Priority", 170, 117, { width: 80, align: "center" });

  doc.moveDown(1);

  // ── Section helper ──────────────────────────────────────────────────────────
  let y = 148;

  function sectionTitle(title: string) {
    doc
      .rect(40, y, W, 20)
      .fill(COLORS.navyLight)
      .fillColor(COLORS.white)
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(title, 48, y + 5);
    y += 24;
  }

  function row(label: string, value: string, col2 = false) {
    const x = col2 ? 40 + W / 2 : 40;
    const w = W / 2 - 4;
    if (!col2) {
      doc
        .rect(40, y, W, 18)
        .fill(COLORS.lightGray);
    }
    doc
      .fillColor(COLORS.gray)
      .fontSize(8)
      .font("Helvetica")
      .text(label, x + 4, y + 3, { width: 100 })
      .fillColor(COLORS.darkGray)
      .fontSize(9)
      .font("Helvetica-Bold")
      .text(value || "—", x + 108, y + 3, { width: w - 112 });
    if (!col2) y += 20;
  }

  function rowPair(l1: string, v1: string, l2: string, v2: string) {
    doc.rect(40, y, W, 18).fill(COLORS.lightGray);
    doc
      .fillColor(COLORS.gray).fontSize(8).font("Helvetica")
      .text(l1, 44, y + 3, { width: 100 })
      .fillColor(COLORS.darkGray).fontSize(9).font("Helvetica-Bold")
      .text(v1 || "—", 148, y + 3, { width: W / 2 - 112 })
      .fillColor(COLORS.gray).fontSize(8).font("Helvetica")
      .text(l2, 44 + W / 2, y + 3, { width: 100 })
      .fillColor(COLORS.darkGray).fontSize(9).font("Helvetica-Bold")
      .text(v2 || "—", 148 + W / 2, y + 3, { width: W / 2 - 112 });
    y += 20;
  }

  function checkPageBreak(neededHeight = 80) {
    if (y + neededHeight > doc.page.height - 60) {
      doc.addPage();
      y = 40;
    }
  }

  // ── Vehicle & Job Info ───────────────────────────────────────────────────────
  sectionTitle("Vehicle & Job Information");
  rowPair("Unit Number", data.vehicleUnitNumber ?? "—", "Type", statusLabel(data.vehicleType ?? "—"));
  rowPair("Year / Make / Model", [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(" ") || "—", "Work Order Type", statusLabel(data.workOrderType));
  rowPair("Assigned Mechanic", data.assignedMechanicName ?? "—", "Created By", data.createdByName ?? "—");
  rowPair("Scheduled Date", fmt(data.scheduledDate), "Started", fmtDateTime(data.startedAt));
  rowPair("Completed", fmtDateTime(data.completedAt), "Released", fmtDateTime(data.releasedAt));
  rowPair("Odometer at Service", data.odometerAtService ? `${data.odometerAtService.toLocaleString()} km` : "—", "Engine Hours", data.engineHoursAtService ?? "—");
  y += 6;

  // ── Description ─────────────────────────────────────────────────────────────
  if (data.description) {
    checkPageBreak(60);
    sectionTitle("Job Description");
    doc
      .rect(40, y, W, 14)
      .fill(COLORS.lightGray)
      .fillColor(COLORS.darkGray)
      .fontSize(9)
      .font("Helvetica")
      .text(data.description, 44, y + 2, { width: W - 8 });
    y += Math.max(18, doc.heightOfString(data.description, { width: W - 8 }) + 6);
    y += 6;
  }

  // ── Parts ────────────────────────────────────────────────────────────────────
  if (data.parts.length > 0) {
    checkPageBreak(100);
    sectionTitle(`Parts Used (${data.parts.length})`);

    // Table header
    doc.rect(40, y, W, 16).fill(COLORS.navyLight);
    const colW = [W * 0.32, W * 0.22, W * 0.1, W * 0.12, W * 0.12, W * 0.12];
    const colX = [40, 40 + colW[0], 40 + colW[0] + colW[1], 40 + colW[0] + colW[1] + colW[2], 40 + colW[0] + colW[1] + colW[2] + colW[3], 40 + colW[0] + colW[1] + colW[2] + colW[3] + colW[4]];
    const headers = ["Part Description", "Vendor", "Part #", "Qty", "Unit Cost", "Total"];

    headers.forEach((h, i) => {
      doc
        .fillColor(COLORS.white)
        .fontSize(8)
        .font("Helvetica-Bold")
        .text(h, colX[i] + 2, y + 4, { width: colW[i] - 4, align: i >= 3 ? "right" : "left" });
    });
    y += 18;

    data.parts.forEach((p, idx) => {
      checkPageBreak(20);
      doc.rect(40, y, W, 16).fill(idx % 2 === 0 ? COLORS.white : COLORS.lightGray);
      const vals = [p.partDescription, p.vendorName, p.partNumber ?? "—", p.quantity, `$${parseFloat(p.unitCost).toFixed(2)}`, `$${parseFloat(p.totalCost).toFixed(2)}`];
      vals.forEach((v, i) => {
        doc
          .fillColor(COLORS.darkGray)
          .fontSize(8)
          .font("Helvetica")
          .text(v, colX[i] + 2, y + 4, { width: colW[i] - 4, align: i >= 3 ? "right" : "left" });
      });
      y += 18;
    });

    const total = data.parts.reduce((s, p) => s + parseFloat(p.totalCost || "0"), 0);
    doc
      .rect(40, y, W, 18)
      .fill(COLORS.navyLight)
      .fillColor(COLORS.white)
      .fontSize(9)
      .font("Helvetica-Bold")
      .text(`Total Parts Cost: $${total.toFixed(2)}`, 40, y + 5, { width: W - 4, align: "right" });
    y += 22;
    y += 6;
  }

  // ── Labour ───────────────────────────────────────────────────────────────────
  if (data.labour.length > 0) {
    checkPageBreak(80);
    sectionTitle(`Labour Entries (${data.labour.length})`);

    doc.rect(40, y, W, 16).fill(COLORS.navyLight);
    const lColW = [W * 0.3, W * 0.2, W * 0.15, W * 0.15, W * 0.2];
    const lColX = [40, 40 + lColW[0], 40 + lColW[0] + lColW[1], 40 + lColW[0] + lColW[1] + lColW[2], 40 + lColW[0] + lColW[1] + lColW[2] + lColW[3]];
    ["Mechanic", "Date", "Hours", "Type", "Notes"].forEach((h, i) => {
      doc.fillColor(COLORS.white).fontSize(8).font("Helvetica-Bold")
        .text(h, lColX[i] + 2, y + 4, { width: lColW[i] - 4 });
    });
    y += 18;

    let totalHours = 0;
    data.labour.forEach((l, idx) => {
      checkPageBreak(20);
      const hrs = parseFloat(l.hoursWorked ?? "0");
      totalHours += hrs;
      doc.rect(40, y, W, 16).fill(idx % 2 === 0 ? COLORS.white : COLORS.lightGray);
      [l.mechanicName ?? "—", fmt(l.startTime), `${hrs.toFixed(2)} hrs`, statusLabel(l.labourType), l.notes ?? ""].forEach((v, i) => {
        doc.fillColor(COLORS.darkGray).fontSize(8).font("Helvetica")
          .text(v, lColX[i] + 2, y + 4, { width: lColW[i] - 4 });
      });
      y += 18;
    });

    doc.rect(40, y, W, 18).fill(COLORS.navyLight)
      .fillColor(COLORS.white).fontSize(9).font("Helvetica-Bold")
      .text(`Total Labour: ${totalHours.toFixed(2)} hrs`, 40, y + 5, { width: W - 4, align: "right" });
    y += 22;
    y += 6;
  }

  // ── Digital inspection checklist ────────────────────────────────────────────
  if (data.checklist) {
    const checklist = data.checklist;
    checkPageBreak(130);
    sectionTitle(`Digital Inspection Checklist — ${statusLabel(checklist.checklistType)}`);

    const defectStatuses = new Set(["repair_required", "major_defect", "out_of_service"]);
    const attentionCount = checklist.items.filter((item) => item.status === "monitor").length;
    const defectCount = checklist.items.filter((item) => item.status && defectStatuses.has(item.status)).length;
    const completion = checklist.totalCount > 0
      ? Math.round((checklist.completedCount / checklist.totalCount) * 100)
      : 0;

    doc.rect(40, y, W, 48).fill("#F8FAFC").strokeColor(COLORS.border).lineWidth(0.5).stroke();
    const summary = [
      ["Completion", `${checklist.completedCount} / ${checklist.totalCount} (${completion}%)`],
      ["Submitted By", checklist.submittedByName ?? "Not submitted"],
      ["Submitted", fmtDateTime(checklist.submittedAt)],
      ["Review", defectCount > 0 ? `${defectCount} defect${defectCount === 1 ? "" : "s"}` : attentionCount > 0 ? `${attentionCount} monitor item${attentionCount === 1 ? "" : "s"}` : "No defects reported"],
    ];
    summary.forEach(([label, value], index) => {
      const x = 48 + (index % 2) * (W / 2);
      const rowY = y + 8 + Math.floor(index / 2) * 20;
      doc.fillColor(COLORS.gray).font("Helvetica").fontSize(7).text(label.toUpperCase(), x, rowY, { width: 90 });
      doc.fillColor(COLORS.darkGray).font("Helvetica-Bold").fontSize(8).text(value, x + 92, rowY, { width: W / 2 - 108 });
    });
    y += 58;

    let currentCategory = "";
    checklist.items.forEach((item) => {
      if (item.category !== currentCategory) {
        checkPageBreak(52);
        currentCategory = item.category;
        doc.rect(40, y, W, 18).fill("#E8EDF5");
        doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.5)
          .text(currentCategory.toUpperCase(), 48, y + 5, { width: W - 16 });
        y += 22;
      }

      const result = item.status ? statusLabel(item.status) : "Not completed";
      const resultColor: Record<string, string> = {
        pass: "#15803D",
        monitor: "#A16207",
        repair_required: "#C2410C",
        major_defect: "#B91C1C",
        out_of_service: "#991B1B",
        n_a: "#64748B",
      };
      const measurement = item.measurement
        ? `${item.measurement}${item.measurementUnit ? ` ${item.measurementUnit}` : ""}`
        : null;
      const detailParts = [
        measurement ? `Measurement: ${measurement}` : null,
        item.notes ? `Notes: ${item.notes}` : null,
        item.respondedByName ? `Inspected by ${item.respondedByName}${item.respondedAt ? ` • ${fmtDateTime(item.respondedAt)}` : ""}` : null,
        item.photoFileKey ? "Photo attached" : null,
      ].filter(Boolean) as string[];
      const detailText = detailParts.join("   |   ");
      const detailHeight = detailText
        ? doc.heightOfString(detailText, { width: W - 24, lineGap: 1 }) + 7
        : 0;
      const itemHeight = Math.max(24, 22 + detailHeight);
      checkPageBreak(itemHeight + 4);

      doc.rect(40, y, W, itemHeight).fill("#FFFFFF").strokeColor(COLORS.border).lineWidth(0.45).stroke();
      doc.fillColor(COLORS.darkGray).font("Helvetica-Bold").fontSize(8.5)
        .text(item.itemDescription, 48, y + 7, { width: W - 174 });
      doc.fillColor(resultColor[item.status ?? ""] ?? COLORS.gray).font("Helvetica-Bold").fontSize(8)
        .text(result.toUpperCase(), 40 + W - 120, y + 7, { width: 112, align: "right" });
      if (detailText) {
        doc.fillColor(COLORS.gray).font("Helvetica").fontSize(7.5)
          .text(detailText, 48, y + 22, { width: W - 24, lineGap: 1 });
      }
      y += itemHeight + 4;
    });
    y += 8;
  }

  // ── Photos ───────────────────────────────────────────────────────────────────
  if (data.photos.length > 0) {
    checkPageBreak(40);
    sectionTitle(`Photos (${data.photos.length})`);
    doc.rect(40, y, W, 16).fill(COLORS.lightGray)
      .fillColor(COLORS.gray).fontSize(8).font("Helvetica")
      .text("Photos are attached as digital records. Storage keys are listed below for reference.", 44, y + 4, { width: W - 8 });
    y += 20;

    data.photos.forEach((p, idx) => {
      checkPageBreak(16);
      doc.rect(40, y, W, 14).fill(idx % 2 === 0 ? COLORS.white : COLORS.lightGray)
        .fillColor(COLORS.darkGray).fontSize(8).font("Helvetica-Bold")
        .text(statusLabel(p.photoType), 44, y + 3, { width: 80 })
        .font("Helvetica").fillColor(COLORS.gray)
        .text(p.caption ?? "No caption", 128, y + 3, { width: 200 })
        .fillColor(COLORS.gray)
        .text(p.fileKey, 332, y + 3, { width: W - 296 });
      y += 16;
    });
    y += 6;
  }

  // ── Signatures ───────────────────────────────────────────────────────────────
  if (data.signatures.length > 0) {
    checkPageBreak(60);
    sectionTitle(`Signatures (${data.signatures.length})`);

    data.signatures.forEach((sig) => {
      checkPageBreak(50);
      doc.rect(40, y, W, 16).fill(COLORS.lightGray)
        .fillColor(COLORS.darkGray).fontSize(9).font("Helvetica-Bold")
        .text(`${statusLabel(sig.signatureType)} Signature`, 44, y + 4)
        .font("Helvetica").fillColor(COLORS.gray).fontSize(8)
        .text(`Signed by ${sig.signedByName ?? "Unknown"} on ${fmtDateTime(sig.signedAt)}`, 44 + 160, y + 5, { width: W - 168 });
      y += 20;
    });
    y += 6;
  }

  // ── Status History ───────────────────────────────────────────────────────────
  if (data.statusHistory.length > 0) {
    checkPageBreak(100);
    sectionTitle("Status History");

    doc.rect(40, y, W, 16).fill(COLORS.navyLight);
    ["Timestamp", "From", "To", "Changed By", "Notes"].forEach((h, i) => {
      const xs = [40, 40 + W * 0.22, 40 + W * 0.42, 40 + W * 0.58, 40 + W * 0.76];
      const ws = [W * 0.22, W * 0.2, W * 0.16, W * 0.18, W * 0.24];
      doc.fillColor(COLORS.white).fontSize(8).font("Helvetica-Bold")
        .text(h, xs[i] + 2, y + 4, { width: ws[i] - 4 });
    });
    y += 18;

    data.statusHistory.forEach((s, idx) => {
      checkPageBreak(18);
      doc.rect(40, y, W, 16).fill(idx % 2 === 0 ? COLORS.white : COLORS.lightGray);
      const xs = [40, 40 + W * 0.22, 40 + W * 0.42, 40 + W * 0.58, 40 + W * 0.76];
      const ws = [W * 0.22, W * 0.2, W * 0.16, W * 0.18, W * 0.24];
      [fmtDateTime(s.createdAt), statusLabel(s.fromStatus ?? "—"), statusLabel(s.toStatus), s.changedByName ?? "—", s.notes ?? ""].forEach((v, i) => {
        doc.fillColor(COLORS.darkGray).fontSize(8).font("Helvetica")
          .text(v, xs[i] + 2, y + 4, { width: ws[i] - 4 });
      });
      y += 18;
    });
    y += 6;
  }

  // ── Footer on every page ─────────────────────────────────────────────────────
  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page);
    // Keep footer above PDFKit's bottom margin so writing it never creates
    // an extra page while iterating buffered pages.
    const footerY = doc.page.height - 48;
    doc.moveTo(40, footerY - 4).lineTo(40 + W, footerY - 4).strokeColor("#CBD5E1").lineWidth(0.5).stroke();
    doc.fillColor("#64748B").fontSize(7).font("Helvetica")
      .text(`mistri360  •  ${companyName}  •  ${data.woNumber}`, 40, footerY + 2, { width: W / 2, height: 10, align: "left", lineBreak: false })
      .text(`CONFIDENTIAL  •  Page ${page + 1} of ${pages.count}`, 40 + W / 2, footerY + 2, { width: W / 2, height: 10, align: "right", lineBreak: false });
  }

  doc.end();
}

interface EstimatePdfData {
  estimateNumber: string;
  title: string;
  status: string;
  customerName: string;
  customerCode?: string | null;
  contactName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerProvince?: string | null;
  customerPostalCode?: string | null;
  vehicleUnitNumber?: string | null;
  vehicleDescription?: string | null;
  validUntil?: string | Date | null;
  notes?: string | null;
  terms?: string | null;
  taxRate: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  createdAt: string | Date;
  lineItems: Array<{
    lineType: string;
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
  }>;
}

export function generateEstimatePdf(data: EstimatePdfData, res: Response, companyName = "Company Workspace") {
  const doc = new PDFDocument({ margin: 44, size: "LETTER", bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${data.estimateNumber}.pdf"`);
  doc.pipe(res);
  generateEstimatePdfContent(doc, data, companyName);
  doc.end();
}

export interface InvoicePdfData {
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  customerCode?: string | null;
  contactName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerProvince?: string | null;
  customerPostalCode?: string | null;
  vehicleUnitNumber?: string | null;
  vehicleDescription?: string | null;
  issueDate: string | Date;
  dueDate: string | Date;
  status: string;
  notes?: string | null;
  terms?: string | null;
  taxRate: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  amountPaid: string;
  paidAt?: string | Date | null;
  paymentMethod?: string | null;
  createdAt: string | Date;
  lineItems: Array<{
    lineType: string;
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
  }>;
}

export function generateInvoicePdf(data: InvoicePdfData, res: Response, companyName = "Company Workspace") {
  const doc = new PDFDocument({ margin: 44, size: "LETTER", bufferPages: true });
  const W = doc.page.width - 88;
  const navy = "#0A1628";
  const gold = "#D89B2B";
  const slate = "#334155";
  const muted = "#64748B";
  const border = "#DCE3EA";
  const green = "#15803D";
  const red = "#B91C1C";
  const yellow = "#A16207";
  let y = 44;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${data.invoiceNumber}.pdf"`);
  doc.pipe(res);

  const pageBreak = (height: number) => {
    if (y + height > doc.page.height - 64) {
      doc.addPage();
      y = 48;
    }
  };

  drawProductBrand(doc, 44, 49, 142);
  doc.fillColor(slate).font("Helvetica-Bold").fontSize(9).text(companyName, 0, 55, { align: "right" });
  doc.fillColor(muted).font("Helvetica").fontSize(7).text("PROFESSIONAL INVOICE", 0, 72, { align: "right" });

  y = 108;
  doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(23).text("INVOICE", 44, y);
  doc.fillColor(navy).fontSize(13).text(data.invoiceNumber, 0, y + 3, { align: "right" });
  y += 38;

  const pillWidth = 88;
  const statusColors: Record<string, string> = {
    draft: "#64748B",
    sent: "#2563EB",
    paid: green,
    overdue: red,
    void: "#A3A3A3",
  };
  doc.roundedRect(44, y, pillWidth, 20, 3).fill(statusColors[data.status] ?? muted);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8)
    .text(statusLabel(data.status).toUpperCase(), 44, y + 6, { width: pillWidth, align: "center" });
  doc.fillColor(muted).font("Helvetica").fontSize(8)
    .text(`Issued ${fmt(data.issueDate)}   •   Due ${fmt(data.dueDate)}`, 150, y + 6, { width: W - 106, align: "right" });
  y += 38;

  const boxW = (W - 14) / 2;
  doc.roundedRect(44, y, boxW, 112, 4).fillAndStroke("#F8FAFC", border);
  doc.fillColor(muted).font("Helvetica-Bold").fontSize(7).text("BILL TO", 56, y + 13);
  doc.fillColor(navy).fontSize(12).text(data.customerName, 56, y + 29, { width: boxW - 24 });
  const customerLines = [
    data.contactName,
    data.customerAddress,
    [data.customerCity, data.customerProvince, data.customerPostalCode].filter(Boolean).join(", "),
    data.customerEmail,
    data.customerPhone,
  ].filter(Boolean) as string[];
  doc.fillColor(muted).font("Helvetica").fontSize(8).text(customerLines.join("\n"), 56, y + 49, { width: boxW - 24, lineGap: 2 });

  const rightX = 44 + boxW + 14;
  doc.roundedRect(rightX, y, boxW, 112, 4).fillAndStroke("#F8FAFC", border);
  doc.fillColor(muted).font("Helvetica-Bold").fontSize(7).text("INVOICE DETAILS", rightX + 12, y + 13);
  doc.fillColor(navy).fontSize(11).text(data.invoiceNumber, rightX + 12, y + 29, { width: boxW - 24 });
  doc.fillColor(muted).font("Helvetica").fontSize(8)
    .text("Vehicle", rightX + 12, y + 60)
    .fillColor(slate).font("Helvetica-Bold")
    .text(data.vehicleUnitNumber ?? data.vehicleDescription ?? "Customer vehicle", rightX + 72, y + 60, { width: boxW - 84 });
  y += 132;

  pageBreak(90);
  doc.rect(44, y, W, 22).fill("#E8EDF5");
  const cols = [W * 0.12, W * 0.48, W * 0.11, W * 0.14, W * 0.15];
  const xs = [44, 44 + cols[0], 44 + cols[0] + cols[1], 44 + cols[0] + cols[1] + cols[2], 44 + cols[0] + cols[1] + cols[2] + cols[3]];
  ["Type", "Description", "Qty", "Unit Price", "Amount"].forEach((heading, index) => {
    doc.fillColor(slate).font("Helvetica-Bold").fontSize(7.5)
      .text(heading.toUpperCase(), xs[index] + 6, y + 7, { width: cols[index] - 12, align: index >= 2 ? "right" : "left" });
  });
  y += 24;

  if (data.lineItems.length === 0) {
    doc.rect(44, y, W, 42).fill("#FFFFFF").strokeColor(border).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(9).text("No invoice line items have been added.", 56, y + 16);
    y += 48;
  } else {
    data.lineItems.forEach((line, index) => {
      const descriptionHeight = doc.heightOfString(line.description, { width: cols[1] - 12, lineGap: 1 });
      const rowHeight = Math.max(28, descriptionHeight + 14);
      pageBreak(rowHeight + 4);
      doc.rect(44, y, W, rowHeight).fill(index % 2 ? "#F8FAFC" : "#FFFFFF").strokeColor(border).lineWidth(0.35).stroke();
      const values = [
        statusLabel(line.lineType),
        line.description,
        Number(line.quantity).toLocaleString("en-CA", { maximumFractionDigits: 2 }),
        `$${Number(line.unitPrice).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`,
        `$${Number(line.lineTotal).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`,
      ];
      values.forEach((value, column) => {
        doc.fillColor(column === 4 ? navy : slate).font(column === 4 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
          .text(value, xs[column] + 6, y + 8, { width: cols[column] - 12, align: column >= 2 ? "right" : "left", lineGap: 1 });
      });
      y += rowHeight;
    });
  }

  pageBreak(140);
  const totalsX = 44 + W * 0.58;
  y += 10;
  [["Subtotal", data.subtotal], [`Tax (${Number(data.taxRate).toFixed(2)}%)`, data.taxAmount]].forEach(([label, value]) => {
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(label, totalsX, y, { width: W * 0.2 });
    doc.fillColor(slate).font("Helvetica-Bold").text(`$${Number(value).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`, totalsX + W * 0.2, y, { width: W * 0.22, align: "right" });
    y += 22;
  });
  doc.moveTo(totalsX, y).lineTo(44 + W, y).strokeColor(navy).lineWidth(1.2).stroke();
  y += 10;
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(12).text("INVOICE TOTAL", totalsX, y);
  doc.fontSize(14).text(`$${Number(data.total).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`, totalsX + W * 0.2, y - 2, { width: W * 0.22, align: "right" });
  y += 26;

  if (data.status === "paid" && data.paidAt) {
    const paidText = `PAID on ${fmtDateTime(data.paidAt)}${data.paymentMethod ? ` via ${data.paymentMethod}` : ""}`;
    doc.fillColor(green).font("Helvetica-Bold").fontSize(8).text(paidText, totalsX, y, { width: W * 0.42, align: "right" });
  }
  y += 16;

  for (const [title, text] of [["Notes", data.notes], ["Terms & Conditions", data.terms]] as const) {
    if (!text) continue;
    const height = doc.heightOfString(text, { width: W - 24, lineGap: 2 }) + 38;
    pageBreak(height);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(title.toUpperCase(), 44, y);
    y += 17;
    doc.roundedRect(44, y, W, height - 24, 3).fillAndStroke("#F8FAFC", border);
    doc.fillColor(slate).font("Helvetica").fontSize(8.5).text(text, 56, y + 10, { width: W - 24, lineGap: 2 });
    y += height - 12;
  }

  pageBreak(82);
  y += 8;
  doc.fillColor(muted).font("Helvetica").fontSize(8)
    .text("Thank you for your business. Payment is due by the date specified above. Please include the invoice number with your payment.", 44, y, { width: W });

  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page);
    const footerY = doc.page.height - 48;
    doc.moveTo(44, footerY - 4).lineTo(44 + W, footerY - 4).strokeColor(border).lineWidth(0.5).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(7)
      .text(`mistri360  •  ${companyName}  •  ${data.invoiceNumber}`, 44, footerY + 2, { width: W / 2, height: 10, lineBreak: false })
      .text(`INVOICE  •  Page ${page + 1} of ${pages.count}`, 44 + W / 2, footerY + 2, { width: W / 2, height: 10, align: "right", lineBreak: false });
  }
  doc.end();
}

// Generate estimate PDF as a Buffer for email attachments
export async function generateEstimatePdfAsBuffer(data: EstimatePdfData, companyName = "Company Workspace"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 44, size: "LETTER", bufferPages: true });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Create a mock response to use the same header logic
    const mockRes = {
      setHeader: () => {},
    } as any;

    // Call the actual PDF generation with our doc
    generateEstimatePdfContent(doc, data, companyName);
    doc.end();
  });
}

// Helper to generate the PDF content (shared between Response and Buffer versions)
function generateEstimatePdfContent(doc: PDFKit.PDFDocument, data: EstimatePdfData, companyName: string) {
  const W = doc.page.width - 88;
  const navy = "#0A1628";
  const slate = "#334155";
  const muted = "#64748B";
  const border = "#DCE3EA";
  let y = 44;

  const pageBreak = (height: number) => {
    if (y + height > doc.page.height - 64) {
      doc.addPage();
      y = 48;
    }
  };

  drawProductBrand(doc, 44, 49, 142);
  doc.fillColor(slate).font("Helvetica-Bold").fontSize(9).text(companyName, 0, 55, { align: "right" });
  doc.fillColor(muted).font("Helvetica").fontSize(7).text("FLEET SERVICE ESTIMATE", 0, 72, { align: "right" });

  y = 108;
  doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(23).text("ESTIMATE", 44, y);
  doc.fillColor(navy).fontSize(13).text(data.estimateNumber, 0, y + 3, { align: "right" });
  y += 38;

  const pillWidth = 88;
  const statusColors: Record<string, string> = {
    draft: "#64748B", sent: "#2563EB", approved: "#15803D",
    declined: "#B91C1C", expired: "#A16207", converted: "#6D28D9",
  };
  doc.roundedRect(44, y, pillWidth, 20, 3).fill(statusColors[data.status] ?? muted);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8)
    .text(statusLabel(data.status).toUpperCase(), 44, y + 6, { width: pillWidth, align: "center" });
  doc.fillColor(muted).font("Helvetica").fontSize(8)
    .text(`Issued ${fmt(data.createdAt)}   •   Valid until ${fmt(data.validUntil)}`, 150, y + 6, { width: W - 106, align: "right" });
  y += 38;

  const boxW = (W - 14) / 2;
  doc.roundedRect(44, y, boxW, 112, 4).fillAndStroke("#F8FAFC", border);
  doc.fillColor(muted).font("Helvetica-Bold").fontSize(7).text("PREPARED FOR", 56, y + 13);
  doc.fillColor(navy).fontSize(12).text(data.customerName, 56, y + 29, { width: boxW - 24 });
  const customerLines = [
    data.contactName,
    data.customerAddress,
    [data.customerCity, data.customerProvince, data.customerPostalCode].filter(Boolean).join(", "),
    data.customerEmail,
    data.customerPhone,
  ].filter(Boolean) as string[];
  doc.fillColor(muted).font("Helvetica").fontSize(8).text(customerLines.join("\n"), 56, y + 49, { width: boxW - 24, lineGap: 2 });

  const rightX = 44 + boxW + 14;
  doc.roundedRect(rightX, y, boxW, 112, 4).fillAndStroke("#F8FAFC", border);
  doc.fillColor(muted).font("Helvetica-Bold").fontSize(7).text("SERVICE DETAILS", rightX + 12, y + 13);
  doc.fillColor(navy).fontSize(11).text(data.title, rightX + 12, y + 29, { width: boxW - 24 });
  doc.fillColor(muted).font("Helvetica").fontSize(8)
    .text("Vehicle", rightX + 12, y + 60)
    .fillColor(slate).font("Helvetica-Bold")
    .text(data.vehicleUnitNumber ?? data.vehicleDescription ?? "Customer vehicle", rightX + 72, y + 60, { width: boxW - 84 });
  y += 132;

  pageBreak(90);
  doc.rect(44, y, W, 22).fill("#E8EDF5");
  const cols = [W * 0.12, W * 0.48, W * 0.11, W * 0.14, W * 0.15];
  const xs = [44, 44 + cols[0], 44 + cols[0] + cols[1], 44 + cols[0] + cols[1] + cols[2], 44 + cols[0] + cols[1] + cols[2] + cols[3]];
  ["Type", "Description", "Qty", "Unit Price", "Amount"].forEach((heading, index) => {
    doc.fillColor(slate).font("Helvetica-Bold").fontSize(7.5)
      .text(heading.toUpperCase(), xs[index] + 6, y + 7, { width: cols[index] - 12, align: index >= 2 ? "right" : "left" });
  });
  y += 24;

  if (data.lineItems.length === 0) {
    doc.rect(44, y, W, 42).fill("#FFFFFF").strokeColor(border).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(9).text("No estimate line items have been added.", 56, y + 16);
    y += 48;
  } else {
    data.lineItems.forEach((line, index) => {
      const descriptionHeight = doc.heightOfString(line.description, { width: cols[1] - 12, lineGap: 1 });
      const rowHeight = Math.max(28, descriptionHeight + 14);
      pageBreak(rowHeight + 4);
      doc.rect(44, y, W, rowHeight).fill(index % 2 ? "#F8FAFC" : "#FFFFFF").strokeColor(border).lineWidth(0.35).stroke();
      const values = [
        statusLabel(line.lineType),
        line.description,
        Number(line.quantity).toLocaleString("en-CA", { maximumFractionDigits: 2 }),
        `$${Number(line.unitPrice).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`,
        `$${Number(line.lineTotal).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`,
      ];
      values.forEach((value, column) => {
        doc.fillColor(column === 4 ? navy : slate).font(column === 4 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
          .text(value, xs[column] + 6, y + 8, { width: cols[column] - 12, align: column >= 2 ? "right" : "left", lineGap: 1 });
      });
      y += rowHeight;
    });
  }

  pageBreak(104);
  const totalsX = 44 + W * 0.58;
  y += 10;
  [["Subtotal", data.subtotal], [`Tax (${Number(data.taxRate).toFixed(2)}%)`, data.taxAmount]].forEach(([label, value]) => {
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(label, totalsX, y, { width: W * 0.2 });
    doc.fillColor(slate).font("Helvetica-Bold").text(`$${Number(value).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`, totalsX + W * 0.2, y, { width: W * 0.22, align: "right" });
    y += 22;
  });
  doc.moveTo(totalsX, y).lineTo(44 + W, y).strokeColor(navy).lineWidth(1.2).stroke();
  y += 10;
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(12).text("ESTIMATE TOTAL", totalsX, y);
  doc.fontSize(14).text(`$${Number(data.total).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`, totalsX + W * 0.2, y - 2, { width: W * 0.22, align: "right" });
  y += 42;

  for (const [title, text] of [["Scope Notes", data.notes], ["Terms & Conditions", data.terms]] as const) {
    if (!text) continue;
    const height = doc.heightOfString(text, { width: W - 24, lineGap: 2 }) + 38;
    pageBreak(height);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(title.toUpperCase(), 44, y);
    y += 17;
    doc.roundedRect(44, y, W, height - 24, 3).fillAndStroke("#F8FAFC", border);
    doc.fillColor(slate).font("Helvetica").fontSize(8.5).text(text, 56, y + 10, { width: W - 24, lineGap: 2 });
    y += height - 12;
  }

  pageBreak(82);
  y += 8;
  doc.fillColor(muted).font("Helvetica").fontSize(8)
    .text("Approval authorizes mistri360 to schedule the work described above. Final charges may change only when additional work is approved.", 44, y, { width: W });
  y += 30;
  doc.moveTo(44, y).lineTo(44 + W * 0.43, y).strokeColor(border).stroke();
  doc.moveTo(44 + W * 0.57, y).lineTo(44 + W, y).strokeColor(border).stroke();
  doc.fillColor(muted).fontSize(7).text("AUTHORIZED NAME / SIGNATURE", 44, y + 7);
  doc.text("DATE", 44 + W * 0.57, y + 7);

  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page);
    const footerY = doc.page.height - 48;
    doc.moveTo(44, footerY - 4).lineTo(44 + W, footerY - 4).strokeColor(border).lineWidth(0.5).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(7)
      .text(`mistri360  •  ${companyName}  •  ${data.estimateNumber}`, 44, footerY + 2, { width: W / 2, height: 10, lineBreak: false })
      .text(`ESTIMATE  •  Page ${page + 1} of ${pages.count}`, 44 + W / 2, footerY + 2, { width: W / 2, height: 10, align: "right", lineBreak: false });
  }
}
