<?php
/*
 * 영화 상세정보 조회 (server.js 의 TMDB / OMDb / 네이버 부분 PHP 이식)
 *
 *   TMDB  - 포스터, 감독, 출연진, 줄거리, 개봉일, 러닝타임, 장르
 *   OMDb  - IMDb 평점, 전문가 평점(Metacritic / Rotten Tomatoes)
 *   네이버 - 실관람객·네티즌 평점, 관람평, 평론가 평점
 *
 * 함수 이름은 server.js 와 같게 두었다. 네이버가 바뀌어 server.js 를 고치면
 * 같은 이름의 함수를 여기서도 고치면 된다.
 *
 * fetch* 함수는 모두 제너레이터다. (lib/common.php 의 run_parallel 참고)
 */

if (!defined('CGV_APP')) {
    exit;
}

define('FORMAT_KEYWORDS',
    'IMAX|SCREENX|SCREEN X|4DX|SPHEREX|DOLBY ?CINEMA|ATMOS|CINE ?DE ?CHEF|' .
    'GOLD ?CLASS|TEMPUR ?CINEMA|PRIVATE ?BOX|SUITE ?CINEMA');

/*
 * JS 의 \b(...)\b 와 같은 뜻.
 *
 * PHP 는 /u 를 켜면 \b 가 한글도 "글자"로 취급해서, "IMAX듄" 처럼 한글에 붙은
 * 표기를 못 잡는다. JS 는 \b 를 영문·숫자 기준으로만 보므로 그에 맞춰 직접 쓴다.
 */
define('FORMAT_PATTERN',
    '/(?<![A-Za-z0-9_])(' . FORMAT_KEYWORDS . ')(?![A-Za-z0-9_])/iu');


/*
 * CGV 영화명에서 상영 포맷/버전 표기를 걷어낸다.
 *
 *   "스파이더맨-브랜드 뉴 데이(SCREENX 2D)" → "스파이더맨-브랜드 뉴 데이"
 *   "[IMAX](자막)듄: 파트2"                → "듄: 파트2"
 */
function cleanMovieTitle($rawTitle)
{
    $title = (string) $rawTitle;

    $title = preg_replace('/\[[^\]]*\]/u', ' ', $title);
    $title = preg_replace('/\([^)]*\)/u', ' ', $title);
    $title = preg_replace('/（[^）]*）/u', ' ', $title);
    $title = preg_replace('/〈[^〉]*〉/u', ' ', $title);

    $title = preg_replace(FORMAT_PATTERN, ' ', $title);

    $title = js_trim(preg_replace('/\s+/u', ' ', $title));

    return $title !== '' ? $title : js_trim($rawTitle);
}


/*
 * 괄호를 남긴 채 포맷 표기만 걷어낸 제목.
 * 제목 자체에 괄호가 들어가는 영화를 위한 예비 검색어다. 합치지 말 것.
 */
function cleanMovieTitleKeepParens($rawTitle)
{
    $title = preg_replace('/\[[^\]]*\]/u', ' ', (string) $rawTitle);
    $title = preg_replace(FORMAT_PATTERN, ' ', $title);

    return js_trim(preg_replace('/\s+/u', ' ', $title));
}


/*
 * 사람 이름이 한글 또는 영문(라틴) 표기인지.
 * 한자·가나 이름(예: 패왕별희 "葛优")은 영어 크레딧 표기로 바꾸기 위해 쓴다.
 * 비어 있으면 판단 대상이 아니므로 true.
 */
function isKoreanOrLatinName($value)
{
    $stripped = preg_replace('/[\s0-9\p{P}\p{S}]/u', '', (string) $value);

    if ($stripped === '' || $stripped === null) {
        return true;
    }

    return preg_match('/^[\p{Hangul}\p{Latin}]+$/u', $stripped) === 1;
}


/* ------------------------------------------------------------------
 * TMDB
 * ------------------------------------------------------------------ */

