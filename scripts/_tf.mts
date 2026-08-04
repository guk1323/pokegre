import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
import { CARD_NAME_KO_TO_EN, STRUCTURAL_EN_TO_KO } from '../src/lib/koreanizeEnglishTitle.ts'
console.log('칠색조 단독 →', translateSearchQueryToEnglish('칠색조','english'))
console.log('칠색조 ex →', translateSearchQueryToEnglish('칠색조 ex','english'))
console.log('손사전 칠색조 →', CARD_NAME_KO_TO_EN.get('칠색조'))
for (const [en,ko] of STRUCTURAL_EN_TO_KO) if (ko.trim()==='칠색조') console.log('구조어표:', JSON.stringify(en), '→', JSON.stringify(ko))
console.log('N의 조로아 →', translateSearchQueryToEnglish('N의 조로아','english'))
console.log('호브의 잠만보 →', translateSearchQueryToEnglish('호브의 잠만보','english'))
console.log('구멍파는삽 →', translateSearchQueryToEnglish('구멍파는삽','english'))
console.log('제트 →', translateSearchQueryToEnglish('제트','english'))
console.log('로켓단의 잠만보 →', translateSearchQueryToEnglish('로켓단의 잠만보','english'))
