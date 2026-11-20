import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/cloudflareClient";
import { BillUploader } from "@/components/shopping/BillUploader";
import { RecordForm } from "@/components/shopping/RecordForm";
import { buildPayload } from "@/lib/shopping";
import { clearDraft, loadDraft } from "@/lib/draft";

export const Route = createFileRoute("/_authed/add/bill")({
  head: () => ({ meta: [{ title: "Upload Shopping List · Shopping Hisab" }] }),
  component: AddBillPage,
});

function AddBillPage() {
  const navigate = useNavigate();
  const [storedDraft] = useState(() => loadDraft());
  const [draft, setDraft] = useState(() =>
    storedDraft?.kind === "uploaded_list" && Array.isArray(storedDraft.items) && storedDraft.items.length
      ? {
          shop_name: storedDraft.shopName || "",
          date: storedDraft.date,
          notes: storedDraft.notes || "",
          items: storedDraft.items,
          estimatedIds: storedDraft.estimatedIds || [],
        }
      : null,
  );
  const [billUri, setBillUri] = useState(() =>
    storedDraft?.kind === "uploaded_list" ? storedDraft.billFileUri || "" : "",
  );
  const [saving, setSaving] = useState(false);

  const handleExtracted = (extracted, fileUri) => {
    setDraft(extracted);
    setBillUri(fileUri);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (values) => {
    setSaving(true);
    try {
      const payload = buildPayload({ ...values, source: "bill", billFileUri: billUri, receipts: values.receipts, reconciliationStatus: values.reconciliationStatus });
      const created = await base44.entities.ShoppingRecord.create(payload);
      clearDraft();
      toast.success("Shopping saved");
      navigate({ to: "/record/$recordId", params: { recordId: created.id } });
    } catch {
      toast.error("Could not save this shopping. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate({ to: "/add" })}
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Add shopping
      </button>

      {draft ? (
        <>
          <div className="mb-4 flex items-start gap-2.5 rounded-[20px] bg-accent px-4 py-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />
            <p className="text-[12.5px] font-medium leading-relaxed text-accent-foreground">
              Shopping list imported. First get a rough market estimate. When you reach the shop, upload the same list with the actual prices written beside the items, or enter those prices manually. Review everything before saving.
            </p>
          </div>
          <RecordForm
            initial={draft}
            allowEstimate
            billFileUri={billUri}
            onActualListUploaded={setBillUri}
            submitLabel="Save final shopping"
            saving={saving}
            onSave={save}
            footerNote="Shopping list · review actual prices before saving"
          />
        </>
      ) : (
        <>
          <h1 className="text-[24px] font-extrabold leading-tight tracking-tight">Upload shopping list</h1>
          <p className="mb-5 mt-1 text-[13.5px] text-muted-foreground">
            Upload a photo of your list before shopping. Item names and quantities are read first; prices are not invented. We estimate them in the next step.
          </p>
          <BillUploader purpose="shopping_list" onExtracted={handleExtracted} />
        </>
      )}
    </div>
  );
}