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

  // 시청 채널 표기 — 최근 ping이 stale하면 잔재 무시 ("이 채널 간 적 없는데"
  // 같은 현상 방지). 5분 이상 ping 없으면 storage값 의미 없다고 판단.
  const STALE_MS = 5 * 60 * 1000;
  const isStale = !data.lastPingAt
    || (Date.now() - data.lastPingAt) > STALE_MS;
  if (!isStale && data.lastChannelName) {
    const prefix = data.lastIsPlaying ? "🔴 " : "⚪ ";
    setText("watchChannel", prefix + data.lastChannelName);
  } else if (!isStale && data.lastChannelId) {
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

  // 스트리머 누적도 보간 — 방송 중일 때만 (streamerActive). 시청자와 별개 카운터.
  if (base.isStreamer) {
    const sElapsed = base.streamerActive
      ? Math.floor((Date.now() - base.streamerFetchedAt) / 1000)
      : 0;

    const sAcc = base.streamerAccSec + sElapsed;
    const sAccPct = Math.min(100, (sAcc / base.streamerHMax) * 100);
    setText("streamerHourlyPct", `${sAccPct.toFixed(1)}%`);
    setStyle("streamerHourlyFill", "width", `${sAccPct}%`);
    setText("streamerHourlyDetail", `${fmtMinutes(sAcc)} / 60분`);

    const sCycle = base.streamerCycleSec + sElapsed;
    const sCyclePct = Math.min(100, (sCycle / base.streamerMilestoneSec) * 100);
    setText("streamerCyclePct", `${sCyclePct.toFixed(1)}%`);
    setStyle("streamerCycleFill", "width", `${sCyclePct}%`);
    const sCycleHours = Math.floor(sCycle / 3600);
    const sCycleMins = Math.floor((sCycle % 3600) / 60);
    setText("streamerCycleDetail", `${sCycleHours}시간 ${sCycleMins}분 / 6시간`);

    // 총 방송 시간 — 백엔드에서 받은 total_seconds 그대로 (보간 미적용)
    const total = base.streamerTotalSec;
    const totalH = Math.floor(total / 3600);
    const totalM = Math.floor((total % 3600) / 60);
    setText("streamerTotal", `${totalH}시간 ${totalM}분`);
  }
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
  // 스트리머 누적용 (별도 카운터)
  isStreamer: false,
  streamerAccSec: 0, streamerCycleSec: 0, streamerTotalSec: 0,
  streamerHMax: 3600, streamerMilestoneSec: 21600,
  streamerActive: false, streamerFetchedAt: null,
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
  // (기존 lastChannelName은 단일 채널만 보여줘서 다중 시청 시 갱신 깜빡임)
  const activeChannels = Array.isArray(status.active_channels)
    ? status.active_channels : [];
  if (activeChannels.length > 0) {
    const names = activeChannels.map(c => "🔴 " + (c.label || c.channel_id.slice(0, 8)));
    let display = names.join(", ");
    if (activeChannels.length > 1) {
      display = `${names.length}채널 · ${display}`;
    }
    setText("watchChannel", display);
  } else {
    // 백엔드가 활성 채널 없다고 명시 — storage 잔재 무시하고 휴면으로 표시
    setText("watchChannel", "-");
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
    // 서버가 마지막 누적 시각을 알려준 경우 — 분 안에서 정확한 위치부터 보간.
    // 예: 백엔드 누적 7분(420s) + 마지막 tick 25초 전 → 표시 "7분 25초"
    baselineFetchedAt = lastTickAt + clockSkew;
  } else {
    // fallback (last_accumulated_at 컬럼 없거나 아직 한 번도 안 누적된 상태):
    // baseline을 now로 두면 elapsed=0이라 카운트 안 올라가는 문제 발생.
    // 이전 보간값을 그대로 유지해서 매 초 +1 흐름 보존.
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

  // 스트리머 데이터 baseline — 시청자와 같은 보간 패턴
  const isStreamer = !!status.is_streamer;
  const sBlock = document.getElementById("streamerBlock");
  if (sBlock) sBlock.style.display = isStreamer ? "block" : "none";

  let sBaselineFetchedAt = now;
  if (isStreamer) {
    const sLastTick = (status.streamer_last_accumulated_at || 0) * 1000;
    if (sLastTick > 0) {
      sBaselineFetchedAt = sLastTick + clockSkew;
    }
    // 스트리머 활성 판정 — 마지막 누적이 5분 이내면 방송 중으로 간주
    const sFresh = (now - sBaselineFetchedAt) < (5 * 60 * 1000);
    var streamerActive = sFresh;
  } else {
    var streamerActive = false;
  }

  _interpBase = {
    accSec: baselineAcc,
    cycleSec: baselineCycle,
    hMax: status.accumulated_max || 3600,
    cMax: status.cycle_max || 86400,
    isActive: newIsActive,
    fetchedAt: baselineFetchedAt,
    // 스트리머
    isStreamer: isStreamer,
    streamerAccSec: status.streamer_accumulated_seconds || 0,
    streamerCycleSec: status.streamer_cycle_seconds || 0,
    streamerTotalSec: status.streamer_total_seconds || 0,
    streamerHMax: status.accumulated_max || 3600,
    streamerMilestoneSec: status.streamer_milestone_seconds || 21600,
    streamerActive: streamerActive,
    streamerFetchedAt: sBaselineFetchedAt,
  };

  // 스트리머 한도 표시
  if (isStreamer) {
    const sWeekly = status.streamer_weekly_count || 0;
    const sWeeklyMax = status.streamer_weekly_max || 24;
    setHTML("#streamerWeeklyLimit",
        `주간 한도: <span class="num">${sWeekly}</span> / ${sWeeklyMax}`);
    setClass("#streamerWeeklyLimit", "over", sWeekly >= sWeeklyMax);

    const sMonthly = status.streamer_monthly_count || 0;
    const sMonthlyMax = status.streamer_monthly_max || 12;
    setHTML("#streamerMonthlyLimit",
        `월간 한도: <span class="num">${sMonthly}</span> / ${sMonthlyMax}`);
    setClass("#streamerMonthlyLimit", "over", sMonthly >= sMonthlyMax);
  }

  // 보간 함수가 정의되어 있으면 호출 — 옛 popup.js와의 부분 호환성 방어
  if (typeof renderInterpolated === "function") {
    renderInterpolated();
  }

  // 한도 — innerHTML 갱신 한 번으로 통일 (이전엔 #weeklyCount/#monthlyCount를
  // textContent 갱신한 직후 #weeklyLimit/#monthlyLimit innerHTML 덮어써서
  // span 자체가 사라지는 버그 있었음 → null 참조 TypeError)
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
