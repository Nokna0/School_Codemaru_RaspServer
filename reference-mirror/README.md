# squarecj.com 미러 (전체)

청주고 커뮤니티 Square(https://squarecj.com)의 공개 페이지와 정적 에셋 전체 사본입니다.
사용자님 브라우저(Claude in Chrome)를 통해 받았으며, 원래 경로 구조를 그대로 보존했습니다.

수집 시점: 2026-06-17 · 총 50개 파일(약 2.1MB) · 누락 0

## 구성

- 페이지 HTML 10개
  - `index.html` (홈), `login.html`, `signup.html`
  - `community/free.html` 및 하위: `all` / `best` / `jobs` / `jobs/new` / `meal` / `new`
- `_next/static/chunks/` — JS 청크 21개, CSS 2개 (배포된 빌드 번들)
- `_next/static/media/` — 웹폰트(woff2) 10개
- 루트 아이콘/이미지 — `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`,
  `icon-192.png`, `icon-512.png`, `cheongju-emblem-480.webp`
- `manifest.webmanifest` (PWA), `manifest.json` (이 사본의 파일 목록)

외부 리소스(Google AdSense)는 서드파티라 포함하지 않았습니다.

## 로컬에서 열기

HTML이 에셋을 절대경로(`/_next/...`)로 참조하므로, `index.html`을 파일로 바로 열면
스타일이 안 보입니다. 이 폴더에서 간단한 로컬 서버를 띄우세요.

```
cd ~/Desktop/squarecj
python3 -m http.server 8080
```

그 후 브라우저에서 `http://localhost:8080` 접속. (로그인 등 서버 기능은 동작하지 않는
정적 사본입니다.)

## 참고

JS/CSS는 브라우저에 배포된 빌드 결과물(압축/난독화)입니다. 원본 소스(React/TS)는
브라우저로 제공되지 않아 사본에 포함되지 않습니다. 본인 프로젝트라면 원본은
GitHub 저장소나 Vercel 프로젝트에서 받는 것이 정확합니다.
