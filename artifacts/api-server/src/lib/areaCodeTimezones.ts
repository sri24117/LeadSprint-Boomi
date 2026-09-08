/**
 * US NANP area code -> IANA timezone, for deriving the *called party's*
 * timezone at intake. This is a hint, not proof — a mobile number can
 * roam anywhere, which is exactly why an unrecognized or ambiguous area
 * code returns `null` rather than a guess: the policy gate blocks on
 * `null`, it never falls back to the business's timezone. See
 * lib/policy.ts and the "Correct timezone regression cases" table this
 * was built against.
 *
 * Coverage: major markets across all six US timezone regions. This is not
 * exhaustive of all ~350 NANP area codes — extend as real customer
 * geography requires it. Every area code maps to exactly one timezone
 * (a simplification for states split across zones, e.g. TX/FL/etc.,
 * where the code below picks the timezone covering the code's dominant
 * population center).
 */
const AREA_CODE_TIMEZONES: Record<string, string> = {
  // Eastern
  "212": "America/New_York", "646": "America/New_York", "917": "America/New_York",
  "718": "America/New_York", "347": "America/New_York", "929": "America/New_York",
  "516": "America/New_York", "631": "America/New_York", "914": "America/New_York",
  "845": "America/New_York", "518": "America/New_York", "607": "America/New_York",
  "315": "America/New_York", "716": "America/New_York", "585": "America/New_York",
  "201": "America/New_York", "551": "America/New_York", "609": "America/New_York",
  "732": "America/New_York", "856": "America/New_York", "908": "America/New_York",
  "973": "America/New_York",
  "215": "America/New_York", "267": "America/New_York", "412": "America/New_York",
  "484": "America/New_York", "570": "America/New_York", "610": "America/New_York",
  "717": "America/New_York", "724": "America/New_York", "814": "America/New_York",
  "202": "America/New_York", "301": "America/New_York", "240": "America/New_York",
  "410": "America/New_York", "443": "America/New_York", "703": "America/New_York",
  "571": "America/New_York", "804": "America/New_York", "757": "America/New_York",
  "617": "America/New_York", "781": "America/New_York", "857": "America/New_York",
  "978": "America/New_York", "339": "America/New_York", "413": "America/New_York",
  "203": "America/New_York", "860": "America/New_York", "475": "America/New_York",
  "401": "America/New_York", "802": "America/New_York", "603": "America/New_York",
  "207": "America/New_York",
  "305": "America/New_York", "786": "America/New_York", "954": "America/New_York",
  "561": "America/New_York", "407": "America/New_York", "321": "America/New_York",
  "904": "America/New_York", "352": "America/New_York",
  "404": "America/New_York", "678": "America/New_York", "770": "America/New_York",
  "470": "America/New_York", "912": "America/New_York",
  "614": "America/New_York", "513": "America/New_York", "216": "America/New_York",
  "440": "America/New_York", "330": "America/New_York",
  "313": "America/New_York", "248": "America/New_York", "586": "America/New_York",
  "734": "America/New_York", "810": "America/New_York",

  // Central
  "312": "America/Chicago", "773": "America/Chicago", "872": "America/Chicago",
  "708": "America/Chicago", "847": "America/Chicago", "630": "America/Chicago",
  "224": "America/Chicago", "331": "America/Chicago",
  "214": "America/Chicago", "469": "America/Chicago", "972": "America/Chicago",
  "817": "America/Chicago", "682": "America/Chicago", "713": "America/Chicago",
  "281": "America/Chicago", "832": "America/Chicago", "210": "America/Chicago",
  "512": "America/Chicago", "737": "America/Chicago", "361": "America/Chicago",
  "615": "America/Chicago", "629": "America/Chicago", "901": "America/Chicago",
  "731": "America/Chicago",
  "504": "America/Chicago", "225": "America/Chicago", "318": "America/Chicago",
  "601": "America/Chicago", "662": "America/Chicago",
  "402": "America/Chicago", "308": "America/Chicago",
  "316": "America/Chicago", "913": "America/Chicago", "785": "America/Chicago",
  "918": "America/Chicago", "405": "America/Chicago", "580": "America/Chicago",
  "314": "America/Chicago", "816": "America/Chicago", "636": "America/Chicago",
  "417": "America/Chicago",
  "612": "America/Chicago", "651": "America/Chicago", "763": "America/Chicago",
  "952": "America/Chicago",
  "414": "America/Chicago", "608": "America/Chicago", "262": "America/Chicago",
  "319": "America/Chicago", "515": "America/Chicago", "563": "America/Chicago",
  "479": "America/Chicago", "501": "America/Chicago", "870": "America/Chicago",

  // Mountain
  "303": "America/Denver", "720": "America/Denver", "970": "America/Denver",
  "719": "America/Denver",
  "505": "America/Denver", "575": "America/Denver",
  "801": "America/Denver", "385": "America/Denver", "435": "America/Denver",
  "406": "America/Denver", "307": "America/Denver",
  "602": "America/Phoenix", "480": "America/Phoenix", "623": "America/Phoenix",
  "520": "America/Phoenix", "928": "America/Phoenix", // Arizona: no DST, effectively its own zone

  // Pacific
  "213": "America/Los_Angeles", "310": "America/Los_Angeles", "323": "America/Los_Angeles",
  "424": "America/Los_Angeles", "818": "America/Los_Angeles", "747": "America/Los_Angeles",
  "626": "America/Los_Angeles", "657": "America/Los_Angeles", "714": "America/Los_Angeles",
  "949": "America/Los_Angeles", "858": "America/Los_Angeles", "619": "America/Los_Angeles",
  "760": "America/Los_Angeles", "442": "America/Los_Angeles",
  "415": "America/Los_Angeles", "628": "America/Los_Angeles", "510": "America/Los_Angeles",
  "925": "America/Los_Angeles", "650": "America/Los_Angeles", "408": "America/Los_Angeles",
  "669": "America/Los_Angeles", "916": "America/Los_Angeles", "279": "America/Los_Angeles",
  "209": "America/Los_Angeles", "559": "America/Los_Angeles", "661": "America/Los_Angeles",
  "805": "America/Los_Angeles", "831": "America/Los_Angeles", "707": "America/Los_Angeles",
  "206": "America/Los_Angeles", "253": "America/Los_Angeles", "425": "America/Los_Angeles",
  "360": "America/Los_Angeles", "564": "America/Los_Angeles", "509": "America/Los_Angeles",
  "503": "America/Los_Angeles", "971": "America/Los_Angeles", "541": "America/Los_Angeles",
  "702": "America/Los_Angeles", "725": "America/Los_Angeles", "775": "America/Los_Angeles",

  // Alaska / Hawaii
  "907": "America/Anchorage",
  "808": "Pacific/Honolulu",
};

/**
 * Extracts the NANP area code from an E.164-ish US number and returns its
 * IANA timezone, or `null` if the number isn't recognizably a US number or
 * the area code isn't in the table. Callers must treat `null` as "unknown"
 * — never substitute another timezone for it.
 */
export function timezoneForUSPhoneNumber(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  // Accept "+1XXXXXXXXXX", "1XXXXXXXXXX", or bare "XXXXXXXXXX".
  const tenDigit =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (!tenDigit) return null;
  const areaCode = tenDigit.slice(0, 3);
  return AREA_CODE_TIMEZONES[areaCode] ?? null;
}
