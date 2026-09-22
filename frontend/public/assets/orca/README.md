# 32×32 오르카 업무 캐릭터

- `card-maker-01.png` … `04.png`: 책상에서 연필로 업무 카드를 만드는 4프레임.
- `mail-carrier-01.png` … `04.png`: 우편 모자·가방을 착용하고 편지를 건네는 4프레임.
- `*-sheet.png`: 각각 128×32인 가로 4프레임 시트. 다이얼로그에서는 32×32 영역을 4배/5배 정수 배율로 표시합니다.
- 12색 팔레트, 이진 알파, 픽셀 격자 기반 동작. 원본 3D 이미지의 회전/확대 애니메이션을 사용하지 않습니다.

생성 원화·프롬프트·픽셀 데이터·단독 리뷰: [`docs/orca-pixels`](../../../../docs/orca-pixels).
재생성: 저장소 루트에서 `node tools/build-orca-pixels.cjs` (기존 frontend 의존성 사용).

## 캐릭터 정체성 참고 자료

Original image: https://www.orcarouter.ai/orca-logo-classic.png

Source page: https://www.orcarouter.ai/

`orca.png`는 2026-09-22에 받은 수정하지 않은 원본 참고 이미지이며 현재 다이얼로그에서는 렌더링하지 않습니다. 새 장면은 내장 imagegen으로 생성한 뒤 원화를 보고 32×32 네이티브 격자에서 디테일과 동작을 정리했습니다. 모든 런타임 이미지는 로컬 에셋입니다.

SHA-256: `96ed7062ed766e27bb6002f2831d6b54ec87f2371d4c4ab3bab27823a0b0fb07`
