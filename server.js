/*
 * CGV 상영시간표 조회 서버
 *
 * - 정적 파일(public/index.html)을 서빙
 * - /api/schedule 엔드포인트에서 서버가 대신 CGV API를 호출하여
 *   브라우저의 CORS 제약을 우회한다.
 *
 * 사내망(MITM 프록시) 환경에서 SSL 인증서 검증 오류
 * (UNABLE_TO_VERIFY_LEAF_SIGNATURE)가 발생하는 경우 아래 두 가지 방법 중
 * 하나를 사용한다. (자세한 설명은 README.md 참고)
 *
 *   방법 A (권장, 안전) - 사내 루트 CA 인증서를 신뢰 목록에 추가
 *     Windows에서 사내 루트 CA(.crt/.pem)를 내보낸 뒤 아래처럼 실행:
 *       set NODE_EXTRA_CA_CERTS=C:\path\to\corporate-root-ca.pem
 *       npm start
 *
 *   방법 B (임시, 사내망 전용) - 이 API 호출에 한해 인증서 검증 생략
 *       set ALLOW_INSECURE_TLS=true
 *       npm start
 *
 * 실행:
 *   npm install
 *   npm start
 *
 * 접속:
 *   http://localhost:3000
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Agent, fetch: undiciFetch } = require("undici");
const { CGV_REGIONS } = require("./public/theaters.js");

const app = express();
const PORT = process.env.PORT || 3000;


/*
 * .env 파일에서 API 키를 읽어온다. (별도 패키지 없이 최소 구현)
 * 이미 환경변수로 설정되어 있으면 그 값을 우선한다.
 */
function loadEnvFile() {

  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {

    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eq = trimmed.indexOf("=");

    if (eq <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }

  }

}

loadEnvFile();

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const OMDB_API_KEY = process.env.OMDB_API_KEY || "";

// 허용된 극장 코드만 조회 가능하도록 화이트리스트 관리
// (public/theaters.js 의 극장 목록에서 자동 생성 - CGV_극장코드.xlsx 기준)
const ALLOWED_SITE_NOS = new Set(
  CGV_REGIONS.flatMap(region => region.theaters.map(theater => theater.code))
);

// 사내 MITM 프록시 등으로 인증서 체인을 검증할 수 없는 경우를 위한
// 선택적(opt-in) 우회 옵션. 기본값은 false(정상 검증).
const ALLOW_INSECURE_TLS =
  String(process.env.ALLOW_INSECURE_TLS || "").toLowerCase() === "true";

const insecureAgent = ALLOW_INSECURE_TLS
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : null;

