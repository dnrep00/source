# CGV 상영시간표 Excel 다운로드 (Node.js 버전)

브라우저에서 CGV API를 직접 호출하면 CORS 정책 때문에 `Failed to fetch` 오류가
발생할 수 있습니다. 이 버전은 **Node.js(Express) 서버가 대신 CGV API를 호출**하고,
브라우저는 내 컴퓨터의 서버(`localhost:3000`)에만 요청을 보내므로 CORS 문제가
발생하지 않습니다.

## 폴더 구조

```
cgv-schedule-app/
├── package.json
├── .env               ← API 키 (TMDB / OMDb) — 커밋 금지
├── server.js          ← Node.js 서버 (CGV·영화정보 프록시 + 정적 파일 서빙)
└── public/
    ├── index.html     ← 브라우저에서 보는 화면
    └── theaters.js    ← 전국 CGV 지역/극장 코드 (서버와 공용)
```

## 실행 방법

1. Node.js가 설치되어 있어야 합니다. (v18 이상 권장 — 없다면 https://nodejs.org 에서 설치)
2. 터미널(명령 프롬프트)에서 이 폴더로 이동합니다.

   ```
   cd cgv-schedule-app
   ```

3. 의존성을 설치합니다. (최초 1회만)

   ```
   npm install
   ```

4. 서버를 실행합니다.

   ```
   npm start
   ```

   아래와 같은 메시지가 뜨면 정상 실행된 것입니다.

   ```
   서버 실행 중: http://localhost:3000
   ```

5. 브라우저에서 다음 주소를 엽니다.

   ```
   http://localhost:3000
   ```

6. 날짜와 지역/극장(기본값: 경기 - CGV 오리)을 선택하고 "상영시간표 조회" 버튼을 누르면
   서버가 CGV API를 대신 호출해서 결과를 가져옵니다. 이후 "Excel 다운로드" 버튼으로
   `.xlsx` 파일을 저장할 수 있습니다.

7. 조회 결과에서 **영화명을 클릭하면 팝업**으로 상세정보가 표시됩니다.
   (포스터·감독·출연진·줄거리 / 관객 평점·한줄평 / 전문가 평점·코멘트 / IMDb 평점)

## 영화 상세정보 팝업

영화명을 클릭하면 세 곳에서 정보를 모아 보여줍니다.

| 항목 | 출처 |
|---|---|
| 포스터, 감독, 출연진, 줄거리, 개봉일, 러닝타임, 장르 | TMDB |
| 관객 평점(실관람객/네티즌), 성별 평점, 관객 한줄평 | 네이버 |
| **전문가(평론가) 평점 + 코멘트** | 네이버 |
| IMDb 평점 | OMDb |
| 해외 전문가 평점 (Metacritic, Rotten Tomatoes) | OMDb |

### API 키 설정

프로젝트 폴더의 `.env` 파일에 키를 넣습니다. (무료)

```
TMDB_API_KEY=발급받은_TMDB_키
OMDB_API_KEY=발급받은_OMDb_키
```

- TMDB: https://www.themoviedb.org/settings/api
- OMDb: https://www.omdbapi.com/apikey.aspx (FREE 선택 → 메일의 인증 링크 클릭 필요)

`.env` 대신 환경변수로 지정해도 되며, 환경변수가 있으면 그 값이 우선합니다.
키가 없어도 앱은 정상 동작하며, 해당 항목만 팝업에서 빠집니다.

### 알아둘 점

- **OMDb 무료 키는 하루 1,000건 제한**이고 라이선스가 비상업용(CC BY-NC 4.0)입니다.
  같은 영화를 반복 조회하지 않도록 서버가 결과를 캐시합니다. 다만 **일부 소스를
  못 가져온 결과는 3분만** 캐시합니다. 일시적인 실패를 6시간 붙잡고 있으면 실제로는
  정보가 있는 영화가 계속 "정보 없음"으로 보이기 때문입니다.
- **CGV 영화명과 네이버 표기가 다르면** 네이버가 영화 패널을 띄우지 않아 평론가 평점과
  한줄평이 통째로 빠집니다. (예: CGV `스파이더맨-브랜드 뉴 데이` ↔ 네이버
  `스파이더맨: 브랜드 뉴 데이` — 하이픈과 콜론 차이) 이 경우 TMDB가 찾아낸 정식
  제목으로 네이버를 한 번 더 조회합니다.
- 영화 패널을 못 찾았을 때는 페이지에서 우연히 걸린 평점을 쓰지 않고 "정보 없음"으로
  처리합니다. 다른 영화의 점수를 잘못 보여주는 것보다 낫기 때문입니다.
- **네이버는 영화 정보 공식 API가 없습니다.** (2023년 종료) 통합검색 결과와, 검색 화면이
  내부적으로 호출하는 평점 패널 API를 이용합니다. 네이버가 화면 구조를 바꾸면 평점이
  나오지 않을 수 있으며, 이 경우 팝업에 안내 문구가 표시되고 나머지 정보는 그대로 보입니다.
- **검색어에 "평점"을 붙여야** 네이버가 영화 패널을 렌더링하고, 그 안에 평론가·한줄평
  API 호출에 필요한 영화 코드(`mcode`)가 들어있습니다. `server.js`의 `fetchNaver()`가
  이 코드를 뽑아 아래 두 API를 호출합니다.
  - 평론가 평점·코멘트: `movieKBExpertPointAPI`
  - 관객 한줄평: `movieKBPointAPI`
- **관객 평점 라벨은 영화마다 다릅니다.** 관객이 많으면 "실관람객 평점", 적으면
  "네티즌 평점"으로 표기되므로 양쪽 모두 인식합니다. 팝업에도 해당 라벨이 그대로
  표시됩니다.
- 네이버 평론가 평점이 등록되지 않은 영화(주로 해외 소규모 개봉작)는 해당 카드와
  전문가 평 섹션이 표시되지 않고 안내 문구가 나옵니다. Metacritic·Rotten Tomatoes도
  데이터가 없으면 마찬가지입니다.
- CGV 영화명의 **괄호 안 부가정보는 검색 전에 모두 제거**됩니다. 대괄호·소괄호 모두
  대상이며, 괄호 밖에 붙은 `IMAX`·`SCREENX` 같은 포맷 표기도 함께 지웁니다.

  | CGV 영화명 | 검색어 |
  |---|---|
  | `스파이더맨-브랜드 뉴 데이(SCREENX 2D)` | `스파이더맨-브랜드 뉴 데이` |
  | `라스트 키스(가브리엘레 무치노 감독전)` | `라스트 키스` |
  | `[IMAX](자막)듄: 파트2` | `듄: 파트2` |

  괄호가 제목의 일부인 영화까지 놓치지 않도록, 괄호를 제거한 검색이 실패하면
  괄호를 살린 제목으로 한 번 더 검색합니다.
- **사람 이름은 한글 또는 영문으로 표시됩니다.** TMDB 한국어 데이터에는 한자·가나
  이름이 그대로 남아있는 경우가 있어(예: 화양연화 `萧炳林`, 패왕별희 `吕齐`),
  이런 이름은 영어 크레딧의 로마자 표기(`Siu Ping-Lam`, `Lü Qi`)로 자동 대체합니다.
  한국어 이름이 이미 한글이면 그대로 두고, 영어 쪽에도 쓸 만한 표기가 없으면
  원래 값을 유지합니다. 이 추가 조회는 필요한 영화에서만 발생합니다.

## 종료 방법

터미널에서 `Ctrl + C`를 누르면 서버가 종료됩니다.

## SSL 인증서 오류 해결 (사내망 MITM 프록시 환경)

삼성SDS 등 사내망에서는 보안 프록시가 HTTPS 트래픽을 중간에서 검사(MITM)하면서
자체 인증서로 바꿔치기하는 경우가 있습니다. 이 경우 Node.js가 그 인증서를
신뢰하지 못해 아래와 같은 오류가 납니다.

```
CGV API 호출 실패: [TypeError: fetch failed] {
  [cause]: Error: unable to verify the first certificate ...
  code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
}
```

### 방법 A — 사내 루트 CA 인증서 등록 (권장)

1. 브라우저(Chrome/Edge)에서 `https://cgv.co.kr` 접속 후 주소창의 자물쇠 아이콘 →
   인증서 정보 → 인증서 경로(체인)에서 가장 위(루트) 인증서를 `.crt` 또는 `.pem`
   파일로 내보내기(export) 합니다. (사내 IT/보안팀에 이미 배포된 루트 CA 파일이
   있다면 그것을 사용해도 됩니다.)
2. 서버 실행 시 `NODE_EXTRA_CA_CERTS` 환경변수로 해당 파일을 지정합니다.

   **Windows (명령 프롬프트)**
   ```
   set NODE_EXTRA_CA_CERTS=C:\certs\corporate-root-ca.pem
   npm start
   ```

   **Windows (PowerShell)**
   ```
   $env:NODE_EXTRA_CA_CERTS="C:\certs\corporate-root-ca.pem"
   npm start
   ```

   **macOS / Linux**
   ```
   export NODE_EXTRA_CA_CERTS=/path/to/corporate-root-ca.pem
   npm start
   ```

이렇게 하면 Node가 사내 루트 CA를 신뢰 목록에 추가해서, 이후의 모든 HTTPS 호출이
정상적으로 인증서를 검증합니다. 가장 안전한 방법이므로 가능하면 이 방법을
사용하세요.

### 방법 B — 이 API 호출에 한해 인증서 검증 생략 (임시)

루트 CA 파일을 구하기 어렵거나 당장 테스트가 급한 경우, `ALLOW_INSECURE_TLS`
환경변수를 켜면 CGV API 호출 시에만 인증서 검증을 건너뜁니다. (다른 요청에는
영향을 주지 않도록 이 호출에만 국한해서 적용됩니다.)

**Windows (명령 프롬프트)**
```
set ALLOW_INSECURE_TLS=true
npm start
```

**Windows (PowerShell)**
```
$env:ALLOW_INSECURE_TLS="true"
npm start
```

**macOS / Linux**
```
export ALLOW_INSECURE_TLS=true
npm start
```

⚠️ 이 방법은 인증서 위·변조 여부를 확인하지 않으므로, 신뢰할 수 있는 사내망
환경에서 CGV 조회 용도로만 임시로 사용하시고, 공용 와이파이 등 신뢰할 수 없는
네트워크에서는 사용하지 마세요.

## 참고

- 전국 CGV 극장 목록(9개 지역 / 178개 극장)은 `public/theaters.js`의 `CGV_REGIONS`에
  정의되어 있습니다. (출처: `CGV_극장코드.xlsx`)
  이 한 파일을 브라우저(지역/극장 선택 박스)와 서버(`ALLOWED_SITE_NOS` 화이트리스트)가
  함께 사용하므로, 극장을 추가·수정하려면 `public/theaters.js`만 고치면 됩니다.
- 기본 선택 극장은 `public/theaters.js`의 `CGV_DEFAULT_REGION` / `CGV_DEFAULT_SITE_NO`로
  바꿀 수 있습니다. (현재: 경기 / `0004` = CGV 오리)
- CGV 측에서 API 정책(요청 빈도 제한, User-Agent 검증 등)을 바꾸면 서버 쪽 호출도
  영향을 받을 수 있습니다. 이 경우 `server.js`의 요청 헤더를 조정해야 할 수 있습니다.

