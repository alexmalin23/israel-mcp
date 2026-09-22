import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanNameQuery,
  corporateKind,
  fixGershayim,
  normalizeChanges,
  normalizeCompany,
  normalizePartnership,
  parseIlDate,
  rankByName,
  validateCorporateNumber,
} from "../src/services/ica/normalize.js";

// Literal rows returned by data.gov.il on 2026-09-22 (trimmed of "קוד ..." fields where irrelevant).
const TEVA = {
  _id: 494599,
  "מספר חברה": 520013954,
  "שם חברה": "טבע תעשיות פרמצבטיות בע~מ",
  "שם באנגלית": "TEVA PHARMACEUTICAL INDUSTRIES LIMITED",
  "סוג תאגיד": "ישראלית חברה ציבורית",
  "סטטוס חברה": "פעילה",
  "תאור חברה": "",
  "מטרת החברה": "לעסוק בסוגי עיסוק שפורטו בתקנון",
  "תאריך התאגדות": "13/02/1944",
  "חברה ממשלתית": "לא",
  "מגבלות": "מוגבלת",
  "מפרה": "",
  "שנה אחרונה של דוח שנתי (שהוגש)": 2006,
  "שם עיר": "תל אביב - יפו",
  "שם רחוב": "דבורה הנביאה",
  "מספר בית": "124",
  "מיקוד": 6944020,
  "ת.ד.": "",
  "מדינה": "ישראל",
  "אצל": "טבע תעשיות פרמצבטיות בע~מ ת.ד. 58153 ת~א",
  "תת סטטוס": "",
  "קוד סטטוס חברה": 0,
  rank: 0.31,
};

const TEVA_HAETZ = {
  "מספר חברה": 513631770,
  "שם חברה": "טבע העץ בע~מ",
  "שם באנגלית": "",
  "סוג תאגיד": "ישראלית חברה פרטית",
  "סטטוס חברה": "מחוסלת מרצון",
  "תאריך התאגדות": "05/01/2005",
  "חברה ממשלתית": "לא",
  "מפרה": "",
  "שנה אחרונה של דוח שנתי (שהוגש)": null,
  "שם עיר": "כרמיאל",
  "מיקוד": 21651,
};

const VIOLATOR = { "מספר חברה": 510000359, "שם חברה": "חברה למכירת חומצת פחמן בעמ", "סטטוס חברה": "פעילה", "מפרה": "מפרה" };

const PARTNERSHIP = {
  "מספר שותפות": 530043694,
  "שם שותפות": "הנדסת קירור ליפשייץ לוינסקי",
  "שם באנגלית": "",
  "סוג תאגיד": "חו~ל שותפות חו~ל מהסבה",
  "סטטוס תאגיד": "מחוקה",
  "תאריך התאגדות": "27/01/1942",
  "ישוב": "",
  "ת.ד": "",
  "מיקוד": null,
};

test("validateCorporateNumber: real numbers pass, typos fail", () => {
  for (const n of ["520013954", "513631770", "510917040", "510000359", "530043694"]) {
    assert.equal(validateCorporateNumber(n).valid, true, n);
  }
  assert.deepEqual(validateCorporateNumber("520013955"), { normalized: "520013955", valid: false, reason: "check digit mismatch" });
});

test("validateCorporateNumber: normalizes separators, pads, rejects junk", () => {
  assert.deepEqual(validateCorporateNumber("52-001395-4"), { normalized: "520013954", valid: true });
  assert.deepEqual(validateCorporateNumber(" 520 013 954 "), { normalized: "520013954", valid: true });
  assert.equal(validateCorporateNumber(520013954).valid, true);
  assert.equal(validateCorporateNumber("18").normalized, "000000018");
  assert.equal(validateCorporateNumber("abc").valid, false);
  assert.equal(validateCorporateNumber("abc").normalized, "");
  assert.equal(validateCorporateNumber("1234567890").valid, false);
});

test("corporateKind routes by prefix", () => {
  assert.equal(corporateKind("510917040"), "company");
  assert.equal(corporateKind("520013954"), "company");
  assert.equal(corporateKind("530043694"), "partnership");
  assert.equal(corporateKind("550012345"), "partnership");
  assert.equal(corporateKind("580012345"), "other");
  assert.equal(corporateKind("500100904"), "other");
});

test("fixGershayim and parseIlDate", () => {
  assert.equal(fixGershayim("טבע בע~מ"), 'טבע בע"מ');
  assert.equal(parseIlDate("13/02/1944"), "1944-02-13");
  assert.equal(parseIlDate("5/1/2005"), "2005-01-05");
  assert.equal(parseIlDate(""), null);
  assert.equal(parseIlDate("2005-01-05"), null);
  assert.equal(parseIlDate("32/01/2005"), null);
  assert.equal(parseIlDate(null), null);
});

