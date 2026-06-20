# soksak-playbox — dev/build/verify. repo 폴더가 곧 ~/.soksak/plugins/ dev 폴더.
.PHONY: build watch typecheck test verify reload e2e

build:
	node build.mjs

watch:
	node build.mjs --watch

typecheck:
	npx tsc --noEmit

test:
	npx vitest run

# 커밋 게이트: 타입체크 + 테스트 + 번들.
verify: typecheck test build

reload:
	sok plugin.reload

# 라이브 E2E — dev 앱 구동 중일 때 명령 표면을 소켓으로 검증(비파괴·멱등). SOKSAK_SOCKET 미설정 시 dev 소켓 기본.
e2e:
	SOKSAK_SOCKET=$${SOKSAK_SOCKET:-$$HOME/.soksak/com.soksak.dev.sock} node scripts/e2e/playbox.mjs
