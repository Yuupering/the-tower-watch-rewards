// 봇 서버 기본 URL — fork해서 사용하는 경우 본인 봇 서버 도메인으로 변경.
// (또는 popup의 "서버 주소" 입력란에 직접 입력하면 chrome.storage에 저장됨)
const DEFAULT_SERVER_URL = "";

const el = (id) => document.getElementById(id);

// 안전 헬퍼 — element가 없어도 깨지지 않게 모든 setter를 감싼다.
// popup.html 일부 노드가 없는 환경에서도 동작 보장.
function setText(id, text) {
  const e = el(id);
  if (e) e.textContent = text;
}
function setHTML(selectorOrId, html) {
  const e = selectorOrId.startsWith("#") || selectorOrId.startsWith(".")
    ? document.querySelector(selectorOrId)
    : el(selectorOrId);
  if (e) e.innerHTML = html;
}
function setStyle(id, prop, value) {
  const e = el(id);
  if (e) e.style[prop] = value;
}
function setClass(selectorOrId, cls, on) {
  const e = selectorOrId.startsWith("#") || selectorOrId.startsWith(".")
    ? document.querySelector(selectorOrId)
    : el(selectorOrId);
  if (e) e.classList.toggle(cls, on);
}
function setValue(id, val) {
  const e = el(id);
  if (e) e.value = val;
}

