import { base44 } from "@/api/base44Client";

// Every shopping record for this user, newest first (used for the full backup export).
export async function fetchAllRecords() {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 10; i += 1) {
    const page = await base44.entities.ShoppingRecord.list({
      sort: "-date",
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    out.push(...(page.items || []));
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}