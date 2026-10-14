import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { extractOrderFromImage } from "@/lib/gemini";

export const maxDuration = 60; // Allow sufficient time for multimodal AI processing

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export async function POST(request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate merchant
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required to extract order documents." },
        { status: 401 }
      );
    }

    // 2. Fetch merchant's business profile
    const { data: business, error: bizError } = await supabase
      .from("businesses")
      .select("id, currency, name")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (bizError || !business) {
      return NextResponse.json(
        { error: "Merchant business profile not found." },
        { status: 404 }
      );
    }

    // 3. Parse and validate multipart form data
    const formData = await request.formData();
    const file = formData.get("image");
    const orderId = formData.get("orderId");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "A valid image file is required in 'image' field." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 10MB limit. Please upload a smaller image." },
        { status: 400 }
      );
    }

    const mimeType = file.type || "image/jpeg";
    if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      return NextResponse.json(
        {
          error: `Unsupported image format (${mimeType}). Please upload JPEG, PNG, WebP, or HEIC.`,
        },
        { status: 400 }
      );
    }

    // Read buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 4. Upload to private Supabase Storage bucket 'order-sources'
    const originalExt = file.name ? file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") : "jpg";
    const safeExt = originalExt || "jpg";
    const storagePath = `${business.id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${safeExt}`;

    let uploadWarning = null;
    let previewUrl = null;

    const { error: storageError } = await supabase.storage
      .from("order-sources")
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (storageError) {
      console.warn("Storage upload failed (bucket may need creation in Supabase):", storageError.message);
      uploadWarning = `Image storage warning: ${storageError.message}`;
    } else {
      // Create a 1-hour signed URL for the merchant preview
      const { data: signedData } = await supabase.storage
        .from("order-sources")
        .createSignedUrl(storagePath, 3600);
      previewUrl = signedData?.signedUrl || null;
    }

    // 5. Extract with Gemini 3.8 Flash
    let extraction;
    try {
      extraction = await extractOrderFromImage({
        imageBuffer: buffer,
        mimeType,
      });
    } catch (aiErr) {
      console.error("Gemini OCR extraction failed:", aiErr);
      return NextResponse.json(
        {
          error: aiErr.message || "Gemini 3.8 Flash extraction failed.",
          storageFilePath: storageError ? null : storagePath,
          previewUrl,
          uploadWarning,
        },
        { status: 422 }
      );
    }

    // 6. If linked to an existing order, record extraction in database
    if (orderId && typeof orderId === "string") {
      // Verify order ownership
      const { data: order } = await supabase
        .from("orders")
        .select("id, business_id")
        .eq("id", orderId)
        .eq("business_id", business.id)
        .maybeSingle();

      if (order) {
        // Record extraction
        await supabase.from("extraction_records").insert({
          order_id: order.id,
          storage_file_path: storageError ? null : storagePath,
          status: "EXTRACTED",
          raw_model_output: extraction.rawModelOutput,
        });

        // Record audit event
        await supabase.from("order_events").insert({
          order_id: order.id,
          event_type: "ORDER_EXTRACTED",
          actor: "GEMINI_AI",
          details: {
            model: extraction.model,
            overall_confidence: extraction.overallConfidence,
            items_extracted: extraction.items.length,
            has_low_confidence_items: extraction.needsReview,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      storageFilePath: storageError ? null : storagePath,
      previewUrl,
      uploadWarning,
      extraction,
    });
  } catch (err) {
    console.error("Unexpected error in /api/orders/extract:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error during order extraction." },
      { status: 500 }
    );
  }
}