function searchTmdb($query)
{
    $config = app_config();

    $url =
        'https://api.themoviedb.org/3/search/movie' .
        '?query=' . rawurlencode($query) .
        '&language=ko-KR&include_adult=false' .
        '&api_key=' . $config['TMDB_API_KEY'];

    $response = yield http_request($url);

    if (!$response['ok']) {
        throw new Exception('TMDB 검색 실패 (HTTP ' . $response['status'] . ')');
    }

    $json = response_json($response);
    $results = get($json, 'results');

    return is_array($results) ? $results : array();
}


function fetchTmdb($title, $fallbackTitle)
{
    $config = app_config();
    $key = $config['TMDB_API_KEY'];

    if ($key === '') {
        return array('available' => false, 'reason' => 'TMDB_API_KEY가 설정되지 않았습니다.');
    }

    $results = yield from searchTmdb($title);

    // 괄호를 제거한 제목으로 못 찾으면 원래 제목으로 한 번 더
    if (!$results && $fallbackTitle && $fallbackTitle !== $title) {
        $results = yield from searchTmdb($fallbackTitle);
    }

    if (!$results) {
        return array('available' => false, 'reason' => 'TMDB에서 영화를 찾지 못했습니다.');
    }

    /*
     * 대표 항목 선정 — 인기도만 보면 "위키드" → "위키드: 포 굿" 처럼 속편이
     * 뽑히므로, 제목 완전 일치 > 검색어로 시작 > 그 외 순으로 고르고
     * 같은 순위 안에서 인기도를 본다.
     */
    $normalize = function ($value) {
        return preg_replace('/[\s:·・,.\-!?]/u', '', js_lower($value));
    };

    $target = $normalize($title);

    $rank = function ($item) use ($normalize, $target) {
        $itemTitle = $normalize(get($item, 'title'));

        if ($itemTitle === $target || $normalize(get($item, 'original_title')) === $target) {
            return 0;
        }
        if ($target === '' || strpos($itemTitle, $target) === 0) {
            return 1;
        }
        return 2;
    };

    // PHP 7 의 usort 는 안정 정렬이 아니어서 원래 순서를 마지막 기준으로 둔다
    $indexed = array();
    foreach ($results as $i => $item) {
        $indexed[] = array('i' => $i, 'item' => $item);
    }

    usort($indexed, function ($a, $b) use ($rank) {
        $diff = $rank($a['item']) - $rank($b['item']);
        if ($diff !== 0) {
            return $diff;
        }
        $pop = (float) js_or(get($b['item'], 'popularity'), 0) - (float) js_or(get($a['item'], 'popularity'), 0);
        if ($pop != 0) {
            return $pop > 0 ? 1 : -1;
        }
        return $a['i'] - $b['i'];
    });

    $best = $indexed[0]['item'];

    $response = yield http_request(
        'https://api.themoviedb.org/3/movie/' . rawurlencode((string) get($best, 'id')) .
        '?language=ko-KR&append_to_response=credits' .
        '&api_key=' . $key
    );

    if (!$response['ok']) {
        throw new Exception('TMDB 상세조회 실패 (HTTP ' . $response['status'] . ')');
    }

    $detail = response_json($response);
    $credits = js_or(get($detail, 'credits'), array());

    $directorList = array();
    foreach ((array) js_or(get($credits, 'crew'), array()) as $person) {
        if (get($person, 'job') === 'Director') {
            $directorList[] = $person;
        }
    }

    $castList = array_slice((array) js_or(get($credits, 'cast'), array()), 0, 10);

    /*
     * 한국어 크레딧에 한자·가나 이름이 남아 있으면 영어 크레딧으로 대체한다.
     * 필요할 때만 추가로 호출한다.
     */
    $needsEnglish = false;

    foreach (array_merge($directorList, $castList) as $person) {
        if (!isKoreanOrLatinName(get($person, 'name'))) {
            $needsEnglish = true;
        }
    }
    foreach ($castList as $person) {
        if (!isKoreanOrLatinName(get($person, 'character'))) {
            $needsEnglish = true;
        }
    }

    $englishCast = array();
    $englishCrew = array();

    if ($needsEnglish) {
        try {
            $english = yield http_request(
                'https://api.themoviedb.org/3/movie/' . rawurlencode((string) get($best, 'id')) .
                '/credits?language=en-US&api_key=' . $key
            );

            if ($english['ok']) {
                $englishCredits = response_json($english);

                foreach ((array) js_or(get($englishCredits, 'cast'), array()) as $person) {
                    $englishCast[(string) get($person, 'id')] = $person;
                }
                foreach ((array) js_or(get($englishCredits, 'crew'), array()) as $person) {
                    $englishCrew[(string) get($person, 'id')] = $person;
                }
            }
        } catch (Throwable $error) {
            // 영어 크레딧을 못 가져와도 한국어 값을 그대로 쓴다
        }
    }

    // 한글/영문이 아니면 영어 값으로. 영어 쪽도 아니면 원래 값 유지.
    $preferReadable = function ($value, $alternative) {
        if (isKoreanOrLatinName($value)) {
            return $value;
        }
        return (isKoreanOrLatinName($alternative) && js_or($alternative, false) !== false)
            ? $alternative
            : $value;
    };

    $directors = array();
    foreach ($directorList as $person) {
        $alt = get(get($englishCrew, (string) get($person, 'id')), 'name');
        $directors[] = $preferReadable(get($person, 'name'), $alt);
    }

    $cast = array();
    foreach ($castList as $person) {
        $english = js_or(get($englishCast, (string) get($person, 'id')), array());
        $profile = get($person, 'profile_path');

        $cast[] = array(
            'name'      => $preferReadable(get($person, 'name'), get($english, 'name')),
            'character' => $preferReadable(js_or(get($person, 'character'), ''), get($english, 'character')),
            'profile'   => $profile ? 'https://image.tmdb.org/t/p/w185' . $profile : null,
        );
    }

    $genres = array();
    foreach ((array) js_or(get($detail, 'genres'), array()) as $genre) {
        $genres[] = get($genre, 'name');
    }

    $poster = get($detail, 'poster_path');
    $backdrop = get($detail, 'backdrop_path');

    return array(
        'available'     => true,
        'tmdbId'        => get($detail, 'id'),
        'imdbId'        => js_or(get($detail, 'imdb_id'), null),
        'title'         => js_or(get($detail, 'title'), get($best, 'title')),
        'originalTitle' => js_or(get($detail, 'original_title'), ''),
        'tagline'       => js_or(get($detail, 'tagline'), ''),
        'overview'      => js_or(get($detail, 'overview'), ''),
        'releaseDate'   => js_or(get($detail, 'release_date'), ''),
        'runtime'       => js_or(get($detail, 'runtime'), null),
        'genres'        => $genres,
        'poster'        => $poster ? 'https://image.tmdb.org/t/p/w500' . $poster : null,
        'backdrop'      => $backdrop ? 'https://image.tmdb.org/t/p/w780' . $backdrop : null,
        'voteAverage'   => js_or(get($detail, 'vote_average'), null),
        'voteCount'     => js_or(get($detail, 'vote_count'), null),
        'directors'     => $directors,
        'cast'          => $cast,
    );
}