if (ALLOW_INSECURE_TLS) {
  console.warn(
    "[경고] ALLOW_INSECURE_TLS=true - CGV API 호출 시 TLS 인증서 검증을 " +
    "생략합니다. 사내망 등 신뢰된 환경에서만 사용하세요."
  );
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";


/*
 * 공통 fetch 헬퍼.
 * ALLOW_INSECURE_TLS=true 인 경우에만 인증서 검증을 생략하는
 * dispatcher를 사용한다.
 */
async function httpFetch(url, { headers = {}, timeout = 10000 } = {}) {

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const options = {
    method: "GET",
    headers: { "User-Agent": BROWSER_UA, ...headers },
    signal: controller.signal
  };

  if (insecureAgent) {
    options.dispatcher = insecureAgent;
  }

  try {

    return insecureAgent
      ? await undiciFetch(url, options)
      : await fetch(url, options);

  } finally {

    clearTimeout(timeoutId);

  }

}


app.use(express.static(path.join(__dirname, "public")));

/*
 * GET /api/schedule?siteNo=0004&scnYmd=20260808
 */
app.get("/api/schedule", async (req, res) => {

  const { siteNo, scnYmd } = req.query;

  if (!siteNo || !scnYmd) {
    return res.status(400).json({
      error: "siteNo, scnYmd 파라미터가 필요합니다."
    });
  }

  if (!ALLOWED_SITE_NOS.has(siteNo)) {
    return res.status(400).json({
      error: "허용되지 않은 극장 코드입니다."
    });
  }

  if (!/^\d{8}$/.test(scnYmd)) {
    return res.status(400).json({
      error: "scnYmd 형식이 올바르지 않습니다. (YYYYMMDD)"
    });
  }

  const cgvUrl =
    "https://cgv.co.kr/api/v1/booking/searchMovScnInfo" +
    "?coCd=A420" +
    "&siteNo=" + encodeURIComponent(siteNo) +
    "&scnYmd=" + encodeURIComponent(scnYmd) +
    "&rtctlScopCd=08";

  try {

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const fetchOptions = {
      method: "GET",
      headers: {
        "Accept": "application/json",
        // 일부 API는 브라우저 UA / Referer 확인을 하므로 함께 전달
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://cgv.co.kr/"
      },
      signal: controller.signal
    };

    // ALLOW_INSECURE_TLS=true인 경우에만 커스텀 dispatcher(인증서 검증 생략) 사용
    if (insecureAgent) {
      fetchOptions.dispatcher = insecureAgent;
    }

    const response = insecureAgent
      ? await undiciFetch(cgvUrl, fetchOptions)
      : await fetch(cgvUrl, fetchOptions);

    clearTimeout(timeoutId);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "(본문 읽기 실패)");
      console.error("===== CGV 응답 오류 상세 =====");
      console.error("status:", response.status);
      console.error("headers:", JSON.stringify([...response.headers.entries()]));
      console.error("body (앞 500자):", bodyText.slice(0, 500));
      console.error("==============================");

      return res.status(response.status).json({
        error: `CGV 서버 응답 오류 (HTTP ${response.status})`
      });
    }

    const json = await response.json();

    return res.json(json);

  } catch (error) {

    console.error("CGV API 호출 실패:", error);

    let hint = "";

    if (
      error.cause &&
      error.cause.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    ) {
      hint =
        " (사내망 SSL 인증서 검증 문제로 보입니다. README.md의 " +
        "'SSL 인증서 오류 해결' 항목을 참고하세요.)";
    }

    return res.status(502).json({
      error: "CGV 서버 호출에 실패했습니다: " + error.message + hint
    });

  }

});

/* ------------------------------------------------------------------
 * 영화 상세정보 조회
 *
 *   TMDB  - 포스터, 감독, 출연진, 줄거리, 개봉일, 러닝타임, 장르
 *   OMDb  - IMDb 평점, 전문가 평점(Metacritic / Rotten Tomatoes)
 *   네이버 - 실관람객(관객) 평점, 관객 한줄평
 *
 * 세 소스를 각각 독립적으로 호출하며, 일부가 실패해도 나머지는
 * 그대로 응답한다.
 * ------------------------------------------------------------------ */

// OMDb 무료 키는 하루 1,000건 제한이므로 조회 결과를 캐시한다.
const movieCache = new Map();

const MOVIE_CACHE_TTL = 6 * 60 * 60 * 1000;   // 6시간 (정상 조회)

/*
 * 일부 소스를 못 가져온 결과는 짧게만 캐시한다.
 * 일시적인 실패를 6시간 동안 붙잡고 있으면, 실제로는 정보가 있는 영화가
 * 계속 "정보 없음"으로 보이기 때문이다.
 */
const PARTIAL_CACHE_TTL = 3 * 60 * 1000;      // 3분 (일부 실패)


/*
 * CGV 영화명에는 상영 포맷/버전 표기가 섞여 있어 그대로 검색하면
 * 매칭률이 떨어진다.
 *
 *   "[IMAX]듄: 파트2" → "듄: 파트2"
 *   "(자막)파묘"       → "파묘"
 */