function fmtMinutes(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

async function loadConfig() {
  const data = await chrome.storage.local.get([
    "serverUrl",
    "token",
    "lastPingAt",
    "lastChannelId",
    "lastChannelName",
    "lastIsPlaying",
  ]);
  setValue("serverUrl", data.serverUrl || DEFAULT_SERVER_URL);
  setValue("token", data.token || "");

  const state = el("state");
  if (state) {
    if ((data.serverUrl || DEFAULT_SERVER_URL) && data.token) {
      state.textContent = "설정 완료";
      state.className = "value ok";
    } else {
      state.textContent = "미설정";
      state.className = "value bad";
    }
  }

  // 시청 채널 표기 — 채널명 우선, 없으면 channelId 일부, 둘 다 없으면 '-'
  if (data.lastChannelName) {
    const prefix = data.lastIsPlaying ? "🔴 " : "⚪ ";
    setText("watchChannel", prefix + data.lastChannelName);
  } else if (data.lastChannelId) {
    setText("watchChannel", data.lastChannelId.slice(0, 12) + "…");
  } else {
    setText("watchChannel", "-");
  }

  if (data.lastPingAt) {
    const sec = Math.floor((Date.now() - data.lastPingAt) / 1000);
    setText("lastPing", `${sec}초 전`);
  } else {
    setText("lastPing", "-");
  }

  return data;
}

async function fetchStatus() {
  const data = await chrome.storage.local.get(["serverUrl", "token"]);
  const serverUrl = (data.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, "");
  if (!data.token || !serverUrl) return null;
  try {
    const resp = await fetch(`${serverUrl}/drops/status`, {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.debug("[drops] status fetch failed:", e);
    return null;
  }
}

function renderInterpolated() {
  // baseline + 경과 초 = 현재 표시할 누적값.
  // is_active=false면 보간 정지 (baseline 그대로 표시).
  const base = _interpBase;
  if (base.fetchedAt === null) return;

  const elapsed = base.isActive
    ? Math.floor((Date.now() - base.fetchedAt) / 1000)
    : 0;

  const accSec = base.accSec + elapsed;
  const accPct = Math.min(100, (accSec / base.hMax) * 100);
  setText("hourlyPct", `${accPct.toFixed(1)}%`);
  setStyle("hourlyFill", "width", `${accPct}%`);
  setText("hourlyDetail", `${fmtMinutes(accSec)} / 60분`);

  const cycleSec = base.cycleSec + elapsed;
  const cyclePct = Math.min(100, (cycleSec / base.cMax) * 100);
  setText("cyclePct", `${cyclePct.toFixed(1)}%`);
  renderQuartered(cycleSec);
}

function renderQuartered(cycleSec) {
  const quarters = document.querySelectorAll("#cycleQuartered .quarter");
  const thresholds = [21600, 43200, 64800, 86400]; // 6h, 12h, 18h, 24h
  const prevs = [0, 21600, 43200, 64800];

  quarters.forEach((q, i) => {
    const start = prevs[i];
    const end = thresholds[i];
    q.classList.remove("partial", "complete");
    q.style.removeProperty("--fill");

    if (cycleSec >= end) {
      q.classList.add("complete");
    } else if (cycleSec > start) {
      // 부분 채움
      const pct = ((cycleSec - start) / (end - start)) * 100;
      q.classList.add("partial");
      q.style.setProperty("--fill", `${pct}%`);
    }
  });
}

// 보간용 baseline — 마지막 백엔드 응답 시각 + 그때 받은 값.
// 매 초 화면을 +1초씩 갱신해서 부드러운 UX 제공 (백엔드 부하 0).
let _interpBase = {
  accSec: 0, cycleSec: 0, hMax: 3600, cMax: 86400,
  isActive: false, fetchedAt: null,
};

function renderStatus(status) {
  if (!status) {
    _interpBase = { accSec: 0, cycleSec: 0, hMax: 3600, cMax: 86400,
                    isActive: false, fetchedAt: null };
    setText("nickname", "-");
    setText("hourlyPct", "0%");
    setStyle("hourlyFill", "width", "0%");
    setText("hourlyDetail", "0분 / 60분");
    setText("cyclePct", "0%");
    renderQuartered(0);
    setText("pendingRewards", "0개");
    setText("pendingMilestones", "0개");
    return;
  }

  setText("nickname", status.nickname || "-");

  // 다중 활성 채널 표시 — 서버가 active_channels 목록을 주면 모두 표시
  const activeChannels = Array.isArray(status.active_channels)
    ? status.active_channels : [];
  if (activeChannels.length > 0) {
    const names = activeChannels.map(c => "🔴 " + (c.label || c.channel_id.slice(0, 8)));
    let display = names.join(", ");
    if (activeChannels.length > 1) {
      display = `${names.length}채널 · ${display}`;
    }
    setText("watchChannel", display);
  }

  const now = Date.now();
  const newAcc = status.accumulated_seconds || 0;
  const newCycle = status.cycle_seconds || 0;
  const newIsActive = !!status.is_active;

  // 서버-클라이언트 시계 차이 보정
  const serverTime = (status.server_time || Math.floor(now / 1000)) * 1000;
  const clockSkew = now - serverTime;
  const lastTickAt = (status.last_accumulated_at || 0) * 1000;

  let baselineAcc = newAcc;
  let baselineCycle = newCycle;
  let baselineFetchedAt;

  if (lastTickAt > 0) {
    baselineFetchedAt = lastTickAt + clockSkew;
  } else {
    baselineFetchedAt = now;
    if (_interpBase.fetchedAt !== null) {
      const elapsedPrev = _interpBase.isActive
        ? Math.floor((now - _interpBase.fetchedAt) / 1000)
        : 0;
      const interpAcc = _interpBase.accSec + elapsedPrev;
      const interpCycle = _interpBase.cycleSec + elapsedPrev;
      if (newAcc < interpAcc) baselineAcc = interpAcc;
      if (newCycle < interpCycle) baselineCycle = interpCycle;
    }
  }

  _interpBase = {
    accSec: baselineAcc,
    cycleSec: baselineCycle,
    hMax: status.accumulated_max || 3600,
    cMax: status.cycle_max || 86400,
    isActive: newIsActive,
    fetchedAt: baselineFetchedAt,
  };
  if (typeof renderInterpolated === "function") {
    renderInterpolated();
  }

  const weeklyCount = status.weekly_hourly_count || 0;
  const weeklyMax = status.weekly_hourly_max || 24;
  setHTML("#weeklyLimit",
      `주간 한도: <span class="num">${weeklyCount}</span> / ${weeklyMax}`);
  setClass("#weeklyLimit", "over", weeklyCount >= weeklyMax);

  const monthlyCount = status.monthly_cycle_count || 0;
  const monthlyMax = status.monthly_cycle_max || 4;
  setHTML("#monthlyLimit",
      `월간 사이클: <span class="num">${monthlyCount}</span> / ${monthlyMax}`);
  setClass("#monthlyLimit", "over", monthlyCount >= monthlyMax);

  setText("pendingRewards", `${status.pending_rewards}개`);
  setText("pendingMilestones", `${status.pending_milestones}개`);
}

el("save").addEventListener("click", async () => {
  const serverUrl = el("serverUrl").value.trim().replace(/\/+$/, "");
  const token = el("token").value.trim();
  if (!serverUrl || !token) {
    alert("서버 주소와 인증 코드를 모두 입력해주세요.");
    return;
  }
  await chrome.storage.local.set({ serverUrl, token });
  await refreshAll();
  alert("저장되었습니다. 치지직 시청 페이지를 새로고침해주세요.");
});

async function refreshAll() {
  await loadConfig();
  const status = await fetchStatus();
  renderStatus(status);
}

refreshAll();
// 백엔드 fetch는 5초마다 — 한도/대기보상 등 baseline 갱신용
setInterval(refreshAll, 5000);
// 화면 누적은 1초마다 — JS 보간으로 매 초 카운트 올라감 (서버 부하 0)
if (typeof renderInterpolated === "function") {
  setInterval(renderInterpolated, 1000);
}
