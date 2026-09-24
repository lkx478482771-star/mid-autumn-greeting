const blessingOrder = [0, 4, 1, 5, 2, 3];

const blessings = [
  "月饼别吃太多，想见的人要常见。中秋快乐。",
  "不能一起吃月饼，就先看同一个月亮吧。",
  "今晚记得抬头看。月亮替我祝你一切都好。",
  "祝你少一点忙乱，多一点团圆；有事做，有人念，也有所盼。",
  "如果路远，就先照顾好自己。平安到家，比什么都好。",
  "中秋快乐。饭要吃好，觉要睡好，想见的人要早点见。"
];

const blessingTrigger = document.querySelector("#blessingTrigger");
const moonTrigger = document.querySelector("#moonTrigger");
const blessingNote = document.querySelector(".blessing-note");
const blessingText = document.querySelector("#currentBlessing");
const soundToggle = document.querySelector("#soundToggle");
const soundIcons = document.querySelectorAll("[data-sound-icon]");
const shareButton = document.querySelector("#shareButton");
const toast = document.querySelector("#toast");
const blessingForm = document.querySelector("#blessingForm");
const blessingNameInput = document.querySelector("#blessingName");
const blessingMessageInput = document.querySelector("#blessingMessage");
const blessingCount = document.querySelector("#blessingCount");
const blessingSubmit = document.querySelector("#blessingSubmit");
const blessingFormStatus = document.querySelector("#blessingFormStatus");
const blessingConnection = document.querySelector("#blessingConnection");
const blessingList = document.querySelector("#blessingList");
const refreshBlessingsButton = document.querySelector("#refreshBlessings");
const sharedConfig = window.MID_AUTUMN_CONFIG || {};

let currentOrderIndex = 0;
let isChangingBlessing = false;
let audioEnabled = true;
let audioContext = null;
let toastTimer = null;
let visibleBlessings = [];
let blessingsLoading = false;

const LOCAL_BLESSINGS_KEY = "midAutumnBlessingsV1";
const LOCAL_VISITOR_KEY = "midAutumnVisitorV1";
const LOCAL_SUBMIT_KEY = "midAutumnLastSubmitV1";

function createUuid() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getVisitorId() {
  try {
    const existing = window.localStorage.getItem(LOCAL_VISITOR_KEY);
    if (existing) {
      return existing;
    }

    const generated = createUuid();
    window.localStorage.setItem(LOCAL_VISITOR_KEY, generated);
    return generated;
  } catch {
    return createUuid();
  }
}

