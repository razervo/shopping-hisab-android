import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/cloudflareClient";
import { RecordForm } from "@/components/shopping/RecordForm";
import { buildPayload } from "@/lib/shopping";

export const Route = createFileRoute("/_authed/record/$recordId_/edit")({
  head: () => ({ meta: [{ title: "Edit Shopping · Shopping Hisab" }] }),
  component: EditRecordPage,
});

function EditRecordPage() {
  const { recordId } = Route.useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    base44.entities.ShoppingRecord.get(recordId)
      .then((r) => { if (!cancelled) { setRecord(r); setNotFound(false); } })
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  const save = async (values) => {
    setSaving(true);
    try {
      const payload = buildPayload({
        ...values,
        source: record.source || "manual",
        billFileUri: record.bill_file_uri,
        receipts: values.receipts,
        reconciliationStatus: values.reconciliationStatus,
      });
      await base44.entities.ShoppingRecord.update(recordId, payload);
      toast.success("Shopping updated");
      navigate({ to: "/record/$recordId", params: { recordId } });
    } catch {
      toast.error("Could not update this shopping. Please try again.");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-11 rounded-xl bg-muted" />
        <div className="h-24 rounded-[24px] bg-muted" />
        <div className="h-40 rounded-[24px] bg-muted" />
      </div>
    );
  }

  if (notFound || !record) {
    return (
      <div className="rounded-[24px] border border-border px-5 py-10 text-center">
        <p className="text-sm font-semibold">This shopping record was not found</p>
        <button type="button" onClick={() => navigate({ to: "/history" })} className="mt-4 rounded-full bg-primary px-5 py-2.5 text-[13px] font-bold text-primary-foreground">Back to history</button>
      </div>
    );
  }


  return (
    <div>
      <button
        type="button"
        onClick={() => navigate({ to: "/record/$recordId", params: { recordId } })}
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back to record
      </button>
      <h1 className="mb-4 text-[24px] font-extrabold leading-tight tracking-tight">Edit shopping</h1>
      <RecordForm
        initial={record}
        submitLabel="Update"
        saving={saving}
        onSave={save}
        footerNote={`Editing ${record.shop_name || "shopping"}`}
      />
    </div>
  );
}