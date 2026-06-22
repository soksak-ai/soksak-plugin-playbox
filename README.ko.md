# Playbox (플레이박스)

[soksak](https://github.com/soksak-ai) 비디오 라이브러리·플레이어 플러그인.

즐겨찾기와 시간 구간 클립을 하나의 필터 가능한 목록으로 모으고, 깔끔한 인앱
플레이어로 재생합니다.

## 재생 대상

- **YouTube** — `yt-dlp`로 해석해 실제 `<video>`로 재생(그래서 클립·다운로드도
  됨). YouTube는 서명·throttle된 스트림이라 전용 추출기가 필요합니다 — 웹뷰로는
  쓸 수 있는 URL을 가로채지 못해 `yt-dlp`가 맡습니다.
- **로컬 파일** — 드래그드롭 또는 파일 열기.
- **직접 미디어 URL** — `.mp4`, `.m3u8` 등.
- **임의 웹페이지** — 페이지를 WebKit 웹뷰로 로드해(`yt-dlp`가 못 뚫는
  Cloudflare/SNI 차단을 통과) **페이지가 요청하는 미디어**나 **임베드 iframe
  플레이어의 URL**에서 스트림을 가져옵니다(사이트별 코드 없음). 지원되는
  페이지는 `yt-dlp`를 먼저 시도합니다.

Referer/CORS로 보호된 HLS는 soksak 코어 미디어 프록시로 스트리밍합니다 — 필요한
헤더를 주입하고, 웹뷰가 cross-origin으로 못 가져오는 바이너리 세그먼트를 대신
전달합니다.

## 기능

- **라이브러리** — 즐겨찾기 + 클립을 한 필터 목록으로(우측 사이드바).
- **플레이어** — `<video>` + hls.js, 콘텐츠 탭으로 열림(soksak 분할로 여러 개 동시).
- **클립** — 재생 중 `[` / `]`로 시작·종료 구간 표시 → 라이브러리에 북마크로 저장.
- **다운로드** — 전체 영상 또는 표시한 구간을 로컬 `.mp4`로 저장. 해석된 스트림을
  코어 미디어 프록시로 받아 `ffmpeg`(`-c copy`)로 묶습니다 — 다운로드에 `yt-dlp`는
  개입하지 않습니다. YouTube와 프록시를 통과하는 모든 스트림에 동작합니다. iframe
  임베드(`yt-dlp`가 YouTube 해석에 실패한 경우)는 저장할 스트림이 없습니다. 폴더는
  설정에서 지정합니다.

## 설정

- **도메인 매핑** — 원본 호스트 → 미러 호스트 표. 입력 URL의 호스트를 해석 전에
  치환합니다. 기본 비어 있음.
- **추출 방식** — `숨김`(오프스크린, 기본) 또는 `탭`(페이지가 직접 재생 클릭을
  요구할 때 쓰는 보이는 브라우저 탭).
- **추출 대기(ms)** — 미디어 스트림 추출 시 최대 대기 시간.
- **다운로드 폴더** — 다운로드를 저장할 절대경로 폴더.

## 의존성

- **yt-dlp** — YouTube·페이지 해석에 필요(다운로드엔 불요). 내장하지 않습니다(자주
  바뀜) — 시스템에 설치하거나 `playbox.setup` 실행.
- **ffmpeg** — 다운로드(전체/구간 묶음)에 필요. 재생엔 불요.

설치 상태는 `playbox.doctor`로 확인합니다.

## 커맨드

모든 기능이 커맨드로 노출됩니다(`sok plugin.soksak-plugin-playbox.<name>` / MCP):
`favorite.add`, `favorite.remove`, `library.list`, `library.filter`, `resolve`,
`play`, `clip.add`, `clip.list`, `download`, `doctor`, `setup`, `ping`.

## 개발

```
make build      # 또는: node build.mjs   — esbuild → 단일 ESM main.js
make verify     # tsc --noEmit && vitest run && build
make e2e        # 구동 중인 dev 앱에 대한 라이브 소켓 E2E
```

repo 폴더가 곧 `~/.soksak/plugins/` 아래 dev 플러그인 폴더입니다. soksak에서
`plugin.reload`로 반영합니다.
