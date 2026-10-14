import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Order ID is required." }, { status: 400 });
    }

    const supabase = await createClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    // 2. Fetch business
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (!business) {
      return NextResponse.json({ error: "Business profile not found." }, { status: 404 });
    }

    // 3. Verify order ownership
    const { data: order } = await supabase
      .from("orders")
      .select("id, business_id")
      .eq("id", id)
      .eq("business_id", business.id)
      .maybeSingle();

    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    // 4. Fetch latest extraction record with a stored image
    const { data: record } = await supabase
      .from("extraction_records")
      .select("storage_file_path")
      .eq("order_id", order.id)
      .not("storage_file_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!record || !record.storage_file_path) {
      return NextResponse.json(
        { error: "No image source found for this order or image has been purged." },
        { status: 404 }
      );
    }

    // 5. Download image from private bucket
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("order-sources")
      .download(record.storage_file_path);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: "Failed to download image from storage." },
        { status: 404 }
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const contentType = fileData.type || "image/jpeg";

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