/* ------------------------------------------------------------------
 * OMDb — imdbId 가 있어야 정확히 매칭되므로 TMDB 결과를 입력으로 받는다
 * ------------------------------------------------------------------ */

function fetchOmdb($imdbId)
{
    $config = app_config();
    $key = $config['OMDB_API_KEY'];

    if ($key === '') {
        return array('available' => false, 'reason' => 'OMDB_API_KEY가 설정되지 않았습니다.');
    }

    if (!$imdbId) {
        return array('available' => false, 'reason' => 'IMDb ID를 찾지 못했습니다.');
    }

    $response = yield http_request(
        'https://www.omdbapi.com/?i=' . rawurlencode($imdbId) . '&apikey=' . $key
    );

    if (!$response['ok']) {
        throw new Exception('OMDb 호출 실패 (HTTP ' . $response['status'] . ')');
    }

    $json = response_json($response);

    if (get($json, 'Response') !== 'True') {
        return array(
            'available' => false,
            'reason'    => js_or(get($json, 'Error'), 'OMDb에서 정보를 찾지 못했습니다.'),
        );
    }

    $pick = function ($source) use ($json) {
        foreach ((array) js_or(get($json, 'Ratings'), array()) as $rating) {
            if (get($rating, 'Source') === $source) {
                return get($rating, 'Value');
            }
        }
        return null;
    };

    $notAvailable = function ($value) {
        return (!$value || $value === 'N/A') ? null : $value;
    };

    return array(
        'available'      => true,
        'imdbId'         => $imdbId,
        'imdbUrl'        => 'https://www.imdb.com/title/' . $imdbId . '/',
        'imdbRating'     => $notAvailable(get($json, 'imdbRating')),
        'imdbVotes'      => $notAvailable(get($json, 'imdbVotes')),
        'metascore'      => $notAvailable(get($json, 'Metascore')),
        'rottenTomatoes' => $notAvailable($pick('Rotten Tomatoes')),
        'rated'          => $notAvailable(get($json, 'Rated')),
        'awards'         => $notAvailable(get($json, 'Awards')),
    );
}


