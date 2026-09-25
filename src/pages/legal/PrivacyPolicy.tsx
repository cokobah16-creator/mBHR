// Privacy notice for Med Bridge Health Reach.
//
// Every statement here must stay true to what the code does. If you add a
// data processor, a tracker or a new category of data, update this page.
// When the text changes, set PRIVACY_VERSION in ./policyMeta.ts to that day.
// PrivacyPolicy.test.tsx checks that every service found in the code is
// named here, and that "Your sharing choices" matches DEFAULT_SHARING_FLAGS
// in src/features/patient-portal/account/sharingChanges.ts.
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
          <li>The service providers listed below, only to run mBHR.</li>
          <li>
            Other health providers where you are referred to them. Other
            organisations may also ask for a copy of your records. See “Your
            sharing choices” below.
          </li>
        </ul>
        <p>We do not sell your information or use it for advertising.</p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>These companies handle data for us only to run mBHR.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase runs our online database, file storage and sign-in.</li>
          <li>
            Termii sends our text messages. It receives your phone number and
            the message. A message can include your name, a medicine, an
            appointment time or a televisit link.
          </li>
          <li>
            Twilio sends our text messages instead of Termii if Termii is not
            set up. It then receives the same details.
          </li>
          <li>
            Resend sends our emails. It receives your email address and the
            message.
          </li>
          <li>
            Vercel hosts the app. When your device loads the app from the
            internet, Vercel receives your device’s IP address, browser details
            and the address of the page. Your records do not pass through
            Vercel. An invitation link from the clinic includes your email
            address or phone number, so Vercel also receives it when you open
            the link.
          </li>
          <li>
            GitHub Actions runs our nightly database backup. The backup file is
            made on a GitHub computer, then saved in our Supabase account. No
            copy is kept on GitHub.
          </li>
          <li>
            While the app starts, it may download an outline map of Nigeria
            from jsDelivr, or from Statically if jsDelivr cannot be reached.
            That request shows the service your device’s IP address and
            browser details. No health information is sent.
          </li>
          <li>
            Televisits use the public video service meet.jit.si, run by 8x8,
            unless the Foundation has set up a different video server. The
            video service carries the sound and picture of the call and sees
            your device’s IP address.
          </li>
          <li>
            If error monitoring is switched on, Sentry receives technical error
            reports; screen recordings it captures hide all text and images.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Your sharing choices">
        <p>
          In the patient portal, “Manage Data Sharing” lets you choose which
          other organisations may ask for a copy of your records. Until you
          save your own choices, they are set like this:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Other hospitals and clinics treating you: not allowed.</li>
          <li>
            Health apps you choose: allowed, so you can connect an app to
            download a copy of your own records.
          </li>
          <li>Health insurance and payment: not allowed.</li>
          <li>Quality checks and training: not allowed.</li>
        </ul>
        <p>
          You can change these choices there at any time. They are saved as a
          record of your wishes. Requests are not yet checked against them
          automatically, so also tell clinic staff if you want sharing
          stopped.
        </p>
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
