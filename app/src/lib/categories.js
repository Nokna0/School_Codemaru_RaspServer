// 구인구직 고정 카테고리 (docs/FEATURES.md 4). 백/프론트 공용 정의.
export const FIELD_GROUPS = {
  과학: ['물리', '화학', '생명과학', '지구과학'],
  '수학/정보': ['수학', '컴공', 'AI/데이터', '로봇'],
  '인문/사회': ['사회', '경제'],
  '진로/기타': ['의료보건', '교사/교육', '디자인', '영상', '음악', '미술', '체육'],
};
export const FIELDS = Object.values(FIELD_GROUPS).flat();
export const ACTIVITIES = ['대회/공모전', '스터디', '프로젝트', '봉사'];
