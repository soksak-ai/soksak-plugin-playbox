# soksak-playbox — dev/build/verify. repo 폴더가 곧 ~/.soksak/plugins/ dev 폴더.
.PHONY: build watch typecheck test verify reload

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
