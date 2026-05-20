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

// content script가 비활성 탭에서 setInterval이 throttled 될 수 있어 보조로 alarms도 사용.
// MV3 service worker는 idle 시 자동 종료되는데, chrome.alarms는 종료된 worker도
// 깨워줌. 깨어난 worker가 chrome.tabs.query로 모든 chzzk 라이브 탭에 FORCE_PING
// 메시지를 보내고, content.js가 그 시점의 video 상태로 즉시 ping을 보냄.
// → 사용자가 다른 탭에서 작업하더라도 1분 주기 ping이 끊기지 않음.
chrome.alarms.create("drops-heartbeat", { periodInMinutes: DEFAULT_INTERVAL_MIN });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "drops-heartbeat") return;
  try {
    const tabs = await chrome.tabs.query({ url: "https://chzzk.naver.com/live/*" });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "FORCE_PING" });
      } catch (e) {
        // content script 미주입된 탭은 무시 (페이지가 아직 load 중인 경우 등)
      }
    }
  } catch (e) {
    console.debug("[drops] heartbeat alarm failed:", e);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[drops] 확장앱 설치/업데이트 완료");
});
