// content.js — 치지직 시청 페이지에 주입되어 비디오 상태를 1분마다 background로 전달
// 페이지 DOM은 read-only로만 접근. 어떤 입력도 자동화하지 않음 (정책 준수).

const PING_INTERVAL_MS = 60_000;

function getChannelIdFromUrl() {
  // URL 예시: https://chzzk.naver.com/live/{channelId}
  const m = location.pathname.match(/\/live\/([^\/\?]+)/);
  return m ? m[1] : null;
}

// 채널명 cache — 같은 채널 페이지에서 API 반복 호출 방지
let _channelNameCache = { channelId: null, name: null };

async function fetchChannelNameFromApi(channelId) {
  if (!channelId) return null;
  if (_channelNameCache.channelId === channelId && _channelNameCache.name) {
    return _channelNameCache.name;
  }
  try {
    const resp = await fetch(
      `https://api.chzzk.naver.com/service/v3/channels/${channelId}/live-detail`,
      { credentials: "omit" },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const name = data?.content?.channel?.channelName;
    if (name) {
      _channelNameCache = { channelId, name };
      return name;
    }
  } catch (e) {
    console.debug("[drops] channel-name api failed:", e);
  }
  return null;
}

async function getChannelName(channelId) {
  // 1. DOM에서 채널명 찾기 — 다양한 selector 시도 (SPA라 클래스가 hash임)
  const selectors = [
    '[class*="live_information_player_top"] [class*="name"]',
    '[class*="live_information"] [class*="name"]',
    '[class*="channel_layout"] [class*="name"]',
    '[class*="streamer"] [class*="name"]',
    'a[href^="/"][href*="/live/"]',
    'a[href^="/channel/"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = (el.textContent || "").trim();
      if (text && text.length > 0 && text.length < 40) return text;
    }
  }
  // 2. OG meta — "방송제목 - 채널명" 또는 "방송제목 :: 채널명" 패턴
  const og = document.querySelector('meta[property="og:title"]');
  if (og && og.content) {
    const parts = og.content.split(/\s*::\s*|\s+-\s+/);
    if (parts.length > 1) {
      const candidate = parts[parts.length - 1].trim();
      if (candidate && candidate.length < 40) return candidate;
    }
  }
  // 3. chzzk API 호출 — 가장 안정적 (채널ID 기반, cache)
  const apiName = await fetchChannelNameFromApi(channelId);
  if (apiName) return apiName;

  // 4. document.title fallback
  const title = (document.title || "").replace(/\s*-\s*(치지직|CHZZK)\s*$/i, "").trim();
  return title || null;
}

async function getWatchState() {
  const video = document.querySelector("video");
  const channelId = getChannelIdFromUrl();
  const channelName = await getChannelName(channelId);

  if (!video || !channelId) {
    return { channelId, channelName, isPlaying: false, isVisible: false };
  }

  return {
    channelId,
    channelName,
    isPlaying: !video.paused && !video.ended && video.readyState >= 2,
    isVisible: document.visibilityState === "visible",
    isFocused: document.hasFocus(),
    isMuted: !!video.muted,
    volume: typeof video.volume === "number" ? video.volume : 0,
    currentTime: video.currentTime || 0,
    timestamp: Date.now(),
  };
}

async function sendPing() {
  try {
    const state = await getWatchState();
    chrome.runtime.sendMessage({ type: "WATCH_STATE", state });
  } catch (e) {
    // 백그라운드 service worker가 죽었을 수 있음 — chrome이 자동 재기동
    console.debug("[drops] ping skipped:", e);
  }
}

// 즉시 1회 + 주기적 ping
sendPing();
const intervalId = setInterval(sendPing, PING_INTERVAL_MS);

// 비디오 상태 변경 즉시 반영 (paused/play 등)
function attachVideoListeners() {
  const video = document.querySelector("video");
  if (!video) return false;
  ["play", "pause", "ended", "volumechange"].forEach((ev) => {
    video.addEventListener(ev, sendPing);
  });
  return true;
}

// 비디오 요소가 늦게 로드되는 경우를 대비
if (!attachVideoListeners()) {
  const observer = new MutationObserver(() => {
    if (attachVideoListeners()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

document.addEventListener("visibilitychange", sendPing);
window.addEventListener("beforeunload", () => clearInterval(intervalId));
