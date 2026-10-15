import { jsPDF } from 'jspdf';
import { formatSealRanges, SHOW_SEALS_ON_DO } from './sealRanges.js';

// Company letterhead — same identity block the Sales Web proforma invoice
// uses (admin-orders.js openProformaInvoice).
const CO_NAME = 'MEGA JUTAMAS SDN BHD';
const CO_BRAND = 'MJM Nursery';
const CO_ADDR = 'Lot 1180, Bangunan Bei, Krokop 2, Miri, Sarawak, Malaysia';

const INK = [17, 24, 39]; // #111827
const GREY = [85, 85, 85]; // #555
const LIGHT = [229, 231, 235]; // #e5e7eb row separators
const HEAD_BG = [244, 244, 245]; // #f4f4f5 table header

const fmtQty = (n) => Number(n || 0).toLocaleString('en-MY');

// Draw a data-URL image contained (aspect-fit, centred) inside a box.
function fitImage(doc, dataUrl, x, y, boxW, boxH, pad = 1.5) {
  try {
    const props = doc.getImageProperties(dataUrl);
    const availW = boxW - pad * 2;
    const availH = boxH - pad * 2;
    const scale = Math.min(availW / props.width, availH / props.height);
    const w = props.width * scale;
    const h = props.height * scale;
    doc.addImage(dataUrl, props.fileType || 'JPEG', x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
  } catch (e) {
    /* ignore bad image */
  }
}

// Builds the Delivery Order PDF document, styled after the Sales Web
// proforma invoice letterhead. `al` is the matching shared_al_orders row
// (may be partial), `staff` is the signed-in staff display name,
// `sigDataUrl` is an optional PNG data-URL of the customer signature,
// `photoDataUrl` is an optional data-URL photo of the customer's vehicle
// with the loaded goods. Returns the jsPDF doc so callers can either save
// (print) it or upload it as a blob.
export function buildDOPdf(doRec, al = {}, staff = '—', sigDataUrl = null, photoDataUrl = null) {
  const doc = new jsPDF();
  const now = new Date();
  const dateFmt = doRec.delivery_date ? new Date(doRec.delivery_date).toLocaleDateString('en-MY') : '—';
  const customer = al.customer_name || doRec.remark || '—';

  // ── Letterhead ──
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(CO_NAME, 20, 19);
  doc.setFontSize(10.5);
  doc.setTextColor(51, 51, 51);
  doc.text(CO_BRAND, 20, 25);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text(CO_ADDR, 20, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text('DELIVERY ORDER', 190, 19, { align: 'right' });
  doc.setFontSize(9.5);
  doc.text(doRec.do_number || '—', 190, 25.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text('Date: ' + dateFmt, 190, 30, { align: 'right' });

  doc.setDrawColor(...INK);
  doc.setLineWidth(0.8);
  doc.line(20, 34.5, 190, 34.5);

  // ── Deliver To ── (the DO number embeds the order number, so no separate
  // Order No. field is needed)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('DELIVER TO', 20, 44);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(doc.splitTextToSize(String(customer), 150), 20, 50);

  // ── Items table ──
  let y = 66;
  doc.setFillColor(...HEAD_BG);
  doc.rect(20, y, 170, 8.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text('#', 23, y + 5.7);
  doc.text('Nursery / Plot', 30, y + 5.7);
  doc.text('Breed / Plant', 92, y + 5.7);
  doc.text('Qty', 187, y + 5.7, { align: 'right' });
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.5);
  doc.line(20, y + 8.5, 190, y + 8.5);

  const items = [];
  for (let i = 1; i <= 5; i++) {
    const nursery = doRec[`plot_${i}`];
    const breed = doRec[`breed_${i}`];
    const qty = doRec[`qty_${i}`];
    if (nursery || breed || qty) items.push({ nursery: nursery || '—', breed: breed || '—', qty: qty || 0 });
  }
  if (!items.length) items.push({ nursery: '—', breed: '—', qty: doRec.total_qty || 0 });

  y += 15;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  items.forEach((it, i) => {
    doc.setTextColor(...GREY);
    doc.text(String(i + 1), 23, y);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(String(it.nursery), 58)[0], 30, y);
    doc.text(doc.splitTextToSize(String(it.breed), 85)[0], 92, y);
    doc.text(fmtQty(it.qty), 187, y, { align: 'right' });
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.2);
    doc.line(20, y + 3, 190, y + 3);
    y += 9;
  });

  // Total row
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.7);
  doc.line(20, y - 2, 190, y - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text('TOTAL QUANTITY', 92, y + 4);
  doc.text(fmtQty(doRec.total_qty), 187, y + 4, { align: 'right' });

  // ── Seals that went out on this DO ──
  // Written by the scan card when the DO was issued from one (the seals
  // scanned since its last DO). Capped at four lines so a scatter of odd
  // seals cannot push the signature boxes into the footer; the full list
  // is in the system. With five items and four lines the boxes still end
  // well above the footer rule at 280.
  const seals = SHOW_SEALS_ON_DO && Array.isArray(doRec.seal_ranges) ? doRec.seal_ranges : [];
  if (seals.length) {
    y += 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text('SEAL NO.', 20, y);
    doc.text('SEAL QTY: ' + fmtQty(doRec.seal_qty || seals.reduce((n, r) => n + (Number(r.qty) || 0), 0)), 190, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    let lines = doc.splitTextToSize(formatSealRanges(seals), 170);
    if (lines.length > 4) {
      lines = lines.slice(0, 4);
      lines[3] = doc.splitTextToSize(lines[3], 115)[0] + ' … (' + seals.length + ' ranges, see system)';
    }
    doc.text(lines, 20, y + 4.5);
    y += 4.5 + (lines.length - 1) * 3.8;
  }

  // ── Customer acknowledgement: collection photo + signature ──
  y += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text('CUSTOMER ACKNOWLEDGEMENT', 20, y);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.line(20, y + 2, 190, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text('I / We acknowledge receipt of the above items in good order and condition.', 20, y + 9);

  y += 15;
  const BOX_H = 58;
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.rect(20, y, 82, BOX_H);
  doc.rect(108, y, 82, BOX_H);

  if (photoDataUrl) {
    fitImage(doc, photoDataUrl, 20, y, 82, BOX_H);
  } else {
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text('No photo captured', 61, y + BOX_H / 2, { align: 'center' });
  }
  if (sigDataUrl) fitImage(doc, sigDataUrl, 108, y, 82, BOX_H);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('Collection Photo (vehicle & goods)', 20, y + BOX_H + 5);
  doc.text('Customer Signature', 108, y + BOX_H + 5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.text(doc.splitTextToSize(String(customer), 80)[0], 108, y + BOX_H + 10);

  // ── Footer ──
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.3);
  doc.line(20, 280, 190, 280);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  doc.text('Computer-generated by ' + CO_NAME + ' (' + CO_BRAND + ').', 20, 285);
  doc.text('Issued by ' + String(staff || '—'), 190, 285, { align: 'right' });
  doc.setTextColor(150, 150, 150);
  doc.text(
    (doRec.do_number || 'DO') + ' · Generated ' + now.toISOString().slice(0, 19).replace('T', ' '),
    190,
    289.5,
    { align: 'right' }
  );

  return doc;
}

// Filename used both for the downloaded copy and the uploaded attachment.
export function doPdfFileName(doRec) {
  return (doRec.do_number || 'DO').replace(/[/\\]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
}

// Generates and downloads the DO PDF (print flow).
export function printDO(doRec, al = {}, staff = '—', sigDataUrl = null, photoDataUrl = null) {
  buildDOPdf(doRec, al, staff, sigDataUrl, photoDataUrl).save(doPdfFileName(doRec));
}

// Generates the DO PDF as a Blob for uploading to storage (order attachment
// flow). Returns { blob, fileName }.
export function doPdfBlob(doRec, al = {}, staff = '—', sigDataUrl = null, photoDataUrl = null) {
  const doc = buildDOPdf(doRec, al, staff, sigDataUrl, photoDataUrl);
  return { blob: doc.output('blob'), fileName: doPdfFileName(doRec) };
}