function cleanMovieTitle(rawTitle) {

  let title = String(rawTitle || "");

  /*
   * 괄호 안 부가정보를 통째로 제거한다.
   *
   *   "스파이더맨-브랜드 뉴 데이(SCREENX 2D)"      → "스파이더맨-브랜드 뉴 데이"
   *   "라스트 키스(가브리엘레 무치노 감독전)"        → "라스트 키스"
   *   "[IMAX](자막)듄: 파트2"                     → "듄: 파트2"
   *
   * 괄호 종류가 섞여 들어오는 경우가 있어 대괄호·소괄호·꺾쇠를 모두 처리한다.
   */
  title = title.replace(/\[[^\]]*\]/g, " ");
  title = title.replace(/\([^)]*\)/g, " ");
  title = title.replace(/（[^）]*）/g, " ");
  title = title.replace(/〈[^〉]*〉/g, " ");

  // 괄호 없이 붙어있는 포맷 표기 제거
  title = title.replace(
    /\b(IMAX|SCREENX|SCREEN X|4DX|SPHEREX|DOLBY ?CINEMA|ATMOS|CINE ?DE ?CHEF|GOLD ?CLASS|TEMPUR ?CINEMA|PRIVATE ?BOX|SUITE ?CINEMA)\b/gi,
    " "
  );

  return title.replace(/\s+/g, " ").trim() || String(rawTitle || "").trim();

}


/*
 * 괄호를 남긴 채 포맷 표기만 걷어낸 제목.
 * 제목 자체에 괄호가 들어가는 영화를 위한 예비 검색어로 쓴다.
 */