/* ------------------------------------------------------------------
 * 네이버 — 공식 API 없음. 자세한 구조는 CLAUDE.md "네이버 연동" 참고.
 *
 *   평점·평론가  api-gw.entertain.naver.com/csearch/contents/{contentId}
 *   관람평       proxy-gw.entertain.naver.com/movie/api/netizen-point-list (movieCode)
 * ------------------------------------------------------------------ */

define('NAVER_API_BASE', 'https://api-gw.entertain.naver.com/csearch/contents');
define('NAVER_POINT_API', 'https://proxy-gw.entertain.naver.com/movie/api');
define('NAVER_MOVIE_PKID', '68');
define('NAVER_REVIEW_COUNT', 5);


/*
 * 검색 HTML 한 번으로 contentId(평점용)와 movieCode(관람평용)를 같이 뽑는다.
 * 검색어에 "평점"을 붙여야 영화 패널이 뜨고 두 ID가 HTML에 들어간다.
 */
function fetchNaverIds($title)
{
    $searchUrl =
        'https://search.naver.com/search.naver?query=' .
        rawurlencode('영화 ' . $title . ' 평점');

    $response = yield http_request($searchUrl, array('Accept-Language' => 'ko-KR,ko;q=0.9'));

    if (!$response['ok']) {
        throw new Exception('네이버 조회 실패 (HTTP ' . $response['status'] . ')');
    }

    $html = $response['body'];

    $contentId = preg_match('/csearch\/contents\/(\d+)/', $html, $m) ? $m[1] : null;
    $movieCode = preg_match('/"movieCode":"?(\d+)"?/', $html, $m) ? $m[1] : null;

    return array('contentId' => $contentId, 'movieCode' => $movieCode, 'searchUrl' => $searchUrl);
}


/*
 * 관람평 목록. 실패해도 예외를 던지지 않고 빈 배열 — 평점까지 잃을 이유가 없다.
 */
function fetchNaverPointList($movieCode, $onlyActualPoint)
{
    $url = NAVER_POINT_API . '/netizen-point-list?' . http_build_query(array(
        'movieCode'       => (string) $movieCode,
        'onlyActualPoint' => $onlyActualPoint ? 'true' : 'false',
        'order'           => 'sympathyScore',     // 공감순. "newest" 면 최신순
        'includeSpoiler'  => 'false',
        'page'            => '1',
        'pageSize'        => (string) NAVER_REVIEW_COUNT,
    ));

    try {
        $response = yield http_request($url, array(
            'Accept'  => 'application/json',
            'Referer' => 'https://search.naver.com/',
        ));

        if (!$response['ok']) {
            return array();
        }

        $json = response_json($response);
    } catch (Throwable $error) {
        return array();
    }

    $resultCode = get($json, 'resultCode');

    if ($resultCode && $resultCode !== 'SUCCESS') {
        return array();
    }

    $reviews = array();

    foreach ((array) js_or(get($json, 'pointList'), array()) as $point) {
        $likes = get($point, 'sympathyCount');

        $reviews[] = array(
            'score'   => js_string(get($point, 'point')),
            'content' => js_trim(js_or(get($point, 'ment'), '')),
            'author'  => js_or(get($point, 'userMaskId'), ''),
            'date'    => js_or(get($point, 'date'), ''),
            'likes'   => (is_int($likes) || is_float($likes)) ? format_count($likes) : '',
        );
    }

    return $reviews;
}


