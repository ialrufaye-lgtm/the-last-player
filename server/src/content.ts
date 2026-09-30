/**
 * Content loading for THE LAST PLAYER.
 * Loads content/*.json at boot; if a file is missing or invalid, falls back
 * to small built-in banks so the server still boots and runs full matches.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface QuizQuestion { q: string; choices: string[]; answer: number; }
export interface Riddle { q: string; a: string; }
export interface Sequence { q: string; a: string; }
export interface RoundStrings { title: string; rules: string; }
export interface Strings {
  rounds: Record<string, RoundStrings>;
  reasons: Record<string, string>;
  misc: Record<string, string>;
}
export interface ContentBank {
  quiz: QuizQuestion[];
  riddles: Riddle[];
  sequences: Sequence[];
  strings: Strings;
}

function contentDir(): string {
  // dist/src -> server/ -> last-player/content ; also honour CONTENT_DIR.
  if (process.env.CONTENT_DIR) return process.env.CONTENT_DIR;
  return path.resolve(__dirname, '../../content');
}

function readJson<T>(file: string): T | null {
  try {
    const raw = fs.readFileSync(path.join(contentDir(), file), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Built-in fallback banks (used only when content/*.json is absent/invalid).
// ---------------------------------------------------------------------------

const FALLBACK_QUIZ: QuizQuestion[] = [
  { q: 'ما هي عاصمة المملكة العربية السعودية؟', choices: ['الرياض', 'جدة', 'الدمام', 'مكة المكرمة'], answer: 0 },
  { q: 'كم عدد أركان الإسلام؟', choices: ['أربعة', 'خمسة', 'ستة', 'سبعة'], answer: 1 },
  { q: 'كم عدد أيام السنة الميلادية (غير الكبيسة)؟', choices: ['364', '365', '366', '360'], answer: 1 },
  { q: 'ما الغاز الذي يحتاجه الإنسان للتنفس والبقاء؟', choices: ['النيتروجين', 'ثاني أكسيد الكربون', 'الأكسجين', 'الهيدروجين'], answer: 2 },
  { q: 'كم عدد لاعبي فريق كرة القدم داخل الملعب؟', choices: ['9', '10', '11', '12'], answer: 2 },
  { q: 'ما هي أكبر قارات العالم مساحة؟', choices: ['أفريقيا', 'أوروبا', 'أمريكا الشمالية', 'آسيا'], answer: 3 },
  { q: 'ما ناتج 7 × 8؟', choices: ['54', '56', '63', '48'], answer: 1 },
  { q: 'ما هو أول شهور السنة الهجرية؟', choices: ['محرم', 'صفر', 'رمضان', 'ذو الحجة'], answer: 0 },
  { q: 'كم عدد سور القرآن الكريم؟', choices: ['110', '112', '114', '116'], answer: 2 },
  { q: 'ما هي عملة اليابان؟', choices: ['الوون', 'اليوان', 'الين', 'الدولار'], answer: 2 },
];

const FALLBACK_RIDDLES: Riddle[] = [
  { q: 'ما الشيء الذي يصعد دائمًا ولا ينزل أبدًا؟', a: 'العمر' },
  { q: 'له أسنان ولا يعض، فما هو؟', a: 'المشط' },
  { q: 'ما الشيء الذي كلما أخذت منه كَبُر؟', a: 'الحفرة' },
  { q: 'أنا ابن الماء، فإن تركوني في الماء متُّ، فمن أنا؟', a: 'الثلج' },
  { q: 'ما الذي يمشي بلا أرجل ويدخل الأذن؟', a: 'الصوت' },
  { q: 'شيء في السماء، إذا أضفت إليه حرفًا أصبح في الأرض، فما هو؟', a: 'منجم' },
  { q: 'ما الشيء الموجود أمامك دائمًا ولا تراه؟', a: 'الأنف' },
  { q: 'كلي ثقوب ومع ذلك أحفظ الماء، فمن أنا؟', a: 'الإسفنج' },
];

const FALLBACK_SEQUENCES: Sequence[] = [
  { q: 'أكمل التسلسل: 2، 4، 8، 16، ؟', a: '32' },
  { q: 'أكمل التسلسل: 1، 1، 2، 3، 5، 8، ؟', a: '13' },
  { q: 'أكمل التسلسل: 5، 10، 20، 40، ؟', a: '80' },
  { q: 'أكمل التسلسل: 100، 90، 80، ؟', a: '70' },
  { q: 'أكمل التسلسل: 3، 6، 11، 18، ؟', a: '27' },
  { q: 'أكمل التسلسل: 1، 4، 9، 16، ؟', a: '25' },
];

const FALLBACK_STRINGS: Strings = {
  rounds: {
    quiz_race: {
      title: '🏁 سباق الأسئلة',
      rules: '٨ أسئلة، ١٢ ثانية لكل سؤال. الإجابة الصحيحة الأسرع = نقاط أكثر. أصحاب أدنى ٤٠٪ يُقصون!',
    },
    hide_seek: {
      title: '🙈 لعبة الاختباء',
      rules: 'اختبئ في مربع من شبكة ٨×٨ خلال ٢٠ ثانية. ٥ باحثين يختارون ٣ مربعات لكل منهم، والظل يكمّل الصيد حتى ~٤٠٪. من يُمسَك يُقصى!',
    },
    react_race: {
      title: '⚡ سباق رد الفعل',
      rules: '٥ محاولات: انتظر الضوء الأخضر ثم المس الشاشة فورًا! اللمس المبكر يُلغي المحاولة. أبطأ ٥٠٪ يُقصون!',
    },
    survival: {
      title: '🔥 البقاء',
      rules: 'خريطة ٥×٥. كل ٦ ثوانٍ تصبح ٤ مناطق خطرة. تحرّك لمنطقة مجاورة كل جولة — البقاء في مكانك أو في منطقة خطرة = إقصاء!',
    },
    final_duel: {
      title: '🏆 النزال الأخير',
      rules: 'الأفضل من ٥: ألغاز سريعة، ١٥ ثانية لكل لغز. الأسرع إجابة صحيحة يكسب النقطة، وأول من يصل لـ ٣ نقاط يفوز بالنزال!',
    },
  },
  reasons: {
    quiz: 'أُقصيت في سباق الأسئلة — كنت ضمن أصحاب أدنى النقاط.',
    hide_caught: 'أُمسكت في لعبة الاختباء — وجدك أحد الباحثين!',
    hide_shadow: 'أُمسكت في لعبة الاختباء — لحق بك الظل!',
    react: 'أُقصيت في سباق رد الفعل — كنت ضمن الأبطأ.',
    survival_stay: 'أُقصيت في البقاء — لم تتحرك من منطقتك!',
    survival_danger: 'أُقصيت في البقاء — كنت في منطقة خطرة!',
    survival_cut: 'أُقصيت في البقاء — نقاطك من الأدنى.',
    duel: 'خسرت النزال الأخير. حظ أوفر في المرة القادمة!',
    disconnect: 'انقطع اتصالك أثناء المباراة.',
  },
  misc: {
    countdown: 'تبدأ المباراة خلال ٥ ثوانٍ… استعد!',
    hostOnly: 'فقط مضيف الغرفة يمكنه بدء المباراة.',
    needPlayers: 'نحتاج لاعبين أكثر لبدء المباراة.',
    wrongCode: 'رمز الغرفة غير صحيح — تم إنشاء غرفة انتظار جديدة.',
    roomFull: 'الغرفة ممتلئة (١٠٠ لاعب).',
    matchRunning: 'المباراة بدأت — لا يمكن الانضمام الآن.',
  },
};

// ---------------------------------------------------------------------------

function validQuiz(list: any): QuizQuestion[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (q) =>
      q && typeof q.q === 'string' && Array.isArray(q.choices) && q.choices.length >= 2 &&
      Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length,
  );
}

function validPairs(list: any): Riddle[] {
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && typeof r.q === 'string' && typeof r.a === 'string' && r.a.length > 0);
}

function validStrings(s: any): Strings | null {
  if (!s || typeof s !== 'object' || !s.rounds || !s.reasons) return null;
  return s as Strings;
}

export function loadContent(): ContentBank {
  const dir = contentDir();
  const hasDir = fs.existsSync(dir);
  if (!hasDir) {
    console.log(`[content] ${dir} not found — using built-in fallback banks.`);
  }

  const quizRaw = readJson<any>('quiz.json');
  const quizList = Array.isArray(quizRaw) ? quizRaw : quizRaw?.questions;
  const quiz = validQuiz(quizList);
  const riddles = validPairs(readJson<any>('riddles.json'));
  const seqRaw = readJson<any>('sequences.json');
  const seqList = Array.isArray(seqRaw) ? seqRaw : seqRaw?.sequences;
  const sequences = validPairs(seqList);
  const strings = validStrings(readJson<any>('strings.json')) ?? FALLBACK_STRINGS;

  const bank: ContentBank = {
    quiz: quiz.length >= 4 ? quiz : FALLBACK_QUIZ,
    riddles: riddles.length >= 2 ? riddles : FALLBACK_RIDDLES,
    sequences: sequences.length >= 2 ? sequences : FALLBACK_SEQUENCES,
    strings,
  };
  console.log(
    `[content] loaded quiz=${bank.quiz.length} riddles=${bank.riddles.length} ` +
    `sequences=${bank.sequences.length} (fallbacks used where files were missing/invalid)`,
  );
  return bank;
}
