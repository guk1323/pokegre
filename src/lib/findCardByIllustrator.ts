// 사진에서 카드 번호를 못 읽었을 때, 일러스트레이터 이름으로 카드를 찾아낸다.
//
// 카드 번호는 구석에 아주 작게 인쇄돼 있어서 사진이 조금만 잘려도 못 읽는다. 반면
// 일러스트레이터 이름("Illus. Mitsuhiro Arita")은 그림 바로 아래 줄에 있어 웬만하면 찍힌다.
//
// 우리는 작가별 카드 목록을 이미 갖고 있다(public/artists, 388명 16,857장).
// 실제로 재보니 "작가 + 카드이름"이면 86%가 한 장으로, 99%가 세 장 이하로 좁혀진다.
//
// 작가 파일은 필요할 때 한 명 것만 받는다(가장 많은 작가도 500장, 100KB 남짓).
//
// ⚠️ 이 목록은 영문판 기준이다. 일본판 카드에 쓰면 같은 그림의 영문판 번호가 나와서
// 스니커덩크에서 엉뚱한 카드를 찾게 된다(일본판 메가리자몽Y ex = MC 766/742,
// 영문판 = 294). 부르는 쪽에서 영문판일 때만 쓴다.

export interface ArtistCard {
  name: string;
  number: string;
  set: string;
  img?: string;
}

interface ArtistIndexEntry {
  slug: string;
  en: string;
  ko?: string;
}

let indexCache: ArtistIndexEntry[] | null = null;
const fileCache = new Map<string, ArtistCard[]>();

// 사람이 옮겨 적은 이름과 카드에 인쇄된 이름을 견주려면 표기 차이를 지워야 한다.
// "5ban Graphics" / "5BAN GRAPHICS" / "5ban graphics" 를 같게 본다.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function loadIndex(): Promise<ArtistIndexEntry[]> {
  if (indexCache) return indexCache;
  const res = await fetch('/artists/index.json');
  if (!res.ok) throw new Error('artist index failed');
  indexCache = (await res.json()) as ArtistIndexEntry[];
  return indexCache;
}

async function loadArtistCards(slug: string): Promise<ArtistCard[]> {
  const hit = fileCache.get(slug);
  if (hit) return hit;
  const res = await fetch(`/artists/${slug}.json`);
  if (!res.ok) throw new Error('artist file failed');
  const d = (await res.json()) as { cards?: ArtistCard[] };
  const cards = d.cards ?? [];
  fileCache.set(slug, cards);
  return cards;
}

// 카드 이름끼리 견준다. 스캔은 "Mega Charizard Y ex"처럼 읽는데 목록도 같은 표기라
// 대체로 그대로 맞는다. 다만 스캔이 "ex"를 빠뜨리거나 더 붙이는 일이 있어서,
// 완전히 같은 것을 먼저 찾고 없으면 한쪽이 다른 쪽을 품는 것까지 본다.
function pickByName(cards: ArtistCard[], nameEn: string): ArtistCard[] {
  const want = norm(nameEn);
  if (!want) return [];
  const exact = cards.filter((c) => norm(c.name) === want);
  if (exact.length) return exact;
  return cards.filter((c) => {
    const got = norm(c.name);
    return got.includes(want) || want.includes(got);
  });
}

export interface IllustratorMatch {
  number: string;
  set: string;
  name: string;
  // 후보가 여럿이면 첫 번째를 쓰되 몇 개였는지 알려준다(화면에서 안내할 수 있게).
  candidates: number;
}

// 못 찾으면 null. 찾으면 카드 번호와 세트 이름을 돌려준다.
export async function findCardByIllustrator(
  illustrator: string | null | undefined,
  nameEn: string | null | undefined,
): Promise<IllustratorMatch | null> {
  if (!illustrator || !nameEn) return null;
  try {
    const index = await loadIndex();
    const want = norm(illustrator);
    // 인쇄된 이름이 목록과 조금 다를 수 있어(Illus. 표기·대소문자) 정확히 같은 것을
    // 먼저 찾고, 없으면 한쪽이 다른 쪽을 품는 것까지 본다.
    const entry =
      index.find((a) => norm(a.en) === want) ??
      index.find((a) => norm(a.en).includes(want) || want.includes(norm(a.en)));
    if (!entry) return null;

    const cards = await loadArtistCards(entry.slug);
    const hits = pickByName(cards, nameEn);
    if (hits.length === 0) return null;
    return { number: hits[0].number, set: hits[0].set, name: hits[0].name, candidates: hits.length };
  } catch {
    // 부가 기능이라 실패해도 조용히 넘어간다. 원래대로 이름으로 검색한다.
    return null;
  }
}
