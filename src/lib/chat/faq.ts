import { BUSINESS, UNKNOWN_FALLBACK } from "@/lib/business";

export type FaqIntent =
  | "home_visits"
  | "how_to_request"
  | "contact_number"
  | "location"
  | "hours"
  | "service_areas"
  | "services"
  | "prices"
  | "female_therapist"
  | "change_cancel"
  | "rating"
  | "about"
  | "privacy";

export const FAQ_INTENTS: FaqIntent[] = [
  "home_visits",
  "how_to_request",
  "contact_number",
  "location",
  "hours",
  "service_areas",
  "services",
  "prices",
  "female_therapist",
  "change_cancel",
  "rating",
  "about",
  "privacy",
];

/** Ordered: more specific intents first. */
const RULES: { intent: FaqIntent; patterns: RegExp[] }[] = [
  {
    intent: "prices",
    patterns: [
      /\b(price|prices|pricing|priced|cost|costs|charge|charges|charged|fee|fees|rates?|packages?|discounts?|insurance|payment|pay|paid|afford|expensive|cheap)\b/i,
      /how much|₹|rupees?|\brs\.?\s?\d/i,
    ],
  },
  {
    intent: "female_therapist",
    patterns: [/(female|lady|woman|women|male|man|gents?) (physio|therapist|physiotherapist|doctor)/i, /(physio|therapist).{0,15}(female|lady|woman|male)/i],
  },
  {
    intent: "change_cancel",
    patterns: [/(change|cancel|resched|postpone|move|modify|update).{0,25}(appointment|request|booking|visit|enquiry)/i, /^(cancel|reschedule)\b/i],
  },
  {
    intent: "service_areas",
    patterns: [/(area|areas|locality|localities|location|locations|place|places|region|zone|pin ?code)s? .{0,20}(cover|serve|visit|come)/i, /(do you|can you|will you) (come|visit|cover|serve) /i, /cover (my|our) area|service area|which areas/i],
  },
  {
    intent: "contact_number",
    patterns: [/phone|number|contact|call|mobile|whats ?app|reach (you|the clinic)/i],
  },
  {
    intent: "location",
    patterns: [/where|address|located|location|directions|map|clinic (is|at)/i],
  },
  {
    intent: "hours",
    patterns: [/hour|timing|open|close|closing|24 ?(x|\/)? ?7|sunday|weekend|holiday|night/i],
  },
  {
    intent: "home_visits",
    patterns: [/(at|to) (my |our )?home|home ?visit|house ?call|come (home|to (my|our) (house|home|place))|visit (my|our) (home|house)/i],
  },
  {
    intent: "how_to_request",
    patterns: [/how (do|can|to) i? ?(book|request|get|make|schedule)|booking process|process|procedure|appointment/i],
  },
  {
    intent: "services",
    patterns: [/treat|service|therapy|rehab|condition|offer|provide|specialis|speciali[sz]e|knee|back|neck|shoulder|stroke rehab|sports|post[- ]?op|surgery|elderly|paediatric|pediatric/i],
  },
  { intent: "rating", patterns: [/rating|review|reputation|stars?|google/i] },
  { intent: "privacy", patterns: [/privacy|data|personal information|delete my|who (can )?see/i] },
  { intent: "about", patterns: [/about (you|the clinic)|who (are|runs) (you|the clinic)|owner|women[- ]owned|qualif|credential|experience|degree|certified/i] },
];

export function matchFaq(text: string): FaqIntent | null {
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.intent;
  }
  return null;
}

const confirmLine =
  "Please note: visit availability and appointment slots must be confirmed by the clinic team.";

/** Answers use verified business information only. Unknowns use UNKNOWN_FALLBACK. */
export function answerFaq(intent: FaqIntent): string {
  switch (intent) {
    case "home_visits":
      return `Yes — ${BUSINESS.name} provides physiotherapy treatment at home in ${BUSINESS.city}. You can submit a home-visit appointment request here and the clinic team will contact you to confirm. ${confirmLine}`;
    case "how_to_request":
      return `It's simple: choose "Request a home physiotherapy appointment", and I'll ask for your name, phone number, preferred date and time, locality and a short description of what you need help with. You'll review the details, then submit. You'll get a reference number — but it's a request, not a confirmed booking, until the clinic team contacts you.`;
    case "contact_number":
      return `You can call the clinic on ${BUSINESS.phoneDisplay}.`;
    case "location":
      return `The clinic's address is: ${BUSINESS.address}.`;
    case "hours":
      return `The clinic is listed as "${BUSINESS.listedHours}". ${confirmLine}`;
    case "service_areas":
      return `The clinic is based in Jayanagar, ${BUSINESS.city}. I don't have a confirmed list of areas covered for home visits. ${UNKNOWN_FALLBACK}`;
    case "services":
      return `The clinic provides physiotherapy treatment at home. I don't have a verified list of specific treatments or rehabilitation programmes, so I can't confirm whether a particular service is offered. ${UNKNOWN_FALLBACK}`;
    case "prices":
      return UNKNOWN_FALLBACK;
    case "female_therapist":
      return `You can tell us your therapist preference (female, male or no preference) in your appointment request. The clinic will let you know whether it can be accommodated — I can't guarantee it in advance.`;
    case "change_cancel":
      return `Yes. Choose "Change or cancel a request" and give your reference number and the phone number you used. The clinic team will be notified. You can also call ${BUSINESS.phoneDisplay}.`;
    case "rating":
      return `The clinic's Google listing showed a ${BUSINESS.googleRating.stars}-star rating from ${BUSINESS.googleRating.reviews} reviews when this assistant was set up.`;
    case "about":
      return `${BUSINESS.name} is a women-owned home physiotherapy service based in Jayanagar, ${BUSINESS.city}. For details about the therapists and their qualifications, ${UNKNOWN_FALLBACK.charAt(0).toLowerCase()}${UNKNOWN_FALLBACK.slice(1)}`;
    case "privacy":
      return `Details you submit are stored securely and shared only with the clinic team so they can follow up on your request. Only authorised clinic staff can view them. To have your details deleted, call ${BUSINESS.phoneDisplay}. See the Privacy notice link below the chat for more.`;
  }
}
