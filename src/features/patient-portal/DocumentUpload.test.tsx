import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  signedUrl: vi.fn(),
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabaseClient", () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve({ data: mocks.rows, error: null }),
  };
  return {
    isSupabaseEnabled: true,
    supabase: {
      from: () => builder,
      storage: { from: () => ({ createSignedUrl: mocks.signedUrl }) },
    },
  };
});
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
  isDeviceOnline: () => true,
}));

import { DocumentUpload } from "./DocumentUpload";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.signedUrl.mockReset();
  mocks.rows = [
    {
      id: "d1",
      document_name: "Scan.pdf",
      document_type: "imaging",
      created_at: "2026-09-01T10:00:00Z",
      upload_source: "staff",
      file_path: "patient-documents/p1/1.pdf",
    },
  ];
  localStorage.setItem(
    "patient_portal_user",
    JSON.stringify({ id: "u1", patientId: "p1", givenName: "Ada", familyName: "O" }),
  );
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/patient/documents"]}>
      <DocumentUpload />
    </MemoryRouter>,
  );
}

describe("DocumentUpload", () => {
  it("opens a stored file through a short-lived private link", async () => {
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    mocks.signedUrl.mockResolvedValue({ data: { signedUrl: "https://files/x" }, error: null });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open Scan.pdf" }));
    await waitFor(() => expect(tab.location.href).toBe("https://files/x"));
    expect(mocks.signedUrl).toHaveBeenCalledWith("p1/1.pdf", 60);
    expect(tab.opener).toBeNull();
    open.mockRestore();
  });

  it("says so, and closes the empty tab, when the file cannot be opened", async () => {
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    mocks.signedUrl.mockResolvedValue({ data: null, error: new Error("Object not found") });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open Scan.pdf" }));
    expect(
      await screen.findByText("This file could not be opened here. Ask clinic staff for a copy."),
    ).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
    open.mockRestore();
  });

  it("shows a clinic record's type and source in English", async () => {
    renderPage();
    expect(await screen.findByText("Clinic record")).toBeInTheDocument();
    expect(screen.getByText(/^Scan or X-ray ·/)).toBeInTheDocument();
  });
});