function cleanMovieTitleKeepParens(rawTitle) {

  return String(rawTitle || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(
      /\b(IMAX|SCREENX|SCREEN X|4DX|SPHEREX|DOLBY ?CINEMA|ATMOS|CINE ?DE ?CHEF|GOLD ?CLASS|TEMPUR ?CINEMA|PRIVATE ?BOX|SUITE ?CINEMA)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

}


/*
 * 사람 이름이 한글 또는 영문(라틴) 표기인지 판단한다.
 *
 * TMDB 한국어 데이터에는 한자·가나 이름이 그대로 남아있는 경우가 있어
 * (예: 화양연화 "萧炳林", 패왕별희 "葛优"),
 * 이런 이름은 영어 크레딧의 로마자 표기로 바꿔준다.
 *
 * 값이 비어 있으면 판단 대상이 아니므로 true로 본다.
 */
function isKoreanOrLatinName(value) {

  const stripped = String(value || "").replace(/[\s0-9\p{P}\p{S}]/gu, "");

  if (!stripped) {
    return true;
  }

  return /^[\p{Script=Hangul}\p{Script=Latin}]+$/u.test(stripped);

}


/*
 * TMDB 영화 검색. 결과 배열을 반환한다.
 */
async function searchTmdb(query) {

  const searchUrl =
    "https://api.themoviedb.org/3/search/movie" +
    "?query=" + encodeURIComponent(query) +
    "&language=ko-KR&include_adult=false" +
    "&api_key=" + TMDB_API_KEY;

  const searchResponse = await httpFetch(searchUrl);

  if (!searchResponse.ok) {
    throw new Error("TMDB 검색 실패 (HTTP " + searchResponse.status + ")");
  }

  const searchJson = await searchResponse.json();

  return searchJson.results || [];

}


/*
 * TMDB에서 영화를 검색하고 상세정보 + 크레딧을 가져온다.
 *
 * fallbackTitle은 괄호를 남긴 제목으로, 괄호가 제목의 일부인 영화가
 * 정제 후 검색되지 않을 때 예비로 사용한다.
 */
async function fetchTmdb(title, fallbackTitle) {

  if (!TMDB_API_KEY) {
    return { available: false, reason: "TMDB_API_KEY가 설정되지 않았습니다." };
  }

  let results = await searchTmdb(title);

  // 괄호를 제거한 제목으로 못 찾으면 원래 제목으로 한 번 더 시도
  if (!results.length && fallbackTitle && fallbackTitle !== title) {
    results = await searchTmdb(fallbackTitle);
  }

  if (!results.length) {
    return { available: false, reason: "TMDB에서 영화를 찾지 못했습니다." };
  }

  /*
   * 대표 항목 선정
   *
   * 인기도만으로 고르면 "위키드" → "위키드: 포 굿",
   * "아바타" → "아바타: 불과 재" 처럼 더 최신인 속편이 뽑힌다.
   * 제목이 정확히 일치하는 항목을 우선하고, 그 안에서 인기도로 비교한다.
   */
  const normalize = value =>
    String(value || "").toLowerCase().replace(/[\s:·・,.\-!?]/g, "");

  const target = normalize(title);

  const rank = item => {

    const titleMatch = normalize(item.title) === target;
    const originalMatch = normalize(item.original_title) === target;

    if (titleMatch || originalMatch) {
      return 0;                                   // 제목 완전 일치
    }

    if (normalize(item.title).startsWith(target)) {
      return 1;                                   // 제목이 검색어로 시작
    }

    return 2;                                     // 그 외
  };

  const best = results.slice().sort((a, b) => {

    const rankDiff = rank(a) - rank(b);

    if (rankDiff !== 0) {
      return rankDiff;
    }

    return (b.popularity || 0) - (a.popularity || 0);

  })[0];

  const detailUrl =
    "https://api.themoviedb.org/3/movie/" + best.id +
    "?language=ko-KR&append_to_response=credits" +
    "&api_key=" + TMDB_API_KEY;

  const detailResponse = await httpFetch(detailUrl);

  if (!detailResponse.ok) {
    throw new Error("TMDB 상세조회 실패 (HTTP " + detailResponse.status + ")");
  }

  const detail = await detailResponse.json();
  const credits = detail.credits || {};

  const directorList = (credits.crew || [])
    .filter(person => person.job === "Director");

  const castList = (credits.cast || []).slice(0, 10);

  /*
   * 한국어 크레딧에 한자·가나 이름이 그대로 남아있는 경우
   * (예: 패왕별희 "葛优") 영어 크레딧의 로마자 표기로 대체한다.
   * 필요할 때만 추가로 호출한다.
   */
  const needsEnglish =
    [...directorList, ...castList].some(person => !isKoreanOrLatinName(person.name)) ||
    castList.some(person => !isKoreanOrLatinName(person.character));

  let englishCast = new Map();
  let englishCrew = new Map();

  if (needsEnglish) {

    try {

      const englishResponse = await httpFetch(
        "https://api.themoviedb.org/3/movie/" + best.id +
        "/credits?language=en-US&api_key=" + TMDB_API_KEY
      );

      if (englishResponse.ok) {

        const englishCredits = await englishResponse.json();

        englishCast = new Map(
          (englishCredits.cast || []).map(person => [person.id, person])
        );

        englishCrew = new Map(
          (englishCredits.crew || []).map(person => [person.id, person])
        );

      }

    } catch (error) {
      // 영어 크레딧을 못 가져와도 한국어 값을 그대로 사용한다.
    }

  }

  /*
   * 한글/영문이 아니면 영어 크레딧 값으로 바꾼다.
   * 영어 쪽도 한글/영문이 아니면 원래 값을 유지한다.
   */
  const preferReadable = (value, alternative) => {

    if (isKoreanOrLatinName(value)) {
      return value;
    }

    return isKoreanOrLatinName(alternative) && alternative
      ? alternative
      : value;

  };

  const directors = directorList.map(person =>
    preferReadable(person.name, (englishCrew.get(person.id) || {}).name)
  );

  const cast = castList.map(person => {

    const english = englishCast.get(person.id) || {};

    return {
      name: preferReadable(person.name, english.name),
      character: preferReadable(person.character || "", english.character),
      profile: person.profile_path
        ? "https://image.tmdb.org/t/p/w185" + person.profile_path
        : null
    };

  });

  return {
    available: true,
    tmdbId: detail.id,
    imdbId: detail.imdb_id || null,
    title: detail.title || best.title,
    originalTitle: detail.original_title || "",
    tagline: detail.tagline || "",
    overview: detail.overview || "",
    releaseDate: detail.release_date || "",
    runtime: detail.runtime || null,
    genres: (detail.genres || []).map(genre => genre.name),
    poster: detail.poster_path
      ? "https://image.tmdb.org/t/p/w500" + detail.poster_path
      : null,
    backdrop: detail.backdrop_path
      ? "https://image.tmdb.org/t/p/w780" + detail.backdrop_path
      : null,
    voteAverage: detail.vote_average || null,
    voteCount: detail.vote_count || null,
    directors,
    cast
  };

}


/*
 * OMDb에서 IMDb 평점과 전문가 평점을 가져온다.
 * imdbId가 있어야 정확히 매칭되므로 TMDB 조회 결과를 입력으로 받는다.
 */
async function fetchOmdb(imdbId) {

  if (!OMDB_API_KEY) {
    return { available: false, reason: "OMDB_API_KEY가 설정되지 않았습니다." };
  }

  if (!imdbId) {
    return { available: false, reason: "IMDb ID를 찾지 못했습니다." };
  }

  const url =
    "https://www.omdbapi.com/?i=" + encodeURIComponent(imdbId) +
    "&apikey=" + OMDB_API_KEY;

  const response = await httpFetch(url);

  if (!response.ok) {
    throw new Error("OMDb 호출 실패 (HTTP " + response.status + ")");
  }

  const json = await response.json();

  if (json.Response !== "True") {
    return {
      available: false,
      reason: json.Error || "OMDb에서 정보를 찾지 못했습니다."
    };
  }

  const pick = source => {
    const found = (json.Ratings || []).find(r => r.Source === source);
    return found ? found.Value : null;
  };

  const notAvailable = value =>
    !value || value === "N/A" ? null : value;

  return {
    available: true,
    imdbId,
    imdbUrl: "https://www.imdb.com/title/" + imdbId + "/",
    imdbRating: notAvailable(json.imdbRating),
    imdbVotes: notAvailable(json.imdbVotes),
    metascore: notAvailable(json.Metascore),
    rottenTomatoes: notAvailable(pick("Rotten Tomatoes")),
    rated: notAvailable(json.Rated),
    awards: notAvailable(json.Awards)
  };

}


/*
 * HTML 태그를 걷어내고 한 줄 텍스트로 만든다.
 */
function toPlainText(html) {

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

}


/*
 * 네이버 영화 패널이 내부적으로 쓰는 API를 호출한다.
 * 응답은 { "html": "..." } 형태이므로 html 문자열만 꺼내온다.
 */
async function fetchNaverPanel(url) {

  const response = await httpFetch(url, {
    headers: {
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": "https://search.naver.com/"
    }
  });

  if (!response.ok) {
    return null;
  }

  const json = await response.json().catch(() => null);

  return json && json.html ? toPlainText(json.html) : null;

}


/*
 * 네이버 평론가(전문가) 평점과 코멘트
 *
 *   "이름 박평식 작성일 2024.02.21 별점(10점 만점 중) 6.0 난폭, 변덕, 애국의 삽질"
 */
async function fetchNaverCritics(movieCode) {

  const text = await fetchNaverPanel(
    "https://ts-proxy.naver.com/content/nqapirender.nhn" +
    "?where=nexearch&pkid=68&fileKey=movieKBExpertPointAPI&u1=" + movieCode
  );

  if (!text) {
    return [];
  }

  const pattern =
    /이름\s+(\S+(?:\s\S+)?)\s+작성일\s+([\d.]+)\s+별점\(10점\s*만점\s*중\)\s+([\d.]+)\s+(.+?)(?=\s+이름\s+\S+\s+작성일|\s*$)/g;

  return [...text.matchAll(pattern)].map(match => ({
    name: match[1],
    date: match[2],
    score: match[3],
    comment: match[4].trim()
  }));

}


/*
 * 네이버 관객 한줄평
 *
 * 검색 결과 HTML이 아니라 평점 패널 API에서 가져온다.
 * isRealAudience=true면 실관람객, false면 네티즌 평가를 조회한다.
 */
async function fetchNaverReviews(movieCode, isRealAudience) {

  const text = await fetchNaverPanel(
    "https://ts-proxy.naver.com/dcontent/nqapirender.nhn" +
    "?where=nexearch&pkid=68&fileKey=movieKBPointAPI&u1=" + movieCode +
    "&u5=" + (isRealAudience ? "true" : "")
  );

  if (!text) {
    return [];
  }

  const pattern =
    /별점\(10점\s*만점\s*중\)\s*(\d{1,2})\s+(.+?)\s*(?:펼쳐보기\s*)?작성자\s+(\S+)\s+작성일\s+([\d.]+)[^\d]*[\d:]*\s*신고여부\s*신고\s*([\d,]+)/g;

  return [...text.matchAll(pattern)].slice(0, 5).map(match => ({
    score: match[1],
    // 실관람객 항목은 본문 앞에 "관람객" 뱃지 문구가 붙는다.
    content: match[2].replace(/^관람객\s*/, "").trim(),
    author: match[3],
    date: match[4],
    likes: match[5]
  }));

}


/*
 * 네이버에서 관객 평점 / 관객 한줄평 / 평론가 평점을 가져온다.
 *
 * 네이버는 영화 정보용 공식 API를 제공하지 않으므로(2023년 서비스 종료)
 * 통합검색 결과와 검색 화면이 내부적으로 호출하는 패널 API를 이용한다.
 * 네이버가 화면 구조를 바꾸면 동작하지 않을 수 있으며, 그 경우
 * available:false로 응답한다.
 *
 * 참고: 검색어에 "평점"을 붙여야 영화 패널이 렌더링되고,
 *       패널 안에 영화 코드(mcode)가 들어있다.
 */
async function fetchNaver(title) {

  const url =
    "https://search.naver.com/search.naver?query=" +
    encodeURIComponent("영화 " + title + " 평점");

  const response = await httpFetch(url, {
    headers: { "Accept-Language": "ko-KR,ko;q=0.9" }
  });

  if (!response.ok) {
    throw new Error("네이버 조회 실패 (HTTP " + response.status + ")");
  }

  const html = await response.text();
  const text = toPlainText(html);

  /*
   * 평점 라벨은 영화에 따라 다르다.
   *   관객이 많은 영화 → "실관람객 평점 9.13 10 17,074명 참여"
   *   관객이 적은 영화 → "네티즌 평점 6.43 10 7명 참여"
   */
  const scoreMatch = text.match(
    /(실관람객|네티즌)\s*평점[^0-9]{0,40}(\d{1,2}\.\d{1,2})\s*(?:10)?\s*([\d,]+)\s*명\s*참여/
  );

  const looseScore = scoreMatch
    ? null
    : text.match(/(실관람객|네티즌)\s*평점[^0-9]{0,40}(\d{1,2}\.\d{1,2})/);

  const scoreType = scoreMatch
    ? scoreMatch[1]
    : (looseScore ? looseScore[1] : null);

  const score = scoreMatch
    ? scoreMatch[2]
    : (looseScore ? looseScore[2] : null);

  const participants = scoreMatch ? scoreMatch[3] : null;

  // 성별 평점 ("남자 9.19 여자 9.05")
  const genderMatch = text.match(
    /남자\s*(\d{1,2}\.\d{1,2})\s*여자\s*(\d{1,2}\.\d{1,2})/
  );

  // 네이버 영화 코드 - 평론가/한줄평 API 호출에 필요
  const codeMatch =
    html.match(/fileKey=movieKB\w*PointAPI&(?:amp;)?u1=(\d+)/) ||
    html.match(/mcode=(\d+)/);

  const movieCode = codeMatch ? codeMatch[1] : null;

  let reviews = [];
  let critics = [];

  if (movieCode) {

    const settle = promise => promise.catch(() => []);

    [reviews, critics] = await Promise.all([
      settle(fetchNaverReviews(movieCode, scoreType !== "네티즌")),
      settle(fetchNaverCritics(movieCode))
    ]);

  }

  /*
   * 영화 코드를 못 찾았다면 영화 패널이 뜨지 않은 것이다.
   * 이때 페이지 어딘가에서 우연히 걸린 평점은 다른 영화의 값일 수 있으므로
   * (예: "스파이더맨-브랜드 뉴 데이" 검색 시 8.67 - 실제는 9.01)
   * 신뢰할 수 없는 값으로 보고 버린다.
   */
  if (!movieCode) {
    return {
      available: false,
      reason: "네이버에서 이 제목의 영화 정보를 찾지 못했습니다."
    };
  }

  if (!score && !reviews.length && !critics.length) {
    return {
      available: false,
      movieCode,
      reason: "네이버 검색 결과에서 영화 정보를 찾지 못했습니다."
    };
  }

  // 평론가 평점 평균
  const criticAverage = critics.length
    ? (
        critics.reduce((sum, critic) => sum + parseFloat(critic.score), 0) /
        critics.length
      ).toFixed(2)
    : null;

  return {
    available: true,
    movieCode,
    audienceScore: score,
    audienceScoreType: scoreType,      // "실관람객" 또는 "네티즌"
    participants,
    maleScore: genderMatch ? genderMatch[1] : null,
    femaleScore: genderMatch ? genderMatch[2] : null,
    criticScore: criticAverage,
    criticCount: critics.length,
    critics,
    reviews,
    searchUrl: url
  };

}


/*
 * GET /api/movie?title=인터스텔라
 */
app.get("/api/movie", async (req, res) => {

  const rawTitle = req.query.title;

  if (!rawTitle || !String(rawTitle).trim()) {
    return res.status(400).json({ error: "title 파라미터가 필요합니다." });
  }

  if (String(rawTitle).length > 200) {
    return res.status(400).json({ error: "title이 너무 깁니다." });
  }

  const title = cleanMovieTitle(rawTitle);
  const fallbackTitle = cleanMovieTitleKeepParens(rawTitle);
  const cacheKey = title.toLowerCase();

  const cached = movieCache.get(cacheKey);

  if (cached && Date.now() - cached.at < cached.ttl) {
    return res.json({ ...cached.payload, cached: true });
  }

  // 실패한 소스는 사유만 남기고 나머지는 정상 응답한다.
  const settle = promise =>
    promise.catch(error => ({ available: false, reason: error.message }));

  try {

    let [tmdb, naver] = await Promise.all([
      settle(fetchTmdb(title, fallbackTitle)),
      settle(fetchNaver(title))
    ]);

    /*
     * CGV 영화명과 네이버 표기가 달라 영화 패널을 못 찾는 경우가 있다.
     *
     *   CGV    "스파이더맨-브랜드 뉴 데이"
     *   네이버  "스파이더맨: 브랜드 뉴 데이"
     *
     * 이때 mcode를 못 얻어 평론가 평점과 한줄평이 통째로 빠지므로,
     * TMDB가 찾아낸 정식 제목으로 한 번 더 조회한다.
     */
    if (
      tmdb && tmdb.available && tmdb.title &&
      (!naver || !naver.movieCode) &&
      tmdb.title.trim().toLowerCase() !== title.trim().toLowerCase()
    ) {

      const retry = await settle(fetchNaver(tmdb.title));

      if (retry && retry.movieCode) {
        naver = { ...retry, retriedWith: tmdb.title };
      }

    }

    const omdb = await settle(
      fetchOmdb(tmdb && tmdb.available ? tmdb.imdbId : null)
    );

    const payload = {
      query: { raw: rawTitle, cleaned: title },
      tmdb,
      omdb,
      naver
    };

    // 네이버 영화 패널까지 정상적으로 찾은 경우에만 오래 캐시한다.
    const complete =
      tmdb && tmdb.available && naver && naver.available && !!naver.movieCode;

    movieCache.set(cacheKey, {
      at: Date.now(),
      ttl: complete ? MOVIE_CACHE_TTL : PARTIAL_CACHE_TTL,
      payload
    });

    return res.json(payload);

  } catch (error) {

    console.error("영화 정보 조회 실패:", error);

    return res.status(502).json({
      error: "영화 정보 조회에 실패했습니다: " + error.message
    });

  }

});


app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  console.log(
    "  TMDB 키: " + (TMDB_API_KEY ? "설정됨" : "없음") +
    " / OMDb 키: " + (OMDB_API_KEY ? "설정됨" : "없음")
  );
});
