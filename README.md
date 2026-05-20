# The Tower 2 시청 보상 (Chrome Extension)

치지직(CHZZK) 방송 시청 시간을 측정해 마인크래프트 서버의 인게임 보상으로 연결해주는 크롬 확장 프로그램.

현재 버전: v1.0.1

## 기능

- 치지직 라이브 페이지에서 비디오 재생 상태를 1분 단위로 읽어 봇 서버로 ping
- 누적 시청 시간을 popup에서 실시간 표시 (매 초 보간)
- 24시간 사이클(6h / 12h / 18h / 24h) 진행률 시각화
- 주간 시간당 한도 / 월간 사이클 보상 한도 표기
- 다중 채널 시청 지원 (popup에 동시 활성 채널 모두 표시)
- 스트리머 본인 누적 시간 표시 (1시간 / 6시간 스트리밍 보상 진행률)
- Service worker idle/background tab throttling 대응 (chrome.alarms + 능동 트리거)

페이지 자동 조작은 일체 없음. 비디오 요소를 read-only로만 측정.

## 권한

| 권한 | 용도 |
|---|---|
| `storage` | 인증 코드와 서버 URL을 로컬에 저장 |
| `alarms` | Manifest V3 service worker keep-alive 알람 (1분 주기) |
| `tabs` | 알람으로 깨어났을 때 chzzk 라이브 탭에 ping 트리거 메시지 전송 |
| `https://chzzk.naver.com/*` | 시청 페이지에서 비디오 상태 측정 |
| `https://api.chzzk.naver.com/*` | 채널 이름 조회 (UI 표시용) |
| `https://your-bot-server.example.com/*` | 봇 서버로 ping/상태 조회 |

## 변경 이력

- v1.0.1: service worker idle + background tab throttle 대응 (tabs 권한 추가) / 스트리머 누적 표시 / 용어 정리 (마일스톤 → 사이클 보상 / 스트리밍 보상)
- v1.0.0: 초기 출시

## 설치 (개발자 모드)

1. 이 저장소를 clone 또는 ZIP 다운로드
2. `manifest.json`의 host_permissions에서 `https://your-bot-server.example.com/*` 부분을 본인 봇 서버 도메인으로 변경
3. `chrome://extensions` 접속 → 우측 상단 "개발자 모드" 켜기
4. "압축해제된 확장 프로그램 로드" → 이 폴더 선택
5. 팝업 열기 → "서버 주소"에 본인 봇 서버 URL, "인증 코드"에 봇이 발급한 토큰 입력 → 저장

## 백엔드 (별도)

이 확장앱은 단독으로 동작하지 않음. 다음 엔드포인트를 제공하는 봇 서버가 필요:

- `POST /drops/ping` — 시청 상태 보고 (60초마다)
- `GET /drops/status` — 사용자 현재 상태 조회

요청 형식과 응답 스키마는 `background.js` / `popup.js` 참고.

## 파일 구조

```
.
├─ manifest.json     # 확장앱 메타데이터, 권한
├─ background.js     # service worker, ping 전송
├─ content.js        # 치지직 라이브 페이지 주입, 비디오 상태 읽기
├─ popup.html        # 설정 + 상태 UI
├─ popup.js          # popup 로직, 보간 카운트
└─ icons/            # 16/48/128 PNG
```

## 라이선스

MIT. `LICENSE` 참조.

## Contact

- 작성자: Yuupe
- 치지직: 유페링
- 이메일: yuupe@naver.com
