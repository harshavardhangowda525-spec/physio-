import { BUSINESS, EMERGENCY } from "@/lib/business";

/**
 * Red-flag phrases that suggest an emergency. Deliberately broad: a false positive
 * only adds advice to seek urgent care, while a false negative could delay care.
 */
const URGENT_PATTERNS: RegExp[] = [
  /chest (pain|tightness|pressure)/i,
  /(can'?t|cannot|unable to|difficulty|trouble|hard to) breath/i,
  /short(ness)? of breath|breathless/i,
  /unconscious|passed out|fainted|not responding|unresponsive/i,
  /(having|signs of|symptoms of) (a )?stroke\b|stroke (right )?now|face (is |has )?droop|slurred speech/i,
  /sudden (weakness|numbness|paralysis|loss of (vision|speech))/i,
  /(heavy|severe|uncontrolled) bleeding|bleeding (heavily|a lot)/i,
  /(loss of|lost|no) (bladder|bowel) control|numb(ness)? (in|around) (the )?(groin|saddle)/i,
  /(can'?t|cannot|unable to) (move|feel) (my|his|her|their) (legs?|arms?)/i,
  /seizure|convulsion|fit(s)? (now|again)/i,
  /suicid|kill (my)?self|end my life|self[- ]harm/i,
  /broken bone|bone (is )?sticking out|compound fracture/i,
  /head injury|hit (my|his|her|their) head/i,
  /severe (pain|swelling) after (a )?(fall|accident)|fell and (can'?t|cannot)/i,
  /emergency|ambulance/i,
];

const DIAGNOSIS_PATTERNS: RegExp[] = [
  /diagnos/i,
  /what('?s| is) wrong with (me|my)/i,
  /what (condition|disease|injury) (do|does|could|might|is)/i,
  /\bis (it|this|my .{1,30}) (a |an )?(fracture|broken|torn|tear|slip(ped)? disc|sciatica|arthritis|sprain)/i,
  /\bdo i have\b/i,
  /which (exercise|exercises|medicine|medication|tablet|treatment|cream|ointment)/i,
  /what (exercise|exercises|medicine|medication|tablet|treatment|painkiller)s? (should|can|do) i/i,
  /should i (take|use|apply|do|stop|ice|heat)/i,
  /(recommend|suggest|prescribe) (an? )?(exercise|medicine|medication|treatment|tablet|painkiller)/i,
  /how (long|soon) (will|until) (i|it|my) .{0,20}(recover|heal|better)/i,
  /will (physio|physiotherapy|this|it) (cure|fix|heal)/i,
  /guarantee/i,
];

export function isUrgent(text: string): boolean {
  return URGENT_PATTERNS.some((p) => p.test(text));
}

export function asksForMedicalAdvice(text: string): boolean {
  return DIAGNOSIS_PATTERNS.some((p) => p.test(text));
}

export const URGENT_REPLY =
  `This may need urgent medical attention. Please don't wait for a home physiotherapy appointment — ` +
  `call ${EMERGENCY.general} (emergency) or ${EMERGENCY.ambulance} (ambulance), or go to the nearest hospital emergency department now. ` +
  `I'm an appointment assistant and can't assess symptoms. When you're safe, you're welcome to come back and submit a request, or call the clinic on ${BUSINESS.phoneDisplay}.`;

export const MEDICAL_ADVICE_REPLY =
  `I'm the clinic's appointment assistant, so I can't diagnose conditions, recommend exercises or medicines, or predict recovery. ` +
  `A qualified physiotherapist or doctor can assess you properly. I can submit a home physiotherapy appointment request so the clinic team can contact you, or share the clinic's number (${BUSINESS.phoneDisplay}). ` +
  `If symptoms are severe or getting worse quickly, please seek medical care straight away.`;
