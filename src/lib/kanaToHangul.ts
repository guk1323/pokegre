const HANGUL_BASE = 0xac00;
const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const MEDIALS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function compose(initial: string, medial: string, final: string): string {
  const i = INITIALS.indexOf(initial);
  const m = MEDIALS.indexOf(medial);
  const f = FINALS.indexOf(final);
  if (i < 0 || m < 0 || f < 0) return initial + medial + final;
  return String.fromCharCode(HANGUL_BASE + (i * 21 + m) * 28 + f);
}

function decompose(syllable: string): { initial: string; medial: string; final: string } | null {
  const code = syllable.charCodeAt(0) - HANGUL_BASE;
  if (code < 0 || code > 11171) return null;
  return {
    final: FINALS[code % 28],
    medial: MEDIALS[Math.floor(code / 28) % 21],
    initial: INITIALS[Math.floor(code / 28 / 21)],
  };
}

// 가타카나(+히라가나) 낱자를 한글 발음으로 매핑. 국립국어원 외래어 표기법의 어두/어중
// 구분(예: カ=가/카)까지는 반영하지 않고, 하나의 발음으로 통일한 간이 음역이다.
const KANA_MAP: Record<string, string> = {
  ア: '아', イ: '이', ウ: '우', エ: '에', オ: '오',
  カ: '카', キ: '키', ク: '쿠', ケ: '케', コ: '코',
  ガ: '가', ギ: '기', グ: '구', ゲ: '게', ゴ: '고',
  サ: '사', シ: '시', ス: '스', セ: '세', ソ: '소',
  ザ: '자', ジ: '지', ズ: '즈', ゼ: '제', ゾ: '조',
  タ: '타', チ: '치', ツ: '츠', テ: '테', ト: '토',
  ダ: '다', ヂ: '지', ヅ: '즈', デ: '데', ド: '도',
  ナ: '나', ニ: '니', ヌ: '누', ネ: '네', ノ: '노',
  ハ: '하', ヒ: '히', フ: '후', ヘ: '헤', ホ: '호',
  バ: '바', ビ: '비', ブ: '부', ベ: '베', ボ: '보',
  パ: '파', ピ: '피', プ: '푸', ペ: '페', ポ: '포',
  マ: '마', ミ: '미', ム: '무', メ: '메', モ: '모',
  ヤ: '야', ユ: '유', ヨ: '요',
  ラ: '라', リ: '리', ル: '루', レ: '레', ロ: '로',
  ワ: '와', ヲ: '오', ヴ: '부',
  キャ: '캬', キュ: '큐', キョ: '쿄',
  ギャ: '갸', ギュ: '규', ギョ: '교',
  シャ: '샤', シュ: '슈', ショ: '쇼',
  ジャ: '자', ジュ: '주', ジョ: '조',
  チャ: '차', チュ: '추', チョ: '초',
  ニャ: '냐', ニュ: '뉴', ニョ: '뇨',
  ヒャ: '햐', ヒュ: '휴', ヒョ: '효',
  ビャ: '뱌', ビュ: '뷰', ビョ: '뵤',
  ピャ: '퍄', ピュ: '퓨', ピョ: '표',
  ミャ: '먀', ミュ: '뮤', ミョ: '묘',
  リャ: '랴', リュ: '류', リョ: '료',
  ファ: '파', フィ: '피', フェ: '페', フォ: '포',
  ウィ: '위', ウェ: '웨', ウォ: '워',
  ティ: '티', トゥ: '투',
  ディ: '디', ドゥ: '두',
  ツァ: '차', ツィ: '치', ツェ: '체', ツォ: '초',
  チェ: '체', ジェ: '제', シェ: '셰',
};

function normalizeToKatakana(input: string): string {
  return input.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

// 가타카나(고유명사·팩 이름 등)를 한글 발음으로 옮긴다. 장음부호(ー)와 촉음(ッ)은
// 생략하는 간이 규칙이라 실제 정식 표기와는 다를 수 있다. 가타카나가 아닌 한자·
// 영문·기호는 건드리지 않고 그대로 둔다.
export function kanaToHangul(input: string): string {
  const kata = normalizeToKatakana(input);
  const output: string[] = [];
  let i = 0;

  while (i < kata.length) {
    const two = kata.slice(i, i + 2);
    if (KANA_MAP[two]) {
      output.push(KANA_MAP[two]);
      i += 2;
      continue;
    }

    const ch = kata[i];

    if (ch === 'ー' || ch === 'ッ') {
      i += 1;
      continue;
    }

    if (ch === 'ン') {
      const last = output[output.length - 1];
      const decomposed = last && last.length === 1 ? decompose(last) : null;
      if (decomposed && decomposed.final === '') {
        output[output.length - 1] = compose(decomposed.initial, decomposed.medial, 'ㄴ');
      } else {
        output.push('ㄴ');
      }
      i += 1;
      continue;
    }

    output.push(KANA_MAP[ch] ?? ch);
    i += 1;
  }

  return output.join('');
}
