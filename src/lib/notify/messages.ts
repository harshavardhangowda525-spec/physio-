import type { Enquiry } from "@/db/schema";
import { formatDate, formatPhone } from "@/lib/validation";
import { env } from "@/lib/env";

export const PREFERENCE_LABEL: Record<Enquiry["therapistPreference"], string> = {
  NO_PREFERENCE: "No preference",
  FEMALE: "Female therapist (if available)",
  MALE: "Male therapist (if available)",
};

export type NotificationEvent = "NEW_ENQUIRY" | "PATIENT_CANCEL_REQUEST" | "PATIENT_RESCHEDULE_REQUEST";

/** Keeps the patient's own words but caps length so notifications stay minimal. */
function shortReason(reason: string): string {
  return reason.length > 200 ? `${reason.slice(0, 197)}...` : reason;
}

export function buildStaffNotification(e: Enquiry, event: NotificationEvent): { subject: string; text: string } {
  const link = `${env().APP_URL}/dashboard/enquiries/${e.id}`;
  if (event === "NEW_ENQUIRY") {
    return {
      subject: `New home physiotherapy enquiry ${e.reference}`,
      text: [
        "NEW HOME PHYSIOTHERAPY ENQUIRY",
        `Reference: ${e.reference}`,
        `Patient: ${e.patientName}`,
        `Phone: ${formatPhone(e.contactNumber)}`,
        `Preferred date: ${formatDate(e.preferredDate)}`,
        `Preferred time: ${e.preferredTime}`,
        `Locality: ${e.locality}`,
        `Reason: ${shortReason(e.serviceRequirement)}`,
        `Therapist preference: ${PREFERENCE_LABEL[e.therapistPreference]}`,
        "Status: Awaiting Clinic Review",
        "Please verify availability and contact the patient.",
        "",
        `Open in dashboard (staff login required): ${link}`,
      ].join("\n"),
    };
  }
  const kind = event === "PATIENT_CANCEL_REQUEST" ? "CANCELLATION" : "RESCHEDULE";
  return {
    subject: `Patient ${kind.toLowerCase()} request for ${e.reference}`,
    text: [
      `PATIENT ${kind} REQUEST`,
      `Reference: ${e.reference}`,
      `Patient: ${e.patientName}`,
      `Phone: ${formatPhone(e.contactNumber)}`,
      `Originally preferred: ${formatDate(e.preferredDate)}, ${e.preferredTime}`,
      `Patient's message: ${e.patientChangeRequest ?? "(none)"}`,
      "Please contact the patient to follow up.",
      "",
      `Open in dashboard (staff login required): ${link}`,
    ].join("\n"),
  };
}
