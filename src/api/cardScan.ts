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

function fileToBase64(file: Blob): Promise<string> {
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

// 보내기 전에 항상 JPEG로 다시 인코딩하고 긴 변을 maxDim으로 줄인다. 이유가 둘이다:
// (1) 아이폰 사진은 HEIC라 Claude 비전이 못 읽는데, canvas로 다시 그리면 JPEG로 바뀐다.
// (2) 고해상도 원본은 base64가 5MB를 넘어 API가 거부하는데, 축소하면 넉넉히 들어온다.
// 카드 텍스트를 읽는 용도라 1600px면 충분하다. 실패하면 원본으로 대체한다.
async function toScanImage(file: File, maxDim = 1600, quality = 0.85): Promise<{ image: string; mediaType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image decode failed'));
      im.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas ctx');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error('encode failed');
    return { image: await fileToBase64(blob), mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function scanCard(file: File): Promise<CardScanResult> {
  let payload: { image: string; mediaType: string };
  try {
    payload = await toScanImage(file);
  } catch {
    // 변환 실패 시 원본 그대로(그래도 안 되면 서버가 실패를 돌려준다).
    payload = { image: await fileToBase64(file), mediaType: file.type || 'image/jpeg' };
  }

  const res = await fetch('/api/local/scan-card', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.status === 429) {
    // 사람마다 걸리는 제한(시간당)과 사이트 전체 하루 제한을 구분해서 알려 준다 —
    // "잠시 후"라고만 하면 하루치가 끝난 날에도 계속 다시 눌러 보게 된다.
    const daily = await res
      .clone()
      .json()
      .then((d: { error?: string }) => d.error === 'daily_limit')
      .catch(() => false);
    throw new Error(
      daily
        ? '오늘 카드 인식을 쓸 수 있는 횟수를 다 썼습니다. 내일 다시 시도해 주세요.'
        : '카드 인식을 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
  if (res.status === 415) throw new Error('이 사진 형식은 읽을 수 없습니다. JPG나 PNG로 올려 주세요.');
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
