import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    addPatient: vi.fn(),
    enrollPatientInPortal: vi.fn(),
    pushToast: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/patients", () => ({
  usePatientsStore: () => ({ addPatient: mocks.addPatient }),
}));

vi.mock("@/stores/auth", () => {
  const state = { currentUser: { role: "nurse" } };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
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
    mocks.addPatient.mockResolvedValue("patient-1");
    mocks.enrollPatientInPortal.mockResolvedValue({ success: true });
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

  it("does not promise a message: enrolment sends none", async () => {
    render(<PatientForm />);
    fireEvent.change(byId("phone"), { target: { value: "08012345678" } });
    fireEvent.click(portalBox());
    await screen.findByLabelText(/explained portal access terms/i);

    expect(screen.getByText(/no message is sent to the patient/i)).toBeTruthy();
    expect(screen.queryByText(/login instructions/i)).toBeNull();
    expect(screen.queryByLabelText(/send portal invitation now/i)).toBeNull();
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
