# source
# test

https://github.com/ 에서 웹호스팅 서비스를 무료로 쓰고 있는데, 여기에 다른 라이브러리 설치해서 하는 웹서비스도 올릴수 있어? 아님 단순 HTML만 되는건가?

GitHub Pages(github.io)는 정적(static) 호스팅만 지원합니다. 서버 사이드 코드는 실행할 수 없어요.

가능한 것

HTML, CSS, JavaScript (순수 정적 파일)
클라이언트 사이드에서 동작하는 JS 라이브러리 (React, Vue, jQuery 등) — 단, 빌드해서 정적 파일로 만든 결과물만 배포 가능
브라우저에서 fetch로 외부 API를 호출하는 것 (CORS 허용되는 API라면)
불가능한 것

Node.js, Python, PHP 등 서버 사이드 코드 실행
Express 같은 백엔드 프레임워크 구동
데이터베이스 연결이 필요한 서비스
npm install한 서버 라이브러리를 백엔드에서 돌리는 것
즉, 이성우님이 만들고 계신 CGV 스케줄러처럼 server.js + Express + /api/schedule 프록시 구조는 GitHub Pages에서는 그대로 못 돌아갑니다. 프록시 서버가 필요한 부분(CORS 우회, undici 통신 등)은 별도의 서버 호스팅이 필요해요.

대안으로는:

정적 프론트엔드만 GitHub Pages에 올리고, API 프록시 부분은 별도 서버리스 함수(Vercel, Netlify Functions, Cloudflare Workers, AWS Lambda 등)로 분리
아니면 통째로 백엔드 로직이 필요하면 Render, Railway, Fly.io 같은 무료/저가 서버 호스팅으로 이전
CGV 프로젝트 배포를 염두에 두신 거라면, 어떤 방식으로 나눌지 같이 정리해드릴까요?

https://github.com/dnrep00/source 여기에 내 소스파일들을 업로드 하고 싶은데 어떻게 해?


Fetched: dnrep00/source
Fetched: dnrep00/source
dnrep00/source 저장소는 확인해보니 **현재 비어있는 상태(empty repo)**네요. 아직 커밋이 하나도 없는 신규 저장소입니다.

업로드 방법은 크게 두 가지가 있어요.

방법 1: 웹 브라우저에서 직접 업로드 (가장 간단)
https://github.com/dnrep00/source 접속 (로그인 필요)
"uploading an existing file" 링크 클릭 (빈 저장소 화면에 보임)
파일 탐색기에서 소스 파일들을 드래그 앤 드롭
하단에 커밋 메시지 입력 후 "Commit changes" 클릭
장점: git 설치나 명령어 몰라도 됨
단점: 폴더 구조 통째로 드래그하면 안 되는 경우가 있고(브라우저·파일 수에 따라 다름), 대용량 파일이나 많은 파일 수에는 불편함
방법 2: Git 명령어로 업로드 (권장, 특히 계속 관리할 프로젝트라면)
로컬에 소스 파일이 있는 폴더에서:

bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/dnrep00/source.git
git push -u origin main
push 시 GitHub 로그인 인증을 요구하는데, 2021년부터 비밀번호 로그인은 막혀 있어서 **Personal Access Token(PAT)**을 비밀번호 대신 입력해야 합니다.

PAT 생성: GitHub 우측 상단 프로필 → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → repo 권한 체크 → 생성된 토큰 복사(한 번만 보여줌)

⚠️ 참고로, 삼성SDS 사내망 환경이시라 다음 두 가지가 걸림돌이 될 수 있어요:

MITM 프록시로 인한 git push 시 SSL 인증서 오류 가능성 → 이 경우 git config --global http.sslVerify false 또는 사내 루트 인증서를 git에 등록해야 함
사내망에서 github.com 자체가 방화벽에 막혀 있을 가능성 (사내 프록시 정책에 따라 다름)
혹시 지금 사내 PC/네트워크에서 작업하시는 건가요? 그렇다면 push 시도했을 때 에러 메시지를 보면서 프록시 설정을 같이 잡아드릴 수 있어요.






Claude는 AI이며 실수할 수 있습니다. 응답을 다시 한번 확인해 주세요.
