export interface CardScanResult {
  found: boolean;
  // 카드가 일본어·한국어로 인쇄돼 있어도 영어 이름으로 온다. 영어 이름+번호는 SNKRDUNK·
  // 이베이 양쪽에서 다 찾히는 "공용 열쇠"라, 이걸로 검색하면 어느 소스든 좁혀진다.
  pokemonNameEn?: string;
  cardNumber?: string | null;
  // 세트 코드(M4 등). 언어와 무관해서 SNKRDUNK 검색의 확실한 열쇠다(번호와 함께).
  setCode?: string | null;
  // 'japanese' = 일본어/한국어 카드(SNKRDUNK·이베이 일본판), 'english' = 북미판(이베이).
  edition?: 'japanese' | 'english';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // "data:image/jpeg;base64,xxxx" 형태에서 base64 데이터만 떼어낸다.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function scanCard(file: File): Promise<CardScanResult> {
  const image = await fileToBase64(file);
  const mediaType = file.type || 'image/jpeg';

  const res = await fetch('/api/local/scan-card', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image, mediaType }),
  });

  if (!res.ok) throw new Error('카드 인식에 실패했습니다.');
  return (await res.json()) as CardScanResult;
}

// 스캔이 틀렸을 때 사용자가 알려주는 신고. 사진은 안 보내고 "뭐라고 읽었는지"만 보낸다.
// 실패해도 조용히 무시한다(부가 기능이라 사용자를 막을 이유가 없다).
export function reportScanMiss(result: CardScanResult): void {
  fetch('/api/local/scan-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: result.pokemonNameEn,
      number: result.cardNumber,
      setCode: result.setCode,
      edition: result.edition,
    }),
  }).catch(() => undefined);
}
