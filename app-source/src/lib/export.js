import { ddmmyyyy } from "@/lib/format";

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function exportRecordsCSV(records, label = "shopping-hisab") {
  const header = ["Date", "Shop", "Items", "Total (INR)", "Notes"];
  const rows = records.map((r) => [
    ddmmyyyy(r.date),
    r.shop_name || "",
    r.item_count ?? (r.items?.length || 0),
    Number(r.total || 0).toFixed(2),
    r.notes || "",
  ]);
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  download(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" }), `${label}.csv`);
}

export async function exportRecordsPDF(records, label = "shopping-hisab") {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const left = 48;
  let y = 64;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Shopping Hisab", left, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  y += 16;
  doc.text("Your Daily Shopping Account", left, y);
  y += 26;

  const total = records.reduce((s, r) => s + (Number(r.total) || 0), 0);
  doc.setTextColor(30);
  doc.setFontSize(11);
  doc.text(`Records: ${records.length}`, left, y);
  doc.text(`Total: Rs. ${total.toFixed(2)}`, w - left, y, { align: "right" });
  y += 16;
  doc.setDrawColor(210);
  doc.line(left, y, w - left, y);
  y += 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("DATE", left, y);
  doc.text("SHOP", left + 80, y);
  doc.text("ITEMS", w - left - 110, y, { align: "right" });
  doc.text("TOTAL", w - left, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  y += 14;

  records.forEach((r) => {
    if (y > 760) {
      doc.addPage();
      y = 64;
    }
    const shop = String(r.shop_name || "-").slice(0, 42);
    doc.text(ddmmyyyy(r.date), left, y);
    doc.text(shop, left + 80, y);
    doc.text(String(r.item_count ?? r.items?.length ?? 0), w - left - 110, y, { align: "right" });
    doc.text(`Rs. ${Number(r.total || 0).toFixed(2)}`, w - left, y, { align: "right" });
    y += 9;
    doc.setDrawColor(238);
    doc.line(left, y, w - left, y);
    y += 12;
  });

  doc.save(`${label}.pdf`);
}