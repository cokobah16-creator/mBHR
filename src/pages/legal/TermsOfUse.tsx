// Terms of use for Med Bridge Health Reach.
// Pending review by a qualified Nigerian lawyer — see docs/legal/README.md.
import { LegalPage, LegalSection } from "./LegalPage";

export default function TermsOfUse() {
  return (
    <LegalPage title="Terms of use" updated="22 September 2026">
      <p>
        These terms cover the use of Med Bridge Health Reach (mBHR), the
        outreach record system and patient portal operated by the Dr. Isioma
        Okobah Foundation.
      </p>

      <LegalSection title="The patient portal">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            The portal shows records from outreach visits. It does not replace
            advice from a clinician who has examined you.
          </li>
          <li>
            <strong className="text-ink">
              It is not an emergency service.
            </strong>{" "}
            If you need urgent help, go to the nearest hospital or call
            emergency services. Messages and requests are answered by the
            outreach team when they are available, not immediately.
          </li>
          <li>
            Keep your password or PIN private. You are responsible for requests
            made from your account, including by any caregiver you add.
          </li>
          <li>
            Only upload documents and information about yourself or someone you
            are authorised to act for.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Staff use">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Use mBHR only for the outreach you are assigned to and only for the
            patients you are caring for.
          </li>
          <li>
            Do not share your PIN. Actions are recorded against your account.
          </li>
          <li>
            Check that the outreach site shown at the top of the screen is
            correct before registering patients or starting visits.
          </li>
          <li>
            Do not copy patient information out of mBHR except through its
            export and reporting features, and only when authorised.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Availability">
        <p>
          mBHR is designed to keep working without internet, but records only
          reach other devices and the patient portal after they have synced.
          The sync indicator at the top of the staff screen shows whether
          anything is still waiting to upload.
        </p>
      </LegalSection>

      <LegalSection title="Privacy">
        <p>
          How we handle personal and health information is described in the{" "}
          <a href="/privacy" className="text-primary font-medium hover:underline">
            privacy notice
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
