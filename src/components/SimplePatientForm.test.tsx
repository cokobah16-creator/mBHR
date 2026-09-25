import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ addPatient: vi.fn() }));

// Translation keys stand in for the text; audio prompts do nothing.
vi.mock("@/hooks/useT", () => ({
  useT: () => ({ t: (key: string) => key, speak: () => Promise.resolve() }),
}));

vi.mock("@/stores/patients", () => ({
  usePatientsStore: () => ({ addPatient: h.addPatient }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: (select: (s: { currentUser: { role: string } }) => unknown) =>
    select({ currentUser: { role: "nurse" } }),
}));

vi.mock("@/components/PatientDedupeModal", () => ({
  PatientDedupeModal: () => null,
}));

import { SimplePatientForm } from "./SimplePatientForm";

const next = () => screen.getByRole("button", { name: "action.next" });
const ageBox = () => screen.getByRole("spinbutton");
const typeInto = (el: HTMLElement, value: string) =>
  fireEvent.change(el, { target: { value } });

/** Fills in the steps before the age and stops on the age step. */
function openAgeStep() {
  render(<SimplePatientForm />);
  fireEvent.click(next()); // the photo is optional
  typeInto(screen.getByLabelText(/patient\.givenName/), "Ada");
  typeInto(screen.getByLabelText(/patient\.familyName/), "Obi");
  fireEvent.click(next());
  fireEvent.click(screen.getByRole("button", { name: "patient.female" }));
}

describe("SimplePatientForm age step", () => {
  beforeEach(() => {
    h.addPatient.mockReset();
  });

  it("stays invalid when 0 is typed in Years, instead of keeping 25", () => {
    openAgeStep();
    expect(ageBox()).toHaveValue(25);
    expect(next()).toBeEnabled();

    typeInto(ageBox(), "0");

    expect(ageBox()).toHaveValue(0);
    expect(ageBox()).toHaveAttribute("aria-invalid", "true");
    expect(next()).toBeDisabled();

    typeInto(ageBox(), "1");
    expect(next()).toBeEnabled();
  });

  it("stays invalid when 30 is typed in Months", () => {
    openAgeStep();
    fireEvent.click(screen.getByRole("button", { name: "common.months" }));
    expect(ageBox()).toHaveValue(0);
    expect(next()).toBeEnabled();

    // Typing 30 passes through 3, which is a valid age in months.
    typeInto(ageBox(), "3");
    expect(next()).toBeEnabled();
    typeInto(ageBox(), "30");

    expect(ageBox()).toHaveValue(30);
    expect(next()).toBeDisabled();
  });

  it("stays invalid while the age box is empty", () => {
    openAgeStep();
    typeInto(ageBox(), "");
    expect(next()).toBeDisabled();
  });

  it("starts the plus button from the lowest age after an entry it did not accept", () => {
    openAgeStep();
    typeInto(ageBox(), "0");
    fireEvent.click(screen.getByRole("button", { name: "Increase patient.age" }));

    expect(ageBox()).toHaveValue(2);
    expect(next()).toBeEnabled();
  });
});
