import { describe, it, expect } from "vitest";
import { photoPathFromUrl } from "./photoStorage";

// photoPathFromUrl turns whatever a patient record holds (a storage path, a
// signed URL or an old public URL) into the storage path, so a fresh signed
// URL can be made each time the photo is shown.
describe("photoPathFromUrl", () => {
  const base = "https://project.supabase.co/storage/v1/object";

  it("keeps a stored path as it is", () => {
    expect(photoPathFromUrl("patient-photos/p1-1700000000000.jpg")).toBe(
      "patient-photos/p1-1700000000000.jpg",
    );
  });

  it("reads the path from a signed URL and drops the token", () => {
    expect(
      photoPathFromUrl(
        `${base}/sign/photos/patient-photos/p1-1700000000000.jpg?token=abc.def.ghi`,
      ),
    ).toBe("patient-photos/p1-1700000000000.jpg");
  });

  it("reads the path from an old public URL", () => {
    expect(
      photoPathFromUrl(`${base}/public/photos/patient-photos/p1-1700000000000.jpg`),
    ).toBe("patient-photos/p1-1700000000000.jpg");
  });

  it("drops a fragment after the file name", () => {
    expect(photoPathFromUrl("patient-photos/p1.jpg#preview")).toBe("patient-photos/p1.jpg");
  });

  it("decodes an encoded file name", () => {
    expect(photoPathFromUrl(`${base}/sign/photos/patient-photos/p%201.jpg?token=x`)).toBe(
      "patient-photos/p 1.jpg",
    );
  });

  it("returns null for photos kept on this device only", () => {
    expect(photoPathFromUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBeNull();
  });

  it("returns null for an empty value", () => {
    expect(photoPathFromUrl("")).toBeNull();
  });

  it("returns null for a URL outside the photos folder", () => {
    expect(photoPathFromUrl(`${base}/sign/photos/other-folder/p1.jpg?token=x`)).toBeNull();
    expect(photoPathFromUrl(`${base}/sign/avatars/patient-photos/p1.jpg?token=x`)).toBeNull();
    expect(photoPathFromUrl("https://example.com/p1.jpg")).toBeNull();
    expect(photoPathFromUrl("other-folder/p1.jpg")).toBeNull();
  });

  it("returns null for the folder itself or a nested path", () => {
    expect(photoPathFromUrl("patient-photos/")).toBeNull();
    expect(photoPathFromUrl("patient-photos/sub/p1.jpg")).toBeNull();
    expect(photoPathFromUrl(`${base}/sign/photos/patient-photos/sub/p1.jpg?token=x`)).toBeNull();
  });

  it("refuses paths that climb out of the folder, encoded or not", () => {
    expect(photoPathFromUrl("patient-photos/../secrets.jpg")).toBeNull();
    expect(photoPathFromUrl("patient-photos/..")).toBeNull();
    expect(
      photoPathFromUrl(`${base}/sign/photos/patient-photos/%2E%2E%2Fsecrets.jpg?token=x`),
    ).toBeNull();
    expect(photoPathFromUrl(`${base}/sign/photos/patient-photos/a%2Fb.jpg?token=x`)).toBeNull();
  });

  it("returns null for a badly encoded file name", () => {
    expect(photoPathFromUrl(`${base}/sign/photos/patient-photos/p%E0%A4%A.jpg`)).toBeNull();
  });
});
