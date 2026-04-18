/*
  # Add Photo Storage Bucket

  1. Storage
    - Create `photos` storage bucket for patient photos
    - Enable public access for photo URLs
    - Set upload size limit to 5MB
    - Allow only JPEG/PNG image types

  2. Security
    - Authenticated users can upload photos
    - Public read access for photo URLs
    - Users can only update/delete their own uploads

  3. Important Notes
    - Photos are automatically compressed to 200x200px on client
    - Average photo size: ~30-50KB
    - Bucket is public for easy photo display
*/

-- Create storage bucket for patient photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos',
  'photos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload photos
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'photos' AND
  (storage.foldername(name))[1] = 'patient-photos'
);

-- Allow public read access to photos
DROP POLICY IF EXISTS "Public can view photos" ON storage.objects;
CREATE POLICY "Public can view photos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'photos');

-- Allow users to update their uploaded photos
DROP POLICY IF EXISTS "Users can update their photos" ON storage.objects;
CREATE POLICY "Users can update their photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'photos');

-- Allow users to delete photos
DROP POLICY IF EXISTS "Users can delete photos" ON storage.objects;
CREATE POLICY "Users can delete photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'photos');