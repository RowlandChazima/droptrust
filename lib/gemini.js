import { GoogleGenAI, Type } from "@google/genai";

/**
 * DropTrust Capture — Gemini Multimodal OCR Client
 * Powered exclusively by gemini-3.8-flash
 */
export const GEMINI_MODEL = "gemini-3.8-flash";

const orderExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    customerName: {
      type: Type.STRING,
      description: "Name of the customer or buyer if present or inferred.",
    },
    customerPhone: {
      type: Type.STRING,
      description: "Customer phone number if present on the document.",
    },
    customerEmail: {
      type: Type.STRING,
      description: "Customer email address if present.",
    },
    customerAddress: {
      type: Type.STRING,
      description: "Delivery address, street, neighborhood, or city if present.",
    },
    agreedTerms: {
      type: Type.STRING,
      description: "Delivery instructions, buyer requests, or special terms.",
    },
    currency: {
      type: Type.STRING,
      description: "Currency code: 'USD' or 'KES'. Defaults to 'USD' if dollar signs or ambiguous.",
    },
    deliveryFee: {
      type: Type.NUMBER,
      description: "Delivery fee or shipping cost in standard currency units (e.g. 5.00). Default 0.",
    },
    paymentMethod: {
      type: Type.STRING,
      description: "Payment method: 'PAYPAL' or 'CASH_ON_DELIVERY'.",
    },
    items: {
      type: Type.ARRAY,
      description: "Line items detected on the receipt, invoice, or handwritten note.",
      items: {
        type: Type.OBJECT,
        properties: {
          productName: {
            type: Type.STRING,
            description: "Product title or description.",
          },
          variantName: {
            type: Type.STRING,
            description: "Size, color, or variant details if specified.",
          },
          quantity: {
            type: Type.INTEGER,
            description: "Quantity purchased. Whole number >= 1.",
          },
          unitPrice: {
            type: Type.NUMBER,
            description: "Unit price per item in standard units (e.g. 24.50).",
          },
          confidenceScore: {
            type: Type.NUMBER,
            description: "Transcription certainty between 0.00 (illegible) and 1.00 (crystal clear).",
          },
          uncertaintyReason: {
            type: Type.STRING,
            description: "Reason if confidence is below 0.85 (e.g. 'smudged handwriting', 'partial digit').",
          },
        },
        required: ["productName", "quantity", "unitPrice", "confidenceScore"],
      },
    },
    overallConfidence: {
      type: Type.NUMBER,
      description: "Overall document extraction confidence score from 0.00 to 1.00.",
    },
    notes: {
      type: Type.STRING,
      description: "General merchant notes or transcription remarks.",
    },
  },
  required: ["items", "overallConfidence"],
};

const EXTRACTION_SYSTEM_INSTRUCTION = `You are DropTrust Capture's multimodal OCR engine. Your job is to extract customer orders from photos of paper receipts, printed invoices, handwritten notebook order logs, or customer chat screenshots.

Rules:
1. Extract all line items accurately. If a quantity is not explicitly stated, assume 1.
2. Prices must be standard positive decimal amounts (e.g. 15.50 for $15.50 or KES 15.50). Do not use negative numbers.
3. Assess handwriting clarity and visual certainty. Provide an individual confidenceScore (between 0.00 and 1.00) for every item. If any text is smudged, crossed out, or uncertain, assign a score below 0.85 and explain in uncertaintyReason.
4. Currency: If marked with '$' or unclear, specify 'USD'. If marked with 'Ksh', 'KES' or Kenyan context, specify 'KES'.
5. Only return structured output according to the defined schema.`;

/**
 * Extracts structured order data from an image buffer using Gemini 3.8 Flash.
 *
 * @param {Object} options
 * @param {Buffer|Uint8Array|string} options.imageBuffer - Raw image data (or base64 string)
 * @param {string} options.mimeType - e.g. "image/jpeg", "image/png", "image/webp"
 * @returns {Promise<Object>} Structured extraction result
 */
export async function extractOrderFromImage({ imageBuffer, mimeType = "image/jpeg" }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "GEMINI_API_KEY is not configured in environment variables. Please add your Google AI Studio API key to .env.local to enable OCR extraction."
    );
  }

  // Convert buffer to base64 string if needed
  let base64Data = "";
  if (typeof imageBuffer === "string") {
    // If string has a data URL prefix, strip it
    base64Data = imageBuffer.replace(/^data:[^;]+;base64,/, "");
  } else if (Buffer.isBuffer(imageBuffer) || imageBuffer instanceof Uint8Array) {
    base64Data = Buffer.from(imageBuffer).toString("base64");
  } else {
    throw new Error("Invalid image format. Expected Buffer, Uint8Array, or base64 string.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: "Extract the customer information and line items from this order document." },
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    config: {
      systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: orderExtractionSchema,
      temperature: 0.1, // Low temperature for factual transcription
    },
  });

  const rawText = response.text;
  if (!rawText) {
    throw new Error("Gemini 3.8 Flash returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Failed to parse Gemini OCR response as JSON: ${err.message}`);
  }

  // Normalize and validate parsed output
  const normalizedItems = Array.isArray(parsed.items)
    ? parsed.items.map((item, index) => {
        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        const price = Math.max(0, parseFloat(item.unitPrice) || 0);
        const conf = typeof item.confidenceScore === "number"
          ? Math.min(1, Math.max(0, item.confidenceScore))
          : 0.9;

        return {
          id: `item-${index + 1}-${Date.now().toString(36)}`,
          productName: (item.productName || `Item ${index + 1}`).trim(),
          variantName: (item.variantName || "").trim(),
          quantity: qty,
          unitPrice: price.toFixed(2),
          confidenceScore: conf,
          needsReview: conf < 0.85,
          uncertaintyReason: item.uncertaintyReason || (conf < 0.85 ? "Handwriting or digit uncertain" : null),
        };
      })
    : [];

  const currency = parsed.currency === "KES" ? "KES" : "USD";
  const deliveryFee = Math.max(0, parseFloat(parsed.deliveryFee) || 0);
  const overallConfidence = typeof parsed.overallConfidence === "number"
    ? Math.min(1, Math.max(0, parsed.overallConfidence))
    : 0.9;

  return {
    success: true,
    model: GEMINI_MODEL,
    customerName: (parsed.customerName || "").trim(),
    customerPhone: (parsed.customerPhone || "").trim(),
    customerEmail: (parsed.customerEmail || "").trim(),
    customerAddress: (parsed.customerAddress || "").trim(),
    agreedTerms: (parsed.agreedTerms || "").trim(),
    currency,
    paymentMethod: parsed.paymentMethod === "CASH_ON_DELIVERY" ? "CASH_ON_DELIVERY" : (currency === "USD" ? "PAYPAL" : "CASH_ON_DELIVERY"),
    deliveryFee: deliveryFee.toFixed(2),
    items: normalizedItems,
    overallConfidence,
    needsReview: overallConfidence < 0.85 || normalizedItems.some((i) => i.needsReview),
    notes: (parsed.notes || "").trim(),
    rawModelOutput: parsed,
  };
}
