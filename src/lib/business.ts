/**
 * Verified business information supplied by the clinic owner.
 * This is the ONLY source of facts the assistant may state. Do not add prices,
 * service areas, therapist credentials or treatment lists here unless the clinic
 * has confirmed them in writing. Safe to import from client components (no secrets).
 */
export const BUSINESS = {
  name: "Physiotherapy Treatment at Home",
  category: "Physiotherapist / Home physiotherapy services",
  address:
    "9/100, Ground Floor, ATA Street, opposite Brigade MM A Block, near H.N. Fashion, Yediyur, Jayanagar 6th Block, Bengaluru, Karnataka 560082",
  phoneDisplay: "077158 77047",
  phoneTel: "+917715877047",
  website: "https://physiotherapytreatmentathome.com",
  listedHours: "Open 24 hours",
  googleRating: { stars: "5.0", reviews: 49 },
  womenOwned: true,
  city: "Bengaluru",
} as const;

/** India's national emergency number. Ambulance: 108. */
export const EMERGENCY = { general: "112", ambulance: "108" } as const;

export const UNKNOWN_FALLBACK =
  "I'd be happy to help you check that. The clinic team can confirm the latest details. Would you like me to submit an enquiry or share the clinic's contact number?";

export const SUBMITTED_MESSAGE =
  "Thank you! Your appointment request has been submitted to the clinic. This is a request, not a confirmed booking. The clinic team will contact you to verify availability and confirm the appointment.";

export const GREETING =
  "Hello! Welcome to Physiotherapy Treatment at Home. I'm the clinic's virtual appointment assistant. I can help you learn about our services and submit a home physiotherapy appointment request. How may I help you today?";

export const CONSENT_TEXT =
  "I agree that the details I have entered may be stored and shared with Physiotherapy Treatment at Home so the clinic team can contact me about this appointment request. I will not receive promotional messages from this request.";
