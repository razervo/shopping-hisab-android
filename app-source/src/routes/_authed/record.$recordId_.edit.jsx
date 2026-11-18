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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    base44.entities.ShoppingRecord.get(recordId)
      .then((r) => !cancelled && setRecord(r))
      .catch(() => !cancelled && setRecord(false));
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
      });
      await base44.entities.ShoppingRecord.update(recordId, payload);
      toast.success("Shopping updated");
      navigate({ to: "/record/$recordId", params: { recordId } });
    } catch {
      toast.error("Could not update this shopping. Please try again.");
      setSaving(false);
    }
  };

  if (!record) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-11 rounded-xl bg-muted" />
        <div className="h-24 rounded-[24px] bg-muted" />
        <div className="h-40 rounded-[24px] bg-muted" />
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