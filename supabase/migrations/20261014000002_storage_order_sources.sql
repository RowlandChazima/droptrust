-- ==============================================================================
-- DropTrust Capture — Storage Migration: Order Sources Bucket & Isolation RLS
-- Milestone 5: Gemini 3.8 Flash Multimodal OCR Review Studio
-- ==============================================================================

-- 1. Create the private 'order-sources' bucket if it does not already exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-sources',
  'order-sources',
  FALSE,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'];

-- 2. Ensure RLS is active on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Merchants can read order sources uploaded under their own business ID
DROP POLICY IF EXISTS "order_sources_merchant_select" ON storage.objects;
CREATE POLICY "order_sources_merchant_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'order-sources' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.businesses WHERE owner_user_id = auth.uid()
  )
);

-- 4. Policy: Merchants can upload order sources into their own business folder
DROP POLICY IF EXISTS "order_sources_merchant_insert" ON storage.objects;
CREATE POLICY "order_sources_merchant_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'order-sources' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.businesses WHERE owner_user_id = auth.uid()
  )
);

-- 5. Policy: Merchants can delete order sources in their own business folder (for purging)
DROP POLICY IF EXISTS "order_sources_merchant_delete" ON storage.objects;
CREATE POLICY "order_sources_merchant_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'order-sources' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.businesses WHERE owner_user_id = auth.uid()
  )
);
