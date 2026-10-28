import { test } from "node:test";
import assert from "node:assert/strict";
import { isResumeLabel, isCoverLabel } from "../../src/lib/apply/resume-label.mjs";

const RESUME = [
  "Resume", "Résumé / CV", "RÉSUMÉ", "Upload your CV", "Lebenslauf", "Currículum vitae",
  "Currículo", "Curriculum", "Резюме", "Życiorys (CV)", "Özgeçmiş", "履歴書", "職務経歴書",
  "上传简历", "上傳履歷", "이력서 첨부", "السيرة الذاتية", "रिज्यूमे अपलोड करें", "Riwayat hidup",
];
const NOT_RESUME = ["Cover letter", "Portfolio", "Anschreiben", "Lettre de motivation", "Carta de presentación", "Certificates", "Zeugnisse", "CVV"];

for (const label of RESUME) {
  test(`"${label}" is a résumé upload`, () => assert.equal(isResumeLabel(label), true));
}
for (const label of NOT_RESUME) {
  test(`"${label}" is left for the person (not a resume)`, () => assert.equal(isResumeLabel(label), false));
}

const COVER = [
  "Cover letter", "Cover Letter", "COVER LETTER", "CoverLetter", "Motivation letter", "Letter of motivation",
  "Anschreiben", "Lettre de motivation", "Carta de presentación", "Carta de presentacion", "Carta di presentazione",
  "Carta de motivação", "Motivatiebrief", "List motywacyjny", "Сопроводительное письмо", "Cover note",
];
const NOT_COVER = ["Resume", "CV", "Portfolio", "Certificates", "Zeugnisse", "CVV", "Transcript"];

for (const label of COVER) {
  test(`"${label}" is a cover letter upload`, () => assert.equal(isCoverLabel(label), true));
}
for (const label of NOT_COVER) {
  test(`"${label}" is not a cover letter upload`, () => assert.equal(isCoverLabel(label), false));
}
