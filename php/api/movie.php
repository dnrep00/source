<?php
/*
 * GET api/movie.php?title=인터스텔라
 *
 * server.js 의 /api/movie 와 같다. TMDB 와 네이버를 동시에 조회하고,
 * 일부 소스가 실패해도 나머지는 그대로 응답한다.
 */

define('CGV_APP', true);
require __DIR__ . '/../lib/common.php';
require __DIR__ . '/../lib/movie.php';

// 네이버 재조회까지 겹치면 10초 타임아웃 호출이 여러 번 이어질 수 있다
@set_time_limit(60);

$rawTitle = isset($_GET['title']) ? (string) $_GET['title'] : '';

if (js_trim($rawTitle) === '') {
    send_json(array('error' => 'title 파라미터가 필요합니다.'), 400);
}

$length = function_exists('mb_strlen') ? mb_strlen($rawTitle, 'UTF-8') : strlen($rawTitle);

if ($length > 200) {
    send_json(array('error' => 'title이 너무 깁니다.'), 400);
}

$title = cleanMovieTitle($rawTitle);
$fallbackTitle = cleanMovieTitleKeepParens($rawTitle);
$cacheKey = js_lower($title);

$cached = cache_get($cacheKey);

if (is_array($cached)) {
    $cached['cached'] = true;
    send_json($cached);
}

try {

    $first = run_parallel(array(
        'tmdb'  => fetchTmdb($title, $fallbackTitle),
        'naver' => fetchNaver($title),
    ));

    $tmdb = $first['tmdb'];
    $naver = $first['naver'];

    /*
     * CGV 영화명과 네이버 표기가 달라 영화 패널을 못 찾는 경우,
     * TMDB 가 찾아낸 정식 제목으로 한 번 더 조회한다.
     *   CGV "스파이더맨-브랜드 뉴 데이" ↔ 네이버 "스파이더맨: 브랜드 뉴 데이"
     */
    if (get($tmdb, 'available') && get($tmdb, 'title') &&
        !get($naver, 'movieCode') &&
        js_lower(js_trim($tmdb['title'])) !== js_lower(js_trim($title))) {

        $retry = run_one(fetchNaver($tmdb['title']));

        if (get($retry, 'movieCode')) {
            $retry['retriedWith'] = $tmdb['title'];
            $naver = $retry;
        }
    }

    $omdb = run_one(fetchOmdb(get($tmdb, 'available') ? get($tmdb, 'imdbId') : null));

    $payload = array(
        'query' => array('raw' => $rawTitle, 'cleaned' => $title),
        'tmdb'  => $tmdb,
        'omdb'  => $omdb,
        'naver' => $naver,
    );

    // 네이버 영화 패널까지 정상적으로 찾은 경우에만 오래 캐시한다
    $complete = get($tmdb, 'available') && get($naver, 'available') && get($naver, 'movieCode');

    cache_set($cacheKey, $payload, $complete ? MOVIE_CACHE_TTL : PARTIAL_CACHE_TTL);

    send_json($payload);

} catch (Throwable $error) {

    send_json(array('error' => '영화 정보 조회에 실패했습니다: ' . $error->getMessage()), 502);

}
