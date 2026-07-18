#!/usr/bin/env node
// 그날(로컬 자정~) 커밋을 읽어, 사용자에게 보여줄 만한 변경만 골라 친절한 한국어 공지
// 초안을 만든다. 승인 후 게시(운영자가 커뮤니티에 공지로 고정)하는 용도의 "초안 생성기".
//
// 실행: node --env-file=.env scripts/notice-draft.mjs [YYYY-MM-DD]
//  - 인자로 날짜를 주면 그날, 없으면 오늘. 초안은 notice-drafts/<날짜>.md 에 저장.
//  - 사용자 체감 변화가 없으면 아무 것도 만들지 않고 종료(변경 있는 날만).
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error('ANTHROPIC_API_KEY 없음 — `node --env-file=.env scripts/notice-draft.mjs` 로 실행하세요.');
  process.exit(1);
}

// 대상 날짜(로컬). 인자가 있으면 그날, 없으면 오늘.
const arg = process.argv[2];
const day = arg ? new Date(arg + 'T00:00:00') : new Date();
const start = new Date(day);
start.setHours(0, 0, 0, 0);
const end = new Date(start);
end.setDate(end.getDate() + 1);
const ymd = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

// 그날 커밋 수집(병합 커밋 제외). 레코드 구분자로 제어문자 사용.
const fmt = '%h%x09%s%x09%b%x1e';
const raw = execSync(
  `git log --since="${start.toISOString()}" --until="${end.toISOString()}" --no-merges --pretty=format:"${fmt}"`,
  { encoding: 'utf8' },
).trim();

if (!raw) {
  console.log(`${ymd}: 커밋 없음 — 공지 초안 생략.`);
  process.exit(0);
}

const commits = raw
  .split('\x1e')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((line) => {
    const [h, subj, body = ''] = line.split('\t');
    return { h, subj, body };
  });

const commitList = commits.map((c) => `- ${c.subj}${c.body ? '\n  ' + c.body.replace(/\s+/g, ' ').trim() : ''}`).join('\n');

const md = `${start.getMonth() + 1}월 ${start.getDate()}일`;
const prompt = `당신은 포켓몬 카드 시세 사이트 "pokegre"의 패치노트 작성자입니다. 아래는 ${md} 개발 커밋 목록입니다. 이걸 바탕으로 일반 사용자가 읽을 커뮤니티 공지 초안을 작성하세요.

규칙:
- 사용자가 실제로 체감하는 변화(새 기능·개선·버그 수정)만 쉬운 한국어로. 대상은 비개발자입니다.
- 내부 리팩터링, 보안 수정, 개발용/운영자 전용 변경, 배포·인프라 설정은 절대 언급하지 마세요. (보안 수정을 공개하면 취약점을 광고하는 셈입니다.)
- 과장하거나 미래를 약속하지 마세요. "무료 / 영구 / 광고 없음 / 비영리" 같은 미래를 못 박는 표현은 쓰지 마세요.
- 형식: 첫 줄에 제목 한 줄(예: "📢 ${md} 업데이트"), 그 아래 불릿 3~6개. 각 불릿은 한 문장, 담백하게.
- 사용자가 체감할 변화가 하나도 없으면(전부 내부·보안·개발용이면) 다른 말 없이 정확히 "NONE" 한 단어만 출력하세요.

${md} 커밋:
${commitList}`;

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model: 'claude-opus-4-8',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  }),
});

if (!res.ok) {
  console.error('Anthropic API 실패:', res.status, (await res.text()).slice(0, 400));
  process.exit(1);
}

const data = await res.json();
const text = (data.content?.find((c) => c.type === 'text')?.text ?? '').trim();

if (!text || text === 'NONE') {
  console.log(`${ymd}: 사용자 체감 변화 없음 — 공지 초안 생략.`);
  process.exit(0);
}

const dir = path.join(process.cwd(), 'notice-drafts');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${ymd}.md`);
writeFileSync(file, text + '\n', 'utf8');

console.log(`\n===== 공지 초안 (${ymd}) =====\n`);
console.log(text);
console.log(`\n(초안 저장: ${path.relative(process.cwd(), file)})`);
console.log('검토 후 커뮤니티에 공지로 올리면 됩니다.');