/* 평론가 평점 목록: { reviewerName, writtenAt, rating, text } → { name, date, score, comment } */
function toCritics($ratingInfo)
{
    $items = get(get($ratingInfo, 'critic'), 'items');
    $critics = array();

    foreach ((array) $items as $item) {
        $written = (string) js_or(get($item, 'writtenAt'), '');

        // "20260731" → "2026.07.31"
        $date = preg_match('/^\d{8}$/', $written)
            ? substr($written, 0, 4) . '.' . substr($written, 4, 2) . '.' . substr($written, 6, 2)
            : $written;

        $critics[] = array(
            'name'    => js_or(get($item, 'reviewerName'), ''),
            'date'    => $date,
            'score'   => js_string(get($item, 'rating')),
            'comment' => js_trim(js_or(get($item, 'text'), '')),
        );
    }

    return $critics;
}


/*
 * 실관람객/네티즌 평점, 관람평, 평론가 평점.
 * audienceScore 는 실관람객 평점이고, 없으면 네티즌 평점으로 대체한다.
 * (어느 쪽인지는 audienceScoreType)
 */
function fetchNaver($title)
{
    $ids = yield from fetchNaverIds($title);

    $contentId = $ids['contentId'];
    $movieCode = $ids['movieCode'];

    if (!$contentId) {
        return array(
            'available' => false,
            'reason'    => '네이버에서 이 제목의 영화 정보를 찾지 못했습니다.',
        );
    }

    $response = yield http_request(
        NAVER_API_BASE . '/' . $contentId .
        '?modules=ent.movie.full.info,ent.movie.standalone.rating' .
        '&pkid=' . NAVER_MOVIE_PKID,
        array('Accept' => 'application/json', 'Referer' => 'https://search.naver.com/')
    );

    if (!$response['ok']) {
        throw new Exception('네이버 영화 API 실패 (HTTP ' . $response['status'] . ')');
    }

    $pool = js_or(get(js_or(get(response_json($response), 'result'), array()), 'dataPool'), array());

    $actual = null;
    $netizen = null;

    foreach ((array) get(get($pool, 'ratingBlock'), 'ratings') as $rating) {
        if ($actual === null && get($rating, 'type') === 'actual') {
            $actual = $rating;
        }
        if ($netizen === null && get($rating, 'type') === 'netizen') {
            $netizen = $rating;
        }
    }

    $critics = toCritics(get($pool, 'ratingInfo'));

    // 실관람객 관람평이 0건인 영화만 네티즌으로 한 번 더 본다
    $reviews = $movieCode ? (yield from fetchNaverPointList($movieCode, true)) : array();
    $reviewType = '실관람객';

    if (!$reviews && $movieCode) {
        $reviews = yield from fetchNaverPointList($movieCode, false);
        $reviewType = '네티즌';
    }

    $primary = $actual ? $actual : $netizen;

    if (!$primary && !$reviews && !$critics) {
        return array(
            'available' => false,
            'movieCode' => $contentId,
            'reason'    => '네이버에 이 영화의 평점이 아직 등록되지 않았습니다.',
        );
    }

    $criticAverage = null;

    if ($critics) {
        $sum = 0.0;
        foreach ($critics as $critic) {
            $sum += (float) $critic['score'];
        }
        $criticAverage = number_format($sum / count($critics), 2, '.', '');
    }

    return array(
        'available'           => true,
        'movieCode'           => $contentId,
        'audienceScore'       => $primary ? js_string(get($primary, 'score')) : null,
        'audienceScoreType'   => $actual ? '실관람객' : ($netizen ? '네티즌' : null),
        'participants'        => $primary ? format_count(get($primary, 'joinCount')) : null,
        'netizenScore'        => $netizen ? js_string(get($netizen, 'score')) : null,
        'netizenParticipants' => $netizen ? format_count(get($netizen, 'joinCount')) : null,
        'reviewType'          => $reviews ? $reviewType : null,
        'criticScore'         => $criticAverage,
        'criticCount'         => count($critics),
        'critics'             => $critics,
        'reviews'             => $reviews,
        'searchUrl'           => $ids['searchUrl'],
    );
}
