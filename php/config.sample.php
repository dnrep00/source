<?php
/*
 * API 키 견본.
 *
 * 이 파일을 config.php 로 복사하고 키를 채운다.
 * (npm run build:php 를 실행하면 .env 의 키로 config.php 를 자동으로 만든다)
 *
 *   TMDB: https://www.themoviedb.org/settings/api  (API Key, v3)
 *   OMDb: https://www.omdbapi.com/apikey.aspx      (무료는 하루 1,000건, 비상업용)
 *
 * 브라우저로 이 파일을 직접 열어도 PHP로 실행될 뿐 아무것도 출력되지 않는다.
 */
return array(
    'TMDB_API_KEY' => '',
    'OMDB_API_KEY' => '',
);
