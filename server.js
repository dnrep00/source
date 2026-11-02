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

    /*
     * 값을 감싼 따옴표는 벗긴다. TMDB_API_KEY="abc" 처럼 적는 것이
     * .env에서는 흔한데, 그대로 두면 따옴표까지 키에 붙어 모든 호출이
     * 401로 떨어진다 — 원인을 찾기 어려운 실패라 여기서 막는다.
     */
    let value = trimmed.slice(eq + 1).trim();

    if (value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
         (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }

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
 *
 * 타임아웃은 본문을 다 읽을 때까지 걸려 있다. 헤더가 도착한 시점에 타이머를
 * 끄면 그 뒤의 .json()/.text()는 무제한이 되는데, 실제로 늘어지는 쪽은 본문
 * 이다 — 특히 네이버 검색 HTML 조회.
 *
 * Response 그대로가 아니라 ok/status/json/text만 가진 객체를 돌려준다.
 * 호출부가 쓰는 것이 그 넷뿐이라 이 정도로 충분하다.
 */
async function httpFetch(url, { headers = {}, timeout = 10000 } = {}) {

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // 본문을 읽지 않고 끝나는 호출(!ok로 바로 빠지는 경우)이 남긴 타이머가
  // 프로세스를 붙잡지 않도록 한다. 이미 끝난 요청에 대한 abort는 무해하다.
  if (typeof timeoutId.unref === "function") {
    timeoutId.unref();
  }

  const options = {
    method: "GET",
    headers: { "User-Agent": BROWSER_UA, ...headers },
    signal: controller.signal
  };

  if (insecureAgent) {
    options.dispatcher = insecureAgent;
  }

  let response;

  try {

    response = insecureAgent
      ? await undiciFetch(url, options)
      : await fetch(url, options);

  } catch (error) {

    clearTimeout(timeoutId);
    throw error;

  }

  const readBody = promise =>
    promise.finally(() => clearTimeout(timeoutId));

  return {
    ok: response.ok,
    status: response.status,
    json: () => readBody(response.json()),
    text: () => readBody(response.text())
  };

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

    const response = await httpFetch(cgvUrl, {
      headers: {
        "Accept": "application/json",
        // CGV는 브라우저 Referer를 확인하므로 함께 보낸다. (UA는 httpFetch가 붙인다)
        "Referer": "https://cgv.co.kr/"
      }
    });

    if (!response.ok) {
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
 * 만료된 항목을 실제로 지운다.
 *
 * TTL을 넘긴 엔트리도 Map에는 그대로 남아, 같은 제목을 다시 조회하지 않는 한
 * 영영 회수되지 않았다. 조회한 영화 수만큼 프로세스 수명 내내 쌓인다.
 */
function pruneMovieCache() {

  const now = Date.now();

  for (const [key, entry] of movieCache) {

    if (now - entry.at >= entry.ttl) {
      movieCache.delete(key);
    }

  }

}


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

/* ------------------------------------------------------------------
 * 네이버 영화 평점 / 관람평
 *
 * 네이버는 영화 정보용 공식 API를 제공하지 않는다(2023년 서비스 종료).
 * 예전에는 검색 결과 HTML과 nqapirender.nhn 패널 API를 정규식으로 긁었는데,
 * 그 경로는 2026년 개편으로 사라졌다 - 지금은 검색 페이지가 콘텐츠 ID만 들고
 * 있고 실제 데이터는 아래 JSON API에서 클라이언트가 따로 받아간다.
 *
 *   1. 검색 HTML에서 csearch/contents/{contentId} 를 뽑는다.
 *   2. api-gw.entertain.naver.com 에서 ent.movie.full.info 와
 *      ent.movie.standalone.rating 모듈을 한 번에 받는다.
 *
 * 두 모듈을 같이 받는 이유:
 *   - full.info        실관람객/네티즌 평점(ratingBlock)과 관람평(review)
 *   - standalone.rating 평론가 평점. 평론가 이름과 작성일이 여기에만 있고,
 *                      건수도 full.info 쪽(4건)보다 많다(11건).
 *
 * 비공식 경로인 것은 예전과 같으므로 네이버가 또 바꾸면 멈춘다. 그때는
 * available:false로만 응답하고 TMDB/OMDb 결과는 그대로 보여준다.
 * ------------------------------------------------------------------ */

const NAVER_API_BASE = "https://api-gw.entertain.naver.com/csearch/contents";

// 관람평(실관람객/네티즌 한줄평)은 위와 다른 게이트웨이에서 온다.
const NAVER_POINT_API = "https://proxy-gw.entertain.naver.com/movie/api";

// 영화 콘텐츠를 가리키는 네이버 내부 분류값. 검색 페이지가 항상 이 값을 쓴다.
const NAVER_MOVIE_PKID = "68";

// 팝업에 넣을 관람평 수. API는 200건까지도 주지만 한 화면에 들어갈 만큼만 받는다.
const NAVER_REVIEW_COUNT = 5;


/*
 * 검색 결과에서 그 영화를 가리키는 두 개의 ID를 찾는다.
 *
 * 검색어에 "평점"을 붙여야 영화 패널이 뜨고, 패널이 떠야 두 ID가 HTML 안에
 * 박힌다. 영화가 아니거나(드라마·시리즈) 네이버가 패널을 띄우지 않으면
 * 둘 다 null이 나온다.
 *
 *   contentId  검색 콘텐츠 ID. 평점·평론가 조회(csearch)에 쓴다.
 *   movieCode  네이버 영화 코드. 관람평 조회에 쓴다. 두 API가 서로 다른
 *              ID 체계를 쓰기 때문에 둘 다 필요하다.
 */
async function fetchNaverIds(title) {

  const searchUrl =
    "https://search.naver.com/search.naver?query=" +
    encodeURIComponent("영화 " + title + " 평점");

  const response = await httpFetch(searchUrl, {
    headers: { "Accept-Language": "ko-KR,ko;q=0.9" }
  });

  if (!response.ok) {
    throw new Error("네이버 조회 실패 (HTTP " + response.status + ")");
  }

  const html = await response.text();

  const contentId = (html.match(/csearch\/contents\/(\d+)/) || [])[1] || null;
  const movieCode = (html.match(/"movieCode":"?(\d+)"?/) || [])[1] || null;

  return { contentId, movieCode, searchUrl };
}


/*
 * 관람평 목록.
 *
 * Reproduces: GET /movie/api/netizen-point-list — 검색 화면의 관람평 탭이
 * 부르는 API. onlyActualPoint가 실관람객(Y)과 네티즌(N)을 가른다.
 *
 * 관람평은 평점에 딸린 부가 정보라, 이 호출이 실패해도 예외를 던지지 않고
 * 빈 배열을 돌려준다 — 평점까지 같이 사라지게 둘 이유가 없다.
 */
async function fetchNaverPointList(movieCode, onlyActualPoint) {

  const url =
    NAVER_POINT_API + "/netizen-point-list?" +
    new URLSearchParams({
      movieCode: String(movieCode),
      onlyActualPoint: String(onlyActualPoint),
      order: "sympathyScore",              // 공감순. "newest"면 최신순
      includeSpoiler: "false",
      page: "1",
      pageSize: String(NAVER_REVIEW_COUNT)
    }).toString();

  const response = await httpFetch(url, {
    headers: {
      "Accept": "application/json",
      "Referer": "https://search.naver.com/"
    }
  });

  if (!response.ok) {
    return [];
  }

  const json = await response.json();

  if (json.resultCode && json.resultCode !== "SUCCESS") {
    return [];
  }

  return (json.pointList || []).map(point => ({
    score: String(point.point),
    content: (point.ment || "").trim(),
    author: point.userMaskId || "",
    date: point.date || "",
    likes: typeof point.sympathyCount === "number"
      ? point.sympathyCount.toLocaleString("en-US")
      : ""
  }));
}


/*
 * 평론가 평점 목록.
 *
 *   { reviewerName, writtenAt, rating, text } -> { name, date, score, comment }
 */
function toCritics(ratingInfo) {

  const items = (ratingInfo && ratingInfo.critic && ratingInfo.critic.items) || [];

  // writtenAt은 "20260731" 형태로 온다. 화면 표기에 맞춰 끊어준다.
  const formatDate = value =>
    /^\d{8}$/.test(value || "")
      ? value.slice(0, 4) + "." + value.slice(4, 6) + "." + value.slice(6, 8)
      : (value || "");

  return items.map(item => ({
    name: item.reviewerName || "",
    date: formatDate(item.writtenAt),
    score: String(item.rating),
    comment: (item.text || "").trim()
  }));
}


/*
 * 네이버에서 실관람객/네티즌 평점과 관람평, 평론가 평점을 가져온다.
 *
 * 반환값의 audienceScore는 실관람객 평점이고, 실관람객 평점이 아직 없는
 * 영화(개봉 직후 등)는 네티즌 평점으로 대체한다. 어느 쪽인지는
 * audienceScoreType에 담아 화면에서 라벨로 쓴다.
 */
async function fetchNaver(title) {

  const { contentId, movieCode, searchUrl } = await fetchNaverIds(title);

  if (!contentId) {
    return {
      available: false,
      reason: "네이버에서 이 제목의 영화 정보를 찾지 못했습니다."
    };
  }

  const apiUrl =
    NAVER_API_BASE + "/" + contentId +
    "?modules=ent.movie.full.info,ent.movie.standalone.rating" +
    "&pkid=" + NAVER_MOVIE_PKID;

  const response = await httpFetch(apiUrl, {
    headers: {
      "Accept": "application/json",
      "Referer": "https://search.naver.com/"
    }
  });

  if (!response.ok) {
    throw new Error("네이버 영화 API 실패 (HTTP " + response.status + ")");
  }

  const pool = ((await response.json()).result || {}).dataPool || {};

  const ratings = (pool.ratingBlock && pool.ratingBlock.ratings) || [];
  const actual = ratings.find(rating => rating.type === "actual");
  const netizen = ratings.find(rating => rating.type === "netizen");

  const critics = toCritics(pool.ratingInfo);

  /*
   * 관람평은 실관람객을 먼저 본다. 아직 아무도 남기지 않은 영화(개봉 직후
   * 등)만 네티즌 관람평으로 대신하므로, 두 번째 호출은 그때만 일어난다.
   */
  let reviews = movieCode ? await fetchNaverPointList(movieCode, true) : [];
  let reviewType = "실관람객";

  if (!reviews.length && movieCode) {
    reviews = await fetchNaverPointList(movieCode, false);
    reviewType = "네티즌";
  }

  const primary = actual || netizen;

  if (!primary && !reviews.length && !critics.length) {
    return {
      available: false,
      movieCode: contentId,
      reason: "네이버에 이 영화의 평점이 아직 등록되지 않았습니다."
    };
  }

  const criticAverage = critics.length
    ? (
        critics.reduce((sum, critic) => sum + parseFloat(critic.score), 0) /
        critics.length
      ).toFixed(2)
    : null;

  return {
    available: true,
    movieCode: contentId,
    audienceScore: primary ? String(primary.score) : null,
    audienceScoreType: actual ? "실관람객" : (netizen ? "네티즌" : null),
    participants: primary ? primary.joinCount.toLocaleString("en-US") : null,
    netizenScore: netizen ? String(netizen.score) : null,
    netizenParticipants: netizen ? netizen.joinCount.toLocaleString("en-US") : null,
    reviewType: reviews.length ? reviewType : null,
    criticScore: criticAverage,
    criticCount: critics.length,
    critics,
    reviews,
    searchUrl
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
     * 이때 콘텐츠 ID를 못 얻어 평점과 관람평이 통째로 빠지므로,
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

    pruneMovieCache();

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
