import { supabase } from "@/lib/supabase";

// Patient photos in Supabase Storage.
//
// The "photos" bucket is private: a photo can only be read through a signed
// URL, which expires after SIGNED_URL_TTL_SECONDS. Use getPhotoUrl() to get a
// fresh one each time a photo is shown; a signed URL kept in a record stops
// working after it expires. The shared client is used so the signed-in staff
// member's session applies to the bucket's access rules.
//
// Logging: only error names are logged, never file paths (they contain the
// patient id) or error messages.

const BUCKET = "photos";
const FOLDER = "patient-photos";

/** Signed photo URLs are short-lived: long enough to load and show. */
export const SIGNED_URL_TTL_SECONDS = 10 * 60;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Storage path ("patient-photos/<file>.jpg") of a photo, from a stored path,
 * a signed URL or an old public URL. Null for anything else (for example a
 * data: URL kept on this device only).
 */
export function photoPathFromUrl(photoUrl: string): string | null {
  if (!photoUrl || photoUrl.startsWith("data:")) return null;
  const withoutQuery = photoUrl.split(/[?#]/)[0];
  const marker = `/${BUCKET}/${FOLDER}/`;
  const at = withoutQuery.indexOf(marker);
  let path: string | null = null;
  if (at >= 0) {
    path = withoutQuery.slice(at + BUCKET.length + 2);
  } else if (withoutQuery.startsWith(`${FOLDER}/`)) {
    path = withoutQuery;
  }
  if (!path) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  // One file directly inside the folder; nothing that climbs out of it.
  return /^patient-photos\/[^/]+$/.test(path) && !path.includes("..") ? path : null;
}

async function signedUrlFor(path: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      console.warn("Photo link could not be created:", errorName(error));
      return null;
    }
    return data.signedUrl;
  } catch (error) {
    console.warn("Photo link could not be created:", errorName(error));
    return null;
  }
}

/**
 * A URL that can show the photo now. Photos kept on this device (data:
 * URLs) are returned as they are; stored photos get a fresh signed URL.
 * Null when the photo cannot be shown (not configured, offline, no access).
 */
export async function getPhotoUrl(photoUrl: string | null | undefined): Promise<string | null> {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("data:")) return photoUrl;
  const path = photoPathFromUrl(photoUrl);
  if (!path) return null;
  return signedUrlFor(path);
}

/**
 * Uploads a photo and returns a signed URL for showing it now (it expires
 * after SIGNED_URL_TTL_SECONDS; call getPhotoUrl() to show it again later).
 * When the server is not configured or the upload fails, the photo stays on
 * this device only and the data URL is returned unchanged.
 */
export async function uploadPhoto(
  patientId: string,
  photoDataUrl: string,
): Promise<string | null> {
  if (!supabase) {
    console.warn("Supabase not configured, storing photo locally only");
    return photoDataUrl;
  }

  try {
    const base64Data = photoDataUrl.split(",")[1];
    const blob = base64ToBlob(base64Data, "image/jpeg");

    const fileName = `${patientId}-${Date.now()}.jpg`;
    const filePath = `${FOLDER}/${fileName}`;

    const { error } = await supabase.storage.from(BUCKET).upload(filePath, blob, {
      contentType: "image/jpeg",
      upsert: true,
    });

    if (error) {
      console.error("Photo upload error:", errorName(error));
      return photoDataUrl;
    }

    // The bucket is private, so there is no public URL. If a link cannot be
    // made right now, keep showing the photo from this device.
    return (await signedUrlFor(filePath)) ?? photoDataUrl;
  } catch (error) {
    console.error("Photo upload failed:", errorName(error));
    return photoDataUrl;
  }
}

/**
 * Deletes a stored photo, given its signed URL, old public URL or storage
 * path. Photos kept on this device only (data: URLs) need no server delete.
 */
export async function deletePhoto(photoUrl: string): Promise<boolean> {
  const filePath = photoPathFromUrl(photoUrl);
  if (!supabase || !filePath) {
    return true;
  }

  try {
    const { error } = await supabase.storage.from(BUCKET).remove([filePath]);

    if (error) {
      console.error("Photo delete error:", errorName(error));
      return false;
    }

    return true;
  } catch (error) {
    console.error("Photo delete failed:", errorName(error));
    return false;
  }
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }

  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

export function compressImage(
  dataUrl: string,
  maxWidth: number = 200,
  maxHeight: number = 200,
  quality: number = 0.8,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Canvas context not available"));
        return;
      }

      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const compressed = canvas.toDataURL("image/jpeg", quality);
      resolve(compressed);
    };

    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };

    img.src = dataUrl;
  });
}

export function estimatePhotoSize(dataUrl: string): number {
  const base64Length = dataUrl.split(",")[1]?.length || 0;
  return Math.ceil(base64Length * 0.75);
}
