import { useEffect } from "react";

export function StyledConfirmModal({ open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false, showCancel = true, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => { if (event.key === "Escape") onCancel?.(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel?.(); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="styled-confirm-title" aria-describedby="styled-confirm-description" className="w-full max-w-sm rounded-[24px] border-[1.5px] border-[#450A0A] bg-white p-5 shadow-2xl">
        <h2 id="styled-confirm-title" className="text-[16px] font-extrabold">{title}</h2>
        <p id="styled-confirm-description" className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-full border border-[#450A0A] px-4 py-3 text-[13px] font-bold"> {cancelLabel} </button>
          <button type="button" onClick={onConfirm} className={`flex-1 rounded-full px-4 py-3 text-[13px] font-bold text-white ${destructive ? "bg-red-700" : "bg-[#0F766E]"}`}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
