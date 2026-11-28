import { useCallback, useRef, useState } from "react";
import { StyledConfirmModal } from "@/components/ui/styled-confirm-modal";

export function useStyledConfirm() {
  const [dialog, setDialog] = useState(null);
  const resolver = useRef(null);
  const confirmStyled = useCallback((description, title = "Please confirm") => new Promise((resolve) => {
    resolver.current = resolve;
    setDialog({ description, title });
  }), []);
  const close = useCallback((answer) => {
    resolver.current?.(answer);
    resolver.current = null;
    setDialog(null);
  }, []);
  const dialogElement = <StyledConfirmModal open={Boolean(dialog)} title={dialog?.title || "Please confirm"} description={dialog?.description || ""} onCancel={() => close(false)} onConfirm={() => close(true)} />;
  return { confirmStyled, dialogElement };
}