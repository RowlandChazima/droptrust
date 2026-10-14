"use client";

import React, { useState, useRef } from "react";
import {
  Sparkles,
  PenTool,
  UploadCloud,
  AlertCircle,
  Loader2,
  X,
  ArrowRight,
} from "lucide-react";
import { ManualOrderForm } from "@/components/orders/ManualOrderForm";
import { SideBySideReview } from "@/components/orders/SideBySideReview";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * OrderCaptureStudio — Unified order capture portal
 * Seamlessly toggles between multimodal Gemini 3.8 Flash AI OCR and manual data entry.
 */
export function OrderCaptureStudio({ defaultCurrency = "KES" }) {
  const [activeTab, setActiveTab] = useState("AI"); // "AI" | "MANUAL"
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [extractionResult, setExtractionResult] = useState(null);
  const [storagePath, setStoragePath] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);

  const handleFileSelect = (file) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setExtractError("Please select a valid image file (JPEG, PNG, WebP, HEIC).");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setExtractError("File size exceeds 10MB limit. Please upload a smaller photo.");
      return;
    }

    setExtractError("");
    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setFilePreview(objectUrl);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleExtract = async () => {
    if (!selectedFile) return;

    setIsExtracting(true);
    setExtractError("");

    try {
      const formData = new FormData();
      formData.append("image", selectedFile);

      const res = await fetch("/api/orders/extract", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to extract order with Gemini 3.8 Flash.");
      }

      setStoragePath(data.storageFilePath || null);
      setExtractionResult(data.extraction);
    } catch (err) {
      console.error("Extraction error:", err);
      setExtractError(err.message || "An unexpected error occurred during extraction.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDiscardExtraction = () => {
    setExtractionResult(null);
    setSelectedFile(null);
    if (filePreview) {
      URL.revokeObjectURL(filePreview);
      setFilePreview(null);
    }
    setStoragePath(null);
    setExtractError("");
  };

  // If Gemini has extracted data and we are in AI mode, show SideBySideReview Studio
  if (activeTab === "AI" && extractionResult) {
    return (
      <SideBySideReview
        initialExtraction={extractionResult}
        imagePreviewUrl={filePreview}
        storageFilePath={storagePath}
        defaultCurrency={defaultCurrency}
        onDiscard={handleDiscardExtraction}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Mode Switcher Tabs */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl border-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] shadow-[0_3px_0_#1E1218] max-w-md w-full">
        <button
          type="button"
          onClick={() => setActiveTab("AI")}
          className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
            activeTab === "AI"
              ? "bg-[var(--color-brand-gold)] border border-[var(--color-ink-primary)] text-[var(--color-ink-primary)] shadow-[0_2px_0_#1E1218]"
              : "text-[var(--color-ink-secondary)] hover:text-[var(--color-ink-primary)]"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-[var(--color-brand-crimson)]" />
          <span>AI Receipt OCR</span>
          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-[var(--color-brand-crimson)] text-white">
            3.8 Flash
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("MANUAL")}
          className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
            activeTab === "MANUAL"
              ? "bg-[var(--color-paper-light)] border border-[var(--color-ink-primary)] text-[var(--color-ink-primary)] shadow-[0_2px_0_#1E1218]"
              : "text-[var(--color-ink-secondary)] hover:text-[var(--color-ink-primary)]"
          }`}
        >
          <PenTool className="w-3.5 h-3.5" />
          <span>Manual Entry</span>
        </button>
      </div>

      {activeTab === "AI" ? (
        <div className="flex flex-col gap-6">
          {extractError && (
            <div className="p-4 rounded-xl border-2 border-[var(--color-brand-crimson)] bg-[#FDF0F3] text-xs font-medium text-[var(--color-brand-crimson)] flex items-start gap-3 shadow-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="font-bold">Extraction could not proceed</span>
                <span>{extractError}</span>
                <span className="text-[11px] text-[var(--color-ink-secondary)]">
                  You can retry with a clearer photo, or switch to{" "}
                  <button
                    type="button"
                    onClick={() => setActiveTab("MANUAL")}
                    className="font-bold underline text-[var(--color-brand-crimson)]"
                  >
                    Manual Entry
                  </button>
                  .
                </span>
              </div>
            </div>
          )}

          {/* Upload Dropzone Card */}
          <Card className="p-6 sm:p-8 border-2 border-[var(--color-ink-primary)] shadow-[0_4px_0_#1E1218] flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-extrabold text-[var(--color-ink-primary)] flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[var(--color-brand-crimson)]" />
                <span>Multimodal Order Capture</span>
              </h2>
              <p className="text-xs font-medium text-[var(--color-ink-secondary)]">
                Upload a photo of a paper receipt, handwritten notebook order, printed invoice, or WhatsApp customer chat.
              </p>
            </div>

            {/* Dropzone Area */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`p-8 rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-3 text-center cursor-pointer ${
                dragOver
                  ? "border-[var(--color-brand-crimson)] bg-red-50/50 scale-[1.01]"
                  : "border-[var(--color-ink-primary)] bg-[var(--color-paper-light)] hover:bg-[var(--color-paper-muted)]"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/gif"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />

              <div className="w-14 h-14 rounded-2xl bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)] flex items-center justify-center shadow-[0_3px_0_#1E1218]">
                <UploadCloud className="w-7 h-7 text-[var(--color-ink-primary)]" />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-[var(--color-ink-primary)]">
                  Click to browse or drag &amp; drop document photo
                </span>
                <span className="text-xs text-[var(--color-ink-secondary)]">
                  Supports JPEG, PNG, WebP &amp; HEIC up to 10MB
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[var(--color-paper-stone)] text-[var(--color-ink-secondary)]">
                  Handwritten Notes
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[var(--color-paper-stone)] text-[var(--color-ink-secondary)]">
                  POS Receipts
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[var(--color-paper-stone)] text-[var(--color-ink-secondary)]">
                  Customer Chats
                </span>
              </div>
            </div>

            {/* Selected File Preview Box */}
            {selectedFile && filePreview && (
              <div className="p-4 rounded-xl border-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-light)] shadow-[0_2px_0_#1E1218] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={filePreview}
                    alt="Document preview"
                    className="w-14 h-14 rounded-lg object-cover border border-[var(--color-ink-primary)] shrink-0 shadow-sm"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[var(--color-ink-primary)] truncate max-w-xs sm:max-w-md">
                      {selectedFile.name}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--color-ink-secondary)]">
                      {(selectedFile.size / 1024).toFixed(1)} KB &bull; {selectedFile.type || "image"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isExtracting}
                    onClick={() => {
                      setSelectedFile(null);
                      setFilePreview(null);
                    }}
                    className="text-xs"
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    <span>Remove</span>
                  </Button>

                  <Button
                    type="button"
                    disabled={isExtracting}
                    onClick={handleExtract}
                    className="flex-1 sm:flex-none text-xs flex items-center justify-center gap-1.5 py-2 px-4 shadow-[0_3px_0_#1E1218] bg-[var(--color-brand-gold)] font-bold text-[var(--color-ink-primary)]"
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Analyzing with Gemini 3.8 Flash...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-[var(--color-brand-crimson)]" />
                        <span>Extract with Gemini 3.8 Flash</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      ) : (
        <ManualOrderForm defaultCurrency={defaultCurrency} />
      )}
    </div>
  );
}
