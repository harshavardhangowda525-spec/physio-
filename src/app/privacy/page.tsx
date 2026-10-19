import { Atmosphere } from "@/components/Atmosphere";
import { BUSINESS } from "@/lib/business";

export const metadata = { title: "Privacy notice — Physiotherapy Treatment at Home" };

export default function Privacy() {
  return (
    <>
      <Atmosphere />
      <main style={{ padding: "28px 16px" }}>
        <article className="prose glass">
          <h1>Privacy notice</h1>
          <p>This notice explains how the online appointment assistant for {BUSINESS.name} handles the details you share.</p>

          <h2>What we collect</h2>
          <ul>
            <li>Patient name and contact phone number</li>
            <li>Preferred date, time and locality for the home visit</li>
            <li>A short description, in your own words, of why you would like physiotherapy</li>
            <li>Any therapist preference you choose, and the time you gave consent</li>
          </ul>
          <p>We do not ask for government ID numbers, payment details or medical records. Please don&apos;t enter them.</p>

          <h2>How it is used</h2>
          <p>
            Your details are used only so the clinic team can review your request and contact you about it. Submitting a request does not
            confirm an appointment — the clinic will contact you to confirm availability. Your details are not used for promotional messages.
          </p>

          <h2>Who can see it</h2>
          <p>
            Only authorised clinic staff, who sign in to a protected dashboard. Staff receive an email alert containing the request
            details so they can follow up. Every status change is recorded.
          </p>

          <h2>How long it is kept</h2>
          <p>
            Unsubmitted chat drafts are deleted after 24 hours. Submitted requests are kept for the clinic&apos;s configured retention
            period and then deleted. You can ask for your details to be deleted at any time by calling {BUSINESS.phoneDisplay}.
          </p>

          <h2>Not for emergencies</h2>
          <p>
            The assistant cannot give medical advice. If you have a medical emergency, call 112 or 108, or go to the nearest emergency
            department.
          </p>

          <h2>Contact</h2>
          <p>
            {BUSINESS.name}, {BUSINESS.address}. Phone: <a href={`tel:${BUSINESS.phoneTel}`}>{BUSINESS.phoneDisplay}</a>.
          </p>
          <p className="muted">
            Clinic: please review this notice with your own adviser before launch and adjust the retention period to match your policy.
          </p>
        </article>
      </main>
    </>
  );
}
