import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    addPatient: vi.fn(),
    enrollPatientInPortal: vi.fn(),
    pushToast: vi.fn(),
    role: "nurse",
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/patients", () => ({
  usePatientsStore: () => ({ addPatient: mocks.addPatient }),
}));

vi.mock("@/stores/auth", () => {
  const state = () => ({ currentUser: { role: mocks.role } });
  const useAuthStore = (selector: (s: ReturnType<typeof state>) => unknown) =>
    selector(state());
  useAuthStore.getState = state;
  return { useAuthStore };
});

vi.mock("@/stores/toast", () => ({
  useToast: () => ({ push: mocks.pushToast }),
}));

vi.mock("@/services/unifiedPortalEnrollment", () => ({
  enrollPatientInPortal: (...args: unknown[]) =>
    mocks.enrollPatientInPortal(...args),
}));

vi.mock("@/components/PatientDedupeModal", () => ({
  PatientDedupeModal: () => null,
}));

vi.mock("@/components/PhotoCapture", () => ({
  PhotoCapture: () => null,
}));

vi.mock("@/components/AudioButton", () => ({
  AudioButton: ({
    children,
    type = "button",
    disabled,
    onClick,
    className,
  }: {
    children: ReactNode;
    type?: "button" | "submit";
    disabled?: boolean;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} className={className}>
      {children}
    </button>
  ),
}));

import { PatientForm } from "./PatientForm";
import { MINOR_PORTAL_ACCESS_MESSAGE } from "@/pages/legal/policyMeta";

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

function portalBox() {
  return byId<HTMLInputElement>("portalEnabled");
}

/** 1 January, ten years ago: someone under 18 whatever today's date is. */
function childDob(): string {
  return `${new Date().getFullYear() - 10}-01-01`;
}

async function fillRequiredFields(dob: string) {
  fireEvent.change(byId("givenName"), { target: { value: "Ada" } });
  fireEvent.change(byId("familyName"), { target: { value: "Obi" } });
  fireEvent.change(byId("sex"), { target: { value: "female" } });
  fireEvent.change(byId("dob"), { target: { value: dob } });
  fireEvent.change(byId("phone"), { target: { value: "08012345678" } });
  fireEvent.change(byId("address"), { target: { value: "1 Market Road" } });
  fireEvent.change(byId("state"), { target: { value: "Lagos" } });
  await waitFor(() =>
    expect(byId<HTMLSelectElement>("lga").disabled).toBe(false),
  );
  fireEvent.change(byId("lga"), { target: { value: "Ikeja" } });
}

describe("PatientForm portal access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "nurse";
    mocks.addPatient.mockResolvedValue("patient-1");
    mocks.enrollPatientInPortal.mockResolvedValue({ success: true, pending: true });
  });

  it("leaves portal access unticked when a phone number is typed", () => {
    render(<PatientForm />);
    fireEvent.change(byId("phone"), { target: { value: "08012345678" } });
    fireEvent.change(byId("email"), { target: { value: "ada@example.com" } });

    expect(portalBox().checked).toBe(false);
    expect(
      screen.queryByLabelText(/explained portal access terms/i),
    ).toBeNull();
  });

  it("asks for the staff attestation once portal access is ticked by hand", async () => {
    render(<PatientForm />);
    fireEvent.change(byId("phone"), { target: { value: "08012345678" } });
    fireEvent.click(portalBox());

    expect(portalBox().checked).toBe(true);
    const attestation = (await screen.findByLabelText(
      /explained portal access terms/i,
    )) as HTMLInputElement;
    expect(attestation.checked).toBe(false);
  });

  it("says the server decides and does not promise login instructions", async () => {
    render(<PatientForm />);
    fireEvent.change(byId("phone"), { target: { value: "08012345678" } });
    fireEvent.click(portalBox());
    await screen.findByLabelText(/explained portal access terms/i);

    expect(screen.getByText(/the clinic server decides/i)).toBeTruthy();
    expect(screen.queryByText(/login instructions/i)).toBeNull();
  });

  it("offers the invitation box only to roles with portal_invite", async () => {
    render(<PatientForm />);
    fireEvent.change(byId("phone"), { target: { value: "08012345678" } });
    fireEvent.click(portalBox());
    await screen.findByLabelText(/explained portal access terms/i);

    // A nurse holds portal_manage but not portal_invite.
    expect(screen.queryByLabelText(/send portal invitation now/i)).toBeNull();
    expect(screen.getByText(/sends the portal invitation from the patient/i)).toBeTruthy();
  });

  it("does not offer to send an invitation on registration, even to roles with portal_invite", async () => {
    // Registering never sends an invitation, so no box may promise one.
    mocks.role = "registration_lead";
    render(<PatientForm />);
    fireEvent.change(byId("phone"), { target: { value: "08012345678" } });
    fireEvent.click(portalBox());
    await screen.findByLabelText(/explained portal access terms/i);

    expect(screen.queryByLabelText(/send portal invitation now/i)).toBeNull();
    expect(screen.getByText(/does not send a portal invitation/i)).toBeTruthy();
  });

  it("asks for portal access only when the box was ticked and attested", async () => {
    render(<PatientForm />);
    await fillRequiredFields("1990-01-01");
    fireEvent.click(portalBox());
    fireEvent.click(await screen.findByLabelText(/explained portal access terms/i));

    fireEvent.submit(byId<HTMLInputElement>("givenName").form!);

    await waitFor(() => expect(mocks.enrollPatientInPortal).toHaveBeenCalledTimes(1));
    expect(mocks.enrollPatientInPortal).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: "patient-1", dob: "1990-01-01" }),
    );
    // mainone's toast for a change waiting for the server.
    await waitFor(() =>
      expect(mocks.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Portal access requested" }),
      ),
    );
  });

  it("does not enrol the patient in the portal when the box is left unticked", async () => {
    render(<PatientForm />);
    await fillRequiredFields("1990-01-01");

    fireEvent.submit(byId<HTMLInputElement>("givenName").form!);

    await waitFor(() => expect(mocks.addPatient).toHaveBeenCalledTimes(1));
    expect(mocks.enrollPatientInPortal).not.toHaveBeenCalled();
  });

  it("turns the box off and says why for a patient under 18", async () => {
    render(<PatientForm />);
    fireEvent.change(byId("phone"), { target: { value: "08012345678" } });
    fireEvent.click(portalBox());
    expect(portalBox().checked).toBe(true);

    fireEvent.change(byId("dob"), { target: { value: childDob() } });

    await waitFor(() => expect(portalBox().disabled).toBe(true));
    expect(portalBox().checked).toBe(false);
    expect(screen.getByText(MINOR_PORTAL_ACCESS_MESSAGE)).toBeTruthy();
    expect(
      screen.queryByLabelText(/explained portal access terms/i),
    ).toBeNull();
  });

  it("registers a patient under 18 without enrolling them in the portal", async () => {
    render(<PatientForm />);
    fireEvent.change(byId("phone"), { target: { value: "08012345678" } });
    fireEvent.click(portalBox());
    fireEvent.click(
      await screen.findByLabelText(/explained portal access terms/i),
    );
    await fillRequiredFields(childDob());
    await waitFor(() => expect(portalBox().disabled).toBe(true));

    fireEvent.submit(byId<HTMLInputElement>("givenName").form!);

    await waitFor(() => expect(mocks.addPatient).toHaveBeenCalledTimes(1));
    expect(mocks.enrollPatientInPortal).not.toHaveBeenCalled();
  });
});
