const KEY = "shopping-hisab-list-draft";

// The shopping list being built is kept on this device, so a rough list made at
// home can be opened again at the shop and given the real prices before saving.
export function loadDraft() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // storage full or blocked: the list simply is not kept
  }
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}