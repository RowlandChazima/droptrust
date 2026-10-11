import { NextResponse } from "next/server";
import { getPublicReceipt } from "@/lib/receipts";

// Receipts are personal documents: never cache, never index, never leak the
// token through the Referer header.
const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

const STATUS_CODES = {
  ok: 200,
  not_found: 404,
  revoked: 410,
  unconfirmed: 409,
  error: 500,
};

export async function GET(_request, { params }) {
  const { token } = await params;
  const result = await getPublicReceipt(token);

  const body =
    result.status === "ok"
      ? { status: "ok", receipt: result.receipt }
      : { status: result.status };

  return NextResponse.json(body, {
    status: STATUS_CODES[result.status] ?? 500,
    headers: PRIVATE_HEADERS,
  });
}
