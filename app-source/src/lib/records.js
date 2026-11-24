import { cloudflareRequest } from "@/api/cloudflareClient";

// Every shopping record for this user, newest first (used for the full backup export).
export async function fetchAllRecords() {
  const out = [];
  let cursor = 0;
  const pageSize = 200;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
    const page = await cloudflareRequest(`/api/reports/export?limit=${pageSize}&cursor=${cursor}`);
    out.push(...(page.items || []));
    if (!page.has_more || !page.next_cursor) return out;
    const nextCursor = Number(page.next_cursor);
    if (!Number.isSafeInteger(nextCursor) || nextCursor <= cursor) {
      throw new Error("The export returned an invalid pagination cursor.");
    }
    cursor = nextCursor;
  }
  throw new Error("The export contains more than 200,000 records. Please export a smaller date range.");
}