test("normalizeCompany: Teva", () => {
  assert.deepEqual(normalizeCompany(TEVA), {
    number: "520013954",
    kind: "company",
    nameHe: 'טבע תעשיות פרמצבטיות בע"מ',
    nameEn: "TEVA PHARMACEUTICAL INDUSTRIES LIMITED",
    type: "ישראלית חברה ציבורית",
    status: "פעילה",
    isActive: true,
    incorporatedOn: "1944-02-13",
    isGovernment: false,
    isViolator: false,
    limitation: "מוגבלת",
    lastAnnualReportYear: 2006,
    purpose: "לעסוק בסוגי עיסוק שפורטו בתקנון",
    address: {
      street: "דבורה הנביאה",
      houseNumber: "124",
      city: "תל אביב - יפו",
      zip: "6944020",
      country: "ישראל",
      careOf: 'טבע תעשיות פרמצבטיות בע"מ ת.ד. 58153 ת"א',
    },
  });
});

test("normalizeCompany: liquidated company is inactive and blanks are dropped", () => {
  const e = normalizeCompany(TEVA_HAETZ);
  assert.equal(e.isActive, false);
  assert.equal(e.status, "מחוסלת מרצון");
  assert.equal(e.nameEn, undefined);
  assert.equal(e.lastAnnualReportYear, undefined);
  assert.deepEqual(e.address, { city: "כרמיאל", zip: "21651" });
  assert.ok(!("nameEn" in e));
});

test("normalizeCompany: violator flag", () => {
  assert.equal(normalizeCompany(VIOLATOR).isViolator, true);
});

test("normalizePartnership uses partnership field names", () => {
  assert.deepEqual(normalizePartnership(PARTNERSHIP), {
    number: "530043694",
    kind: "partnership",
    nameHe: "הנדסת קירור ליפשייץ לוינסקי",
    type: 'חו"ל שותפות חו"ל מהסבה',
    status: "מחוקה",
    isActive: false,
    incorporatedOn: "1942-01-27",
  });
});

test("normalizeChanges: ISO dates, newest first", () => {
  const out = normalizeChanges([
    { "מספר תאגיד": 1, "סוג בקשה": "סילוק שעבוד", "תאריך עדכון סטטוס": "08/03/2026", "מזהה השיעבוד": 2358 },
    { "מספר תאגיד": 1, "סוג בקשה": "רישום שעבוד", "תאריך עדכון סטטוס": "06/07/2026", "מזהה השיעבוד": 33 },
  ]);
  assert.deepEqual(out, [
    { date: "2026-07-06", type: "רישום שעבוד", lienId: 33 },
    { date: "2026-03-08", type: "סילוק שעבוד", lienId: 2358 },
  ]);
});

test("cleanNameQuery strips legal suffixes and quotes", () => {
  assert.equal(cleanNameQuery('טבע תעשיות פרמצבטיות בע"מ'), "טבע תעשיות פרמצבטיות");
  assert.equal(cleanNameQuery("טבע בע~מ"), "טבע");
  assert.equal(cleanNameQuery("חומצת פחמן בעמ"), "חומצת פחמן");
  assert.equal(cleanNameQuery("Teva Pharmaceutical Industries Ltd."), "Teva Pharmaceutical Industries");
  assert.equal(cleanNameQuery("ACME LIMITED"), "ACME");
  assert.equal(cleanNameQuery("Foo Inc"), "Foo");
  assert.equal(cleanNameQuery("  בעמק  הירדן "), "בעמק הירדן");
});

test("rankByName: exact > prefix > contains; generic-token matches last; drops care-of-only matches; stable on ties", () => {
  const rows = [
    { nameHe: "אסיא תעשיות כימיות בע\"מ" }, // only a generic later token matches → last
    { nameHe: "חברה אחרת בע\"מ" }, // matched only through אצל → dropped
    { nameHe: "טבע מדיקל בע\"מ", nameEn: "TEVA MEDICAL LTD." },
    { nameHe: "טבע תעשיות פרמצבטיות בע\"מ" },
    { nameHe: "אחזקות טבע תעשיות פרמצבטיות" },
    { nameHe: "טבע תעשיות פרמצבטיות (ישראל) בע\"מ" },
  ];
  const out = rankByName(rows, "טבע תעשיות פרמצבטיות").map((r) => r.nameHe);
  assert.deepEqual(out, [
    'טבע תעשיות פרמצבטיות בע"מ',
    'טבע תעשיות פרמצבטיות (ישראל) בע"מ',
    "אחזקות טבע תעשיות פרמצבטיות",
    'טבע מדיקל בע"מ',
    'אסיא תעשיות כימיות בע"מ',
  ]);
});

test("rankByName matches English names too", () => {
  const out = rankByName([{ nameHe: "משהו", nameEn: "TEVA MEDICAL LTD." }, { nameHe: "אחר" }], "teva medical");
  assert.equal(out.length, 1);
  assert.equal(out[0].nameEn, "TEVA MEDICAL LTD.");
});
