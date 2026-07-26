// 플리마켓(회원끼리 카드 거래) 운영 설정. 지금은 운영자 화면에서만 쓴다 —
// 서버가 운영자가 아니면 404를 주므로, 여기서 감추는 건 메뉴를 깔끔히 두는 편의일 뿐이다.

export interface FleaConfig {
  // 0 준비중(닫힘) · 1 매물+쪽지 · 2 거래기록까지 · 3 시세 공개
  stage: 0 | 1 | 2 | 3;
  // 단계와 별개인 즉시 차단 스위치. 끄면 단계가 몇이든 닫힌다.
  open: boolean;
  // 같은 카드·같은 등급으로 이만큼 모여야 시세로 보여준다.
  minSamples: number;
  // 외부 시세(스니커덩크·이베이) 대비 이 배수 밖이면 시세 집계에서 뺀다.
  outlierLow: number;
  outlierHigh: number;
  // 전자상거래법 제20조 제1항 고지("저희는 거래 당사자가 아닙니다")를 화면에 붙였는지.
  // 이걸 안 켜면 서버가 3단계로 못 가게 막는다.
  noticeShown: boolean;
  updatedAt: number;
}

export interface FleaStatus {
  config: FleaConfig;
  counts: { listings: number; deals: number };
}

export const STAGE_LABEL: Record<FleaConfig['stage'], string> = {
  0: '준비 중',
  1: '매물·쪽지',
  2: '거래 기록',
  3: '시세 공개',
};

export const STAGE_NOTE: Record<FleaConfig['stage'], string> = {
  0: '아직 아무에게도 안 보입니다. 만드는 동안 여기에 둡니다.',
  1: '매물을 올리고 쪽지를 주고받을 수 있습니다. 거래가는 아직 안 모읍니다.',
  2: '제안·수락·완료로 거래가를 모읍니다. 아직 시세로는 안 씁니다.',
  3: '모인 거래가를 시세로 보여줍니다.',
};

export async function fetchFleaStatus(): Promise<FleaStatus> {
  const res = await fetch('/api/local/flea/config');
  if (!res.ok) throw new Error('불러오지 못했습니다.');
  return res.json();
}

export async function saveFleaConfig(config: FleaConfig): Promise<FleaConfig> {
  const res = await fetch('/api/local/flea/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    // 서버가 이유를 보내면(예: 고지문 없이 3단계) 그대로 보여준다.
    const reason = await res.json().catch(() => null);
    throw new Error(reason?.error ?? '저장하지 못했습니다.');
  }
  return res.json();
}
