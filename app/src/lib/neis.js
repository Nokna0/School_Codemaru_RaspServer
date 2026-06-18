// NEIS 교육정보 개방 포털 연동 (급식/시간표). https://open.neis.go.kr
// Node 20 내장 fetch 사용. 결과는 DB(meals/timetables)에 캐시하는 것을 권장.
const BASE = 'https://open.neis.go.kr/hub';
const KEY = process.env.NEIS_API_KEY;
const OFCDC = process.env.NEIS_ATPT_OFCDC_SC_CODE || 'M10'; // 충북교육청
const SCHUL = process.env.NEIS_SD_SCHUL_CODE;               // 청주고 표준학교코드

function q(params) {
  const base = { Type: 'json', pIndex: '1', pSize: '100', ...params };
  if (KEY) base.KEY = KEY; // 키 있으면 포함(높은 호출 한도). 없으면 키 없이 샘플 조회(한도 낮음).
  return new URLSearchParams(base).toString();
}

// 학교코드만 있으면 조회 가능(NEIS는 키 없이도 샘플 조회 허용, 결과는 DB 캐시).
// 키는 선택(높은 한도용). 학교코드도 없으면 화면은 "준비 중"으로 동작.
export function neisConfigured() {
  return Boolean(SCHUL);
}

// 급식: date = 'YYYYMMDD'. 반환: [{ type, menu, calorie, origin }]
export async function fetchMeals(yyyymmdd) {
  const url = `${BASE}/mealServiceDietInfo?${q({
    ATPT_OFCDC_SC_CODE: OFCDC, SD_SCHUL_CODE: SCHUL, MLSV_YMD: yyyymmdd,
  })}`;
  const res = await fetch(url);
  const json = await res.json();
  const rows = json?.mealServiceDietInfo?.[1]?.row || [];
  const typeMap = { '조식': 'breakfast', '중식': 'lunch', '석식': 'dinner' };
  return rows.map((r) => ({
    type: typeMap[r.MMEAL_SC_NM] || r.MMEAL_SC_NM,
    menu: (r.DDISH_NM || '').replace(/<br\/?>/g, '\n'),
    calorie: r.CAL_INFO,
    origin: r.ORPLC_INFO,
  }));
}

// 시간표(고등학교 hisTimetable): grade/class + 기간. 반환: [{ date, period, subject }]
export async function fetchTimetable(grade, classNo, fromYmd, toYmd) {
  const url = `${BASE}/hisTimetable?${q({
    ATPT_OFCDC_SC_CODE: OFCDC, SD_SCHUL_CODE: SCHUL,
    GRADE: String(grade), CLASS_NM: String(classNo),
    TI_FROM_YMD: fromYmd, TI_TO_YMD: toYmd,
  })}`;
  const res = await fetch(url);
  const json = await res.json();
  const rows = json?.hisTimetable?.[1]?.row || [];
  return rows.map((r) => ({
    date: r.ALL_TI_YMD,           // YYYYMMDD
    period: Number(r.PERIO),
    subject: r.ITRT_CNTNT,
  }));
}

// 참고: AY(학년도)/SEM(학기) 파라미터가 필요한 경우가 있어 빈 결과면 추가하세요.
