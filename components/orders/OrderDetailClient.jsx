"use client";

import React, { useState, useTransition } from "react";
import {
  Copy,
  Check,
  ArrowRight,
  Loader2,
  Share2,
  ExternalLink,
  AlertCircle,
  Ban,
  RefreshCw,
  Banknote,
  Sparkles,
  Trash2,
  Eye,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  updateFulfillmentStatus,
  toggleReceiptActiveAction,
  recordCashPaymentAction,
  purgeOrderImageAction,
} from "@/lib/actions/orders";
import { ZoomableImageViewer } from "@/components/orders/ZoomableImageViewer";
import { Button } from "@/components/ui/Button";

// Next valid status mapping according to the database state machine
const NEXT_STATUS_MAP = {
  DRAFT: "CONFIRMED",
  CONFIRMED: "PROCESSING",
  PROCESSING: "READY",
  READY: "DISPATCHED",
  DISPATCHED: "DELIVERED",
};

export function OrderDetailClient({ order, extractionRecord }) {
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState("");
  const [showImageModal, setShowImageModal] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const isReceiptActive = order.is_receipt_active !== false;

  const publicUrl = typeof window !== "undefined"
    ? `${window.location.origin}/r/${order.public_token}`
    : `/r/${order.public_token}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleToggleRevoke = () => {
    setErrorMsg("");
    startTransition(async () => {
      const res = await toggleReceiptActiveAction(order.id, !isReceiptActive);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to toggle receipt link access.");
      }
    });
  };

  const nextStatus = NEXT_STATUS_MAP[order.fulfillment_status];

  const handleAdvanceStatus = () => {
    if (!nextStatus) return;
    setErrorMsg("");

    startTransition(async () => {
      const res = await updateFulfillmentStatus(order.id, nextStatus);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to advance order status.");
      }
    });
  };

  const handleRecordCashPayment = () => {
    setErrorMsg("");
    startTransition(async () => {
      const res = await recordCashPaymentAction(order.id);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to record cash payment.");
      }
    });
  };

  const handlePurgeImage = () => {
    setErrorMsg("");
    startTransition(async () => {
      const res = await purgeOrderImageAction(order.id);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to purge image from storage.");
      } else {
        setConfirmPurge(false);
        setShowImageModal(false);
      }
    });
  };

  const hasStoredImage = Boolean(extractionRecord?.storage_file_path);
  const imageApiUrl = `/api/orders/${order.id}/image`;

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && (
        <div className="p-3 rounded-xl border border-[var(--color-brand-crimson)] bg-[#FDF0F3] text-xs text-[var(--color-brand-crimson)] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Shareable Receipt Link Card */}
      <div className={`p-4 rounded-xl border-2 border-[var(--color-ink-primary)] shadow-[0_3px_0_#1E1218] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
        isReceiptActive ? "bg-[var(--color-brand-gold)]" : "bg-stone-200"
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[var(--color-paper-card)] border border-[var(--color-ink-primary)] flex items-center justify-center shrink-0">
            <Share2 className="w-4 h-4 text-[var(--color-ink-primary)]" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[var(--color-ink-primary)]">
                Customer Trust Receipt Link
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.2 rounded-full border ${
                isReceiptActive
                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                  : "bg-red-100 text-red-800 border-red-300"
              }`}>
                {isReceiptActive ? "Active" : "Revoked"}
              </span>
            </div>
            <span className="text-[11px] font-mono text-[var(--color-ink-secondary)] truncate max-w-xs sm:max-w-md">
              /r/{order.public_token}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {isReceiptActive && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="flex-1 sm:flex-none text-xs flex items-center justify-center gap-1.5 py-1.5 px-3 bg-white"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-700" />
                  <span className="text-green-800 font-bold">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Link</span>
                </>
              )}
            </Button>
          )}

          <a
            href={`/r/${order.public_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg border-2 border-[var(--color-ink-primary)] bg-white text-[var(--color-ink-primary)] hover:bg-[var(--color-paper-light)] transition-colors"
            title="Preview Customer Receipt"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={handleToggleRevoke}
            className={`text-xs py-1.5 px-2.5 flex items-center gap-1 bg-white ${
              isReceiptActive
                ? "text-[var(--color-brand-crimson)] hover:bg-red-50"
                : "text-emerald-700 hover:bg-emerald-50"
            }`}
            title={isReceiptActive ? "Revoke customer access to this link" : "Reactivate customer access"}
          >
            {isReceiptActive ? (
              <>
                <Ban className="w-3.5 h-3.5" />
                <span>Revoke</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reactivate</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Multimodal AI Extraction & Storage Evidence Card */}
      {extractionRecord && (
        <div className="p-4 rounded-xl border-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] shadow-[0_3px_0_#1E1218] flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--color-paper-stone)] pb-2.5">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-[var(--color-brand-gold)] border border-[var(--color-ink-primary)] text-[var(--color-ink-primary)]">
                <Sparkles className="w-3.5 h-3.5 text-[var(--color-brand-crimson)]" />
              </span>
              <span className="text-xs font-bold text-[var(--color-ink-primary)]">
                Multimodal OCR Evidence (Gemini 3.8 Flash)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                hasStoredImage
                  ? "bg-amber-100 text-amber-900 border-amber-300"
                  : "bg-emerald-100 text-emerald-900 border-emerald-300"
              }`}>
                {hasStoredImage ? "Source Photo Active" : "Image Purged (Minimized)"}
              </span>
              <span className="text-[10px] font-mono text-[var(--color-ink-secondary)]">
                Status: {extractionRecord.status}
              </span>
            </div>
          </div>

          {hasStoredImage ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageApiUrl}
                  alt="Order source thumbnail"
                  className="w-12 h-12 rounded-lg object-cover border-2 border-[var(--color-ink-primary)] bg-stone-100 shrink-0 shadow-sm cursor-pointer"
                  onClick={() => setShowImageModal(true)}
                />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-[var(--color-ink-primary)]">
                    Original Source Document
                  </span>
                  <span className="text-[10px] font-mono text-[var(--color-ink-secondary)] truncate max-w-xs">
                    {extractionRecord.storage_file_path.split("/").pop()}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowImageModal(true)}
                  className="text-xs flex items-center gap-1.5 py-1.5 px-3 bg-white"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Inspect Image</span>
                </Button>

                {!confirmPurge ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmPurge(true)}
                    className="text-xs flex items-center gap-1.5 py-1.5 px-3 text-[var(--color-brand-crimson)] hover:bg-red-50 bg-white"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Purge Image</span>
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      disabled={isPending}
                      onClick={handlePurgeImage}
                      className="text-xs py-1.5 px-3 bg-[var(--color-brand-crimson)] text-white hover:bg-red-800"
                    >
                      {isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <span>Confirm Purge</span>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmPurge(false)}
                      className="text-xs py-1.5 px-2 bg-white"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                Document photo was permanently purged from private storage to minimize customer data retention. Order line items and cryptographic receipt remain verified.
              </span>
            </div>
          )}

          {confirmPurge && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-900 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span>
                Purging removes the uploaded document permanently from storage. The immutable customer snapshot, financial totals, and verified line items will remain on this order.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Cash on Delivery Settlement Action */}
      {order.payment_method === "CASH_ON_DELIVERY" && order.payment_status === "UNPAID" && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-xl border-2 border-emerald-300 bg-emerald-50 gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white border border-emerald-300 flex items-center justify-center shrink-0 text-emerald-700">
              <Banknote className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                Cash on Delivery
              </span>
              <span className="text-xs font-bold text-emerald-950">
                Awaiting physical payment collection
              </span>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={handleRecordCashPayment}
            className="text-xs flex items-center gap-1.5 py-1.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white w-full sm:w-auto justify-center"
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <Banknote className="w-3.5 h-3.5" />
                <span>Record Cash Received</span>
              </>
            )}
          </Button>
        </div>
      )}

      {/* Fulfillment Status Advance Action */}
      {nextStatus && (
        <div className="flex items-center justify-between p-3.5 rounded-xl border-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-light)]">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Next Stage in Lifecycle
            </span>
            <span className="text-xs font-bold text-[var(--color-ink-primary)]">
              Move to &ldquo;{nextStatus}&rdquo;
            </span>
          </div>

          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={handleAdvanceStatus}
            className="text-xs flex items-center gap-1.5 py-1.5 px-3"
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <span>Mark as {nextStatus}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </div>
      )}

      {/* Modal Zoomable Image Viewer */}
      {showImageModal && hasStoredImage && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative max-w-4xl w-full flex flex-col gap-3">
            <div className="flex items-center justify-between text-white px-1">
              <span className="text-sm font-bold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--color-brand-gold)]" />
                <span>Order Source Document Inspector</span>
              </span>
              <button
                type="button"
                onClick={() => setShowImageModal(false)}
                className="p-1.5 rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors"
                title="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ZoomableImageViewer
              src={imageApiUrl}
              alt="Source document full view"
              className="max-h-[80vh]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