function getLocalBlessings() {
  try {
    const raw = window.localStorage.getItem(LOCAL_BLESSINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalBlessing(entry) {
  try {
    const next = [entry, ...getLocalBlessings().filter((item) => item.id !== entry.id)].slice(0, 40);
    window.localStorage.setItem(LOCAL_BLESSINGS_KEY, JSON.stringify(next));
  } catch {
    // The submitted card is still shown for this page view if storage is unavailable.
  }
}

function mergeBlessings(...groups) {
  const unique = new Map();
  groups.flat().forEach((entry) => {
    if (entry?.id && entry?.message) {
      unique.set(entry.id, entry);
    }
  });
  return [...unique.values()].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
}

function formatBlessingDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60_000) {
    return "刚刚";
  }
  if (elapsed >= 0 && elapsed < 3_600_000) {
    return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前`;
  }

  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function createBlessingCard(entry) {
  const card = document.createElement("article");
  card.className = "blessing-card";

  const header = document.createElement("header");
  const name = document.createElement("strong");
  const time = document.createElement("time");
  const message = document.createElement("p");

  name.textContent = entry.nickname || "一位朋友";
  time.dateTime = entry.created_at;
  time.textContent = formatBlessingDate(entry.created_at);
  message.textContent = entry.message;

  header.append(name, time);
  card.append(header, message);
  return card;
}

function renderBlessings() {
  if (!blessingList) {
    return;
  }

  blessingList.replaceChildren();
  if (visibleBlessings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "blessing-empty";
    empty.textContent = "月亮下面还空着，你可以留下第一句话。";
    blessingList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleBlessings.slice(0, 40).forEach((entry) => {
    fragment.appendChild(createBlessingCard(entry));
  });
  blessingList.appendChild(fragment);
}

function setBlessingStatus(message, isError = false) {
  if (!blessingFormStatus) {
    return;
  }
  blessingFormStatus.textContent = message;
  blessingFormStatus.classList.toggle("is-error", isError);
}

function hasSupabaseBlessingConfig() {
  return Boolean(
    sharedConfig.supabaseUrl &&
      sharedConfig.supabaseAnonKey &&
      sharedConfig.blessingsTable
  );
}

function blessingHeaders(extra = {}) {
  return {
    apikey: sharedConfig.supabaseAnonKey,
    Authorization: `Bearer ${sharedConfig.supabaseAnonKey}`,
    Accept: "application/json",
    ...extra
  };
}

function createRequestTimeout(milliseconds) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), milliseconds);
  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timeout)
  };
}

async function readSharedBlessings() {
  const endpoint = new URL(
    `/rest/v1/${encodeURIComponent(sharedConfig.blessingsTable)}`,
    sharedConfig.supabaseUrl
  );
  endpoint.searchParams.set("select", "id,nickname,message,created_at");
  endpoint.searchParams.set("status", "eq.published");
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", "40");

  const request = createRequestTimeout(6_000);
  const response = await fetch(endpoint, {
    headers: blessingHeaders(),
    signal: request.signal
  }).finally(request.clear);
  if (!response.ok) {
    throw new Error(`Blessing read failed: ${response.status}`);
  }
  return response.json();
}

async function publishSharedBlessing(entry) {
  const endpoint = new URL(
    `/rest/v1/${encodeURIComponent(sharedConfig.blessingsTable)}`,
    sharedConfig.supabaseUrl
  );
  const request = createRequestTimeout(8_000);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: blessingHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(entry),
    signal: request.signal
  }).finally(request.clear);

  if (!response.ok) {
    throw new Error(`Blessing publish failed: ${response.status}`);
  }

  const rows = await response.json();
  return rows[0] || entry;
}

async function loadBlessings() {
  if (blessingsLoading || !blessingList) {
    return;
  }

  blessingsLoading = true;
  blessingConnection.textContent = "正在看看月亮下面有什么…";

  try {
    const remoteBlessings = hasSupabaseBlessingConfig()
      ? await readSharedBlessings()
      : [];
    visibleBlessings = mergeBlessings(remoteBlessings, getLocalBlessings());
    blessingConnection.textContent =
      remoteBlessings.length > 0
        ? "祝福来自所有打开这个页面的人"
        : "还没有人留言，第一句可以是你写的";
  } catch {
    visibleBlessings = mergeBlessings(getLocalBlessings());
    blessingConnection.textContent = "共享墙暂时没连上，先显示本机保存的祝福";
  } finally {
    blessingsLoading = false;
    renderBlessings();
  }
}

async function handleBlessingSubmit(event) {
  event.preventDefault();
  if (!blessingForm || !blessingMessageInput) {
    return;
  }

  const formData = new FormData(blessingForm);
  if (String(formData.get("website") || "").trim()) {
    blessingForm.reset();
    setBlessingStatus("祝福已经记下了。");
    return;
  }

  const nickname = String(formData.get("nickname") || "").trim() || "一位朋友";
  const message = String(formData.get("message") || "").trim();
  if (message.length < 2) {
    setBlessingStatus("再写一句吧，两个字也可以。", true);
    blessingMessageInput.focus();
    return;
  }

  try {
    const lastSubmit = Number(window.localStorage.getItem(LOCAL_SUBMIT_KEY) || 0);
    if (Date.now() - lastSubmit < 30_000) {
      setBlessingStatus("刚挂上去一句，等一会儿再写下一句吧。", true);
      return;
    }
  } catch {
    // Rate limiting is best-effort when storage is unavailable.
  }

  const localEntry = {
    id: createUuid(),
    nickname: nickname.slice(0, 20),
    message: message.slice(0, 160),
    visitor_id: getVisitorId(),
    status: "published",
    created_at: new Date().toISOString()
  };

  blessingSubmit?.setAttribute("disabled", "");
  const submitLabel = blessingSubmit?.querySelector("span");
  if (submitLabel) {
    submitLabel.textContent = "正在挂上去…";
  }
  setBlessingStatus("");

  try {
    let publishedEntry = localEntry;
    if (hasSupabaseBlessingConfig()) {
      publishedEntry = await publishSharedBlessing(localEntry);
      visibleBlessings = mergeBlessings([publishedEntry], visibleBlessings);
      blessingConnection.textContent = "祝福来自所有打开这个页面的人";
      setBlessingStatus("写好了，朋友的祝福墙已经多了一句。");
    } else {
      saveLocalBlessing(localEntry);
      visibleBlessings = mergeBlessings([localEntry], visibleBlessings);
      setBlessingStatus("这句话先保存在这台设备上。");
    }
    renderBlessings();
    blessingForm.reset();
    if (blessingCount) {
      blessingCount.textContent = "0 / 160";
    }
    try {
      window.localStorage.setItem(LOCAL_SUBMIT_KEY, String(Date.now()));
    } catch {
      // Ignore storage failures after a successful page interaction.
    }
  } catch {
    saveLocalBlessing(localEntry);
    visibleBlessings = mergeBlessings([localEntry], visibleBlessings);
    renderBlessings();
    blessingForm.reset();
    if (blessingCount) {
      blessingCount.textContent = "0 / 160";
    }
    setBlessingStatus("共享墙暂时没连上，这句话先保存在这台设备上。", true);
  } finally {
    blessingSubmit?.removeAttribute("disabled");
    if (submitLabel) {
      submitLabel.textContent = "挂上这句祝福";
    }
  }
}

function getAudioContext() {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  audioContext = new AudioContextClass();
  return audioContext;
}

function playChime() {
  if (!audioEnabled) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  if (context.state === "suspended") {
    context.resume();
  }

  const now = context.currentTime + 0.025;
  const notes = [
    { frequency: 523.25, delay: 0, length: 1.05, volume: 0.06 },
    { frequency: 659.25, delay: 0.18, length: 1.15, volume: 0.042 }
  ];

  notes.forEach(({ frequency, delay, length, volume }) => {
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const gain = context.createGain();
    const start = now + delay;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.997, start + length);

    overtone.type = "triangle";
    overtone.frequency.setValueAtTime(frequency * 2.01, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);

    oscillator.connect(gain);
    overtone.connect(gain);
    gain.connect(context.destination);

    oscillator.start(start);
    overtone.start(start);
    oscillator.stop(start + length + 0.04);
    overtone.stop(start + length + 0.04);
  });
}

function showToast(message) {
  if (!toast) {
    return;
  }

  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

function updateBlessing() {
  if (isChangingBlessing || !blessingNote || !blessingText) {
    return;
  }

  isChangingBlessing = true;
  blessingNote.classList.add("is-changing");
  moonTrigger?.classList.add("is-stamped");

  window.setTimeout(() => {
    currentOrderIndex = (currentOrderIndex + 1) % blessingOrder.length;
    blessingText.textContent = blessings[blessingOrder[currentOrderIndex]];
    blessingNote.classList.remove("is-changing");
  }, 160);

  window.setTimeout(() => {
    moonTrigger?.classList.remove("is-stamped");
  }, 520);

  window.setTimeout(() => {
    isChangingBlessing = false;
  }, 640);
}

function activateBlessing() {
  updateBlessing();
  playChime();
}

function setSoundState(enabled) {
  audioEnabled = enabled;
  if (!soundToggle) {
    return;
  }

  soundToggle.setAttribute("aria-pressed", String(enabled));
  soundToggle.setAttribute("aria-label", enabled ? "关闭音效" : "开启音效");
  soundToggle.title = enabled ? "关闭音效" : "开启音效";

  soundIcons.forEach((icon) => {
    const isOnIcon = icon.dataset.soundIcon === "on";
    icon.hidden = enabled ? !isOnIcon : isOnIcon;
  });
}

async function copyShareText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temporaryInput = document.createElement("textarea");
  temporaryInput.value = text;
  temporaryInput.setAttribute("readonly", "");
  temporaryInput.style.position = "fixed";
  temporaryInput.style.opacity = "0";
  document.body.appendChild(temporaryInput);
  temporaryInput.select();
  const successful = document.execCommand("copy");
  temporaryInput.remove();

  if (!successful) {
    throw new Error("Copy command was not available.");
  }
}

async function shareBlessing() {
  const text = `今晚月亮很好\n${blessingText?.textContent?.trim() || blessings[1]}`;
  const url = window.location.href;
  const shareData = {
    title: "今晚月亮很好",
    text,
    url
  };

  try {
    if (
      typeof navigator.share === "function" &&
      (!navigator.canShare || navigator.canShare(shareData))
    ) {
      await navigator.share(shareData);
      return;
    }

    await copyShareText(`${text}\n${url}`);
    showToast("祝福已复制，可以发给惦记的人");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    try {
      await copyShareText(`${text}\n${url}`);
      showToast("祝福已复制，可以发给惦记的人");
    } catch {
      showToast("暂时无法分享，请复制浏览器中的网址");
    }
  }
}

blessingTrigger?.addEventListener("click", activateBlessing);
moonTrigger?.addEventListener("click", activateBlessing);
shareButton?.addEventListener("click", shareBlessing);

soundToggle?.addEventListener("click", () => {
  const nextState = !audioEnabled;
  setSoundState(nextState);
  if (nextState) {
    playChime();
  }
});

blessingMessageInput?.addEventListener("input", () => {
  if (blessingCount) {
    blessingCount.textContent = `${blessingMessageInput.value.length} / 160`;
  }
});

blessingForm?.addEventListener("submit", handleBlessingSubmit);
refreshBlessingsButton?.addEventListener("click", loadBlessings);

window.addEventListener("pageshow", () => {
  setSoundState(audioEnabled);
});

loadBlessings();
