// Privacy notice for Med Bridge Health Reach.
//
// Every statement here must stay true to what the code does. If you add a
// data processor, a tracker or a new category of data, update this page.
// When the text changes, set PRIVACY_VERSION in ./policyMeta.ts to that day.
// Pending review by a qualified Nigerian data-protection lawyer (NDPA 2023)
// — see docs/legal/README.md.
import { LegalPage, LegalSection } from "./LegalPage";
import { PRIVACY_VERSION, formatPolicyDate } from "./policyMeta";

export default function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy notice" updated={formatPolicyDate(PRIVACY_VERSION)}>
      <p>
        Med Bridge Health Reach (mBHR) is used by the Dr. Isioma Okobah
        Foundation to run medical outreach clinics in Nigeria. This notice
        explains what information we record about patients and staff, why,
        where it is kept and who can see it.
      </p>

      <LegalSection title="What we record about patients">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Identity and contact details: name, sex, date of birth, phone
            number, email (optional), address, state and local government
            area, and a photograph if you agree to one.
          </li>
          <li>
            Clinical information from your visit: vital signs, allergies,
            consultation notes, diagnoses, lab orders and results, referrals,
            and medicines prescribed and dispensed.
          </li>
          <li>
            If you use the patient portal: your login details, which versions
            of the terms of use and this notice you accepted and when,
            appointment and prescription-refill requests, televisit requests,
            messages you send to staff, forms you complete and documents you
            upload.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Why we record it">
        <p>
          To give you care at the outreach and afterwards: to know who you are,
          keep your history available to the clinicians treating you, check
          medicines against your allergies, dispense the right medicine, remind
          you about follow-ups and appointments, and let you see your own
          record in the portal. We also count visits, diagnoses and medicines
          dispensed to report on each outreach; those reports do not name
          patients.
        </p>
      </LegalSection>

      <LegalSection title="Where it is kept">
        <p>
          mBHR works without internet. Records are saved first on the device
          the staff member is using. When cloud sync is switched on for an
          outreach, records are also copied to a secure database hosted by our
          provider, Supabase, so that other staff devices and the patient
          portal can see them. Access to that database is restricted by role.
        </p>
      </LegalSection>

      <LegalSection title="Who can see it">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Outreach staff, according to their role. For example, volunteers
            can register patients and record vital signs, doctors can document
            consultations, and pharmacists can dispense medicines.
          </li>
          <li>You, through the patient portal, and any caregiver you add.</li>
          <li>
            Service providers who process data for us only to run mBHR:
            Supabase (database and sign-in), Termii (text messages), Resend
            (email), and Jitsi Meet (video for televisits you request). If
            error monitoring is switched on, Sentry receives technical error
            reports; screen recordings it captures hide all text and images.
          </li>
          <li>
            Other health providers only where you are referred to them or have
            agreed to share your record in the portal’s data sharing settings.
          </li>
        </ul>
        <p>We do not sell your information or use it for advertising.</p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          We hold records for children seen at our clinics. You must be 18 or
          older to create your own portal account, and we check the date of
          birth you enter. When you sign up or log in, we do not link your
          account to a clinic record whose date of birth shows the person is
          under 18.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and device storage">
        <p>
          mBHR does not use advertising or analytics cookies. It stores data
          in your browser only so the app can work: records and settings kept
          for offline use, your language and accessibility preferences, and
          sign-in sessions. Because this storage is necessary for the app to
          function, there is no cookie banner.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          Medical records are kept for as long as they are needed to provide
          care and to meet our legal obligations for health records. Staff can
          remove a patient record on request where the law allows.
        </p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <p>
          You can ask to see, correct or delete the information we hold about
          you, and you can download your own record from the patient portal.
          You can withdraw from text-message reminders at any time. To make a
          request, speak to the outreach team or contact the Dr. Isioma Okobah
          Foundation.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
