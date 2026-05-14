// background.js — service worker
// content script에서 받은 시청 상태를 우리 서버로 전송.

const DEFAULT_INTERVAL_MIN = 1;

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["serverUrl", "token"], (data) => {
      resolve({
        serverUrl: (data.serverUrl || "").replace(/\/+$/, ""),
        token: data.token || "",
      });
    });
  });
}

async function sendPing(state) {
  const { serverUrl, token } = await getConfig();
  if (!serverUrl || !token) return;

  try {
    const resp = await fetch(`${serverUrl}/drops/ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(state),
    });
    const result = await resp.json().catch(() => ({}));
    await chrome.storage.local.set({
      lastPingAt: Date.now(),
      lastPingResult: result,
      lastChannelId: state.channelId || null,
      lastChannelName: state.channelName || null,
      lastIsPlaying: !!state.isPlaying,
    });
  } catch (e) {
    console.debug("[drops] ping failed:", e);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "WATCH_STATE") {
    sendPing(msg.state);
  }
});

// content script가 비활성 탭에서 setInterval이 throttled 될 수 있어 보조로 alarms도 사용
chrome.alarms.create("drops-heartbeat", { periodInMinutes: DEFAULT_INTERVAL_MIN });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "drops-heartbeat") return;
  // 알람만으로는 비디오 상태를 알 수 없음 — content script가 살아있어야만 의미 있음.
  // 알람은 service worker keep-alive 용도.
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[drops] 확장앱 설치/업데이트 완료");
});
