export interface CardScanResult {
  found: boolean;
  pokemonNameJa?: string;
  setCode?: string | null;
  cardNumber?: string | null;
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
