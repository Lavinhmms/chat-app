const socket        = io();
const form          = document.getElementById("form");
const input         = document.getElementById("input");
const username      = document.getElementById("username");
const chat          = document.getElementById("chat");
const usersList     = document.getElementById("users");

/* ===================================
   LOGIN LOCK
=================================== */

const usernameInput = document.getElementById("username");

usernameInput.focus();

document.getElementById("input").disabled = true;
document.getElementById("emojiBtn").disabled = true;

document.querySelector("#form button[type='submit']").disabled = true;

function unlockApp() {
    const name = usernameInput.value.trim();

    if (!name) return;

    document.getElementById("input").disabled = false;
    document.getElementById("emojiBtn").disabled = false;

    document.querySelector("#form button[type='submit']").disabled = false;

    socket.emit("join", name);
}

usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        unlockApp();
        document.getElementById("input").focus();
    }
});

usernameInput.addEventListener("blur", () => {
    if (usernameInput.value.trim()) {
        unlockApp();
    }
});

const typingIndicator = document.getElementById("typingIndicator");
const emojiBtn      = document.getElementById("emojiBtn");
const emojiPicker   = document.getElementById("emojiPicker");
const exploreBtn    = document.getElementById("exploreBtn");
const videoPanel    = document.getElementById("videoPanel");
const videoInput    = document.getElementById("videoInput");
const loadVideoBtn  = document.getElementById("loadVideoBtn");
const videoStatus   = document.getElementById("videoStatus");
const searchResults = document.getElementById("searchResults");
const videoEmpty    = document.getElementById("videoEmpty");
const videoQueue    = document.getElementById("videoQueue");
const queueItems    = document.getElementById("queueItems");
const queueCount    = document.getElementById("queueCount");
const queueHeader   = document.getElementById("queueHeader");
const contentArea   = document.querySelector(".content-area");
const hamburger     = document.getElementById("hamburger");
const sidebar       = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");

// ── App height ────────────────────────────────────
function setAppHeight() {
    document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
}
window.addEventListener('resize', setAppHeight);
window.addEventListener('orientationchange', setAppHeight);
setAppHeight();

// ── Theme ─────────────────────────────────────────
document.body.classList.add("dark");
document.getElementById("themeToggle").addEventListener("click", () => {
    if (document.body.classList.contains("dark")) {
        document.body.classList.replace("dark", "light");
        document.getElementById("themeToggle").textContent = "◑";
    } else {
        document.body.classList.replace("light", "dark");
        document.getElementById("themeToggle").textContent = "◐";
    }
});

// ── Sidebar ───────────────────────────────────────
function openSidebar()  { sidebar.classList.add("open");    sidebarOverlay.classList.add("visible"); }
function closeSidebar() { sidebar.classList.remove("open"); sidebarOverlay.classList.remove("visible"); }
hamburger.addEventListener("click", () => sidebar.classList.contains("open") ? closeSidebar() : openSidebar());
sidebarOverlay.addEventListener("click", closeSidebar);

// ── Sound ─────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playNotification() {
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        osc.start(); osc.stop(audioCtx.currentTime + 0.3);
    } catch(e) {}
}

// ── Ringtone ──────────────────────────────────────
let ringOsc = null;
let ringGain = null;
let ringInterval = null;

function startRingtone() {
    stopRingtone();
    try {
        ringGain = audioCtx.createGain();
        ringGain.connect(audioCtx.destination);
        ringGain.gain.setValueAtTime(0, audioCtx.currentTime);

        ringOsc = audioCtx.createOscillator();
        ringOsc.type = 'sine';
        ringOsc.connect(ringGain);
        ringOsc.start();

        let tick = 0;
        ringInterval = setInterval(() => {
            tick++;
            const now = audioCtx.currentTime;
            const cycle = tick % 40;
            if (cycle < 20) {
                const freq = (cycle % 4 < 2) ? 440 : 480;
                ringOsc.frequency.setValueAtTime(freq, now);
                ringGain.gain.setValueAtTime(0.15, now);
            } else {
                ringGain.gain.setValueAtTime(0, now);
            }
        }, 100);
    } catch(e) {}
}

function stopRingtone() {
    if (ringInterval) {
        clearInterval(ringInterval);
        ringInterval = null;
    }
    if (ringOsc) {
        try { ringOsc.stop(); ringOsc.disconnect(); } catch(e) {}
        ringOsc = null;
    }
    if (ringGain) {
        try { ringGain.disconnect(); } catch(e) {}
        ringGain = null;
    }
}

// ── Chat ──────────────────────────────────────────
form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input.value.trim() || !username.value.trim()) return;
    socket.emit("chat message", { user: username.value, msg: input.value });
    input.value = "";
    socket.emit("stop typing");
    emojiPicker.classList.add("hidden");
});
function appendMessage(data, container) {
    const div = document.createElement("div");
    div.classList.add("message");
    if (data.user === username.value) div.classList.add("self");
    else if (container === chat) playNotification();
    div.innerHTML = "<strong>" + data.user + "</strong>" + data.msg;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}
socket.on("chat message", (data) => {
    appendMessage(data, chat);
    appendMessage(data, vchatMsgs);
});

// ── Typing ────────────────────────────────────────
let typingTimeout;
input.addEventListener("input", () => {
    if (!username.value) return;
    socket.emit("typing", username.value);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stop typing"), 1500);
});
socket.on("typing",      (u) => { typingIndicator.textContent = u + " is typing..."; document.getElementById("vchatTyping").textContent = u + " is typing..."; });
socket.on("stop typing", ()  => { typingIndicator.textContent = ""; document.getElementById("vchatTyping").textContent = ""; });

// ── Users ─────────────────────────────────────────
socket.on("users", (users) => {
    if (!usersList) return;
    usersList.innerHTML = "";
    users.forEach(u => {
        const li = document.createElement("li");
        li.textContent = "🟢 " + u;
        usersList.appendChild(li);
    });
});

// ── Emoji ─────────────────────────────────────────
const emojis = ["😀","😂","😍","😎","😭","😡","🥺","😏","🤔","😴",
                 "👍","👎","👏","🙌","🤝","🙏","💪","✌️","👋","🤞",
                 "❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","💯",
                 "🔥","✨","🎉","🎊","💥","🌟","⭐","🌈","🍀","🎵",
                 "😈","👻","💀","🤖","👽","🐶","🐱","🦊","🐼","🦁",
                 "🍕","🍔","🍩","🍦","🎂","🍣","🍜","🍎","🍓","🍉"];
const grid = emojiPicker.querySelector(".emoji-grid");
const vgrid = document.querySelector("#vemojiPicker .emoji-grid");
emojis.forEach(emoji => {
    const span = document.createElement("span");
    span.textContent = emoji;
    span.addEventListener("click", () => { input.value += emoji; input.focus(); });
    grid.appendChild(span);
    const vspan = document.createElement("span");
    vspan.textContent = emoji;
    vspan.addEventListener("click", () => {
        const activeInput = document.activeElement;
        if (activeInput === vinput) { vinput.value += emoji; vinput.focus(); }
        else { input.value += emoji; input.focus(); }
    });
    vgrid.appendChild(vspan);
});
emojiBtn.addEventListener("click", (e) => { e.stopPropagation(); emojiPicker.classList.toggle("hidden"); });
document.addEventListener("click", (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) emojiPicker.classList.add("hidden");
    if (!document.getElementById("vemojiPicker").contains(e.target) && e.target !== vemojiBtn) document.getElementById("vemojiPicker").classList.add("hidden");
});

// ── YouTube Player ────────────────────────────────
let player           = null;
let playerReady      = false;
let pendingVideoId   = null;
let pendingSeekTime  = null;
let pendingPaused    = false;
let currentVideoId   = null;

// Remote action flags — suppress the immediate next state change caused by a remote action
let pendingRemotePlay = false;
let pendingRemotePause = false;
let remotePlayTimeout = null;
let remotePauseTimeout = null;

function setPendingRemotePlay() {
    pendingRemotePlay = true;
    clearTimeout(remotePlayTimeout);
    remotePlayTimeout = setTimeout(() => { pendingRemotePlay = false; }, 2000);
}
function setPendingRemotePause() {
    pendingRemotePause = true;
    clearTimeout(remotePauseTimeout);
    remotePauseTimeout = setTimeout(() => { pendingRemotePause = false; }, 2000);
}
let queueList       = [];

let syncInterval = null;
function startSyncInterval() {
    if (syncInterval) return;
    syncInterval = setInterval(() => {
        if (player && playerReady && player.getPlayerState() === YT.PlayerState.PLAYING) {
            socket.emit("video:sync", player.getCurrentTime());
        }
    }, 10000);
}
function stopSyncInterval() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
}

window.onYouTubeIframeAPIReady = function() {
    player = new YT.Player("ytPlayer", {
        height: "100%",
        width: "100%",
        videoId: "",
        playerVars: {
            autoplay: 1,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin
        },
        events: {
            onReady: () => {
                playerReady = true;
                if (pendingVideoId) {
                    const vid = pendingVideoId;
                    const seekTo = pendingSeekTime;
                    const paused = pendingPaused;
                    pendingVideoId  = null;
                    pendingSeekTime = null;
                    pendingPaused   = false;
                    setPendingRemotePlay();
                    player.loadVideoById({ videoId: vid, startSeconds: seekTo || 0 });
                    if (paused) setTimeout(() => {
                        if (player) { setPendingRemotePause(); player.pauseVideo(); }
                    }, 1500);
                }
            },
            onStateChange: (e) => {
                if (e.data === YT.PlayerState.ENDED) {
                    videoStatus.textContent = "⏭️ Loading next from queue...";
                    socket.emit("video:next-from-queue");
                    stopSyncInterval();
                    return;
                }
                if (e.data === YT.PlayerState.PLAYING && pendingRemotePlay) {
                    pendingRemotePlay = false;
                    return;
                }
                if (e.data === YT.PlayerState.PAUSED && pendingRemotePause) {
                    pendingRemotePause = false;
                    return;
                }
                if (document.hidden) return;
                const ct = player.getCurrentTime();
                clearTimeout(window._stateChangeTimer);
                window._stateChangeTimer = setTimeout(() => {
                    if (e.data === YT.PlayerState.PLAYING) {
                        socket.emit("video:play", ct);
                        startSyncInterval();
                    }
                    if (e.data === YT.PlayerState.PAUSED) {
                        socket.emit("video:pause", ct);
                        stopSyncInterval();
                    }
                }, 200);
            },
            onError: (e) => {
                if (e.data === 101 || e.data === 150) showBlockedMessage(currentVideoId);
            }
        }
    });
};

// ── Core: open panel THEN load video ─────────────
function playVideoById(videoId, seekTime, paused) {
    currentVideoId = videoId;
    videoEmpty.classList.add("hidden");
    hideBlockedMessage();

    if (playerReady && player) {
        setPendingRemotePlay();
        stopSyncInterval();
        player.loadVideoById({ videoId: videoId, startSeconds: seekTime || 0 });
        if (paused) {
            setTimeout(() => {
                if (player) {
                    setPendingRemotePause();
                    player.pauseVideo();
                }
            }, 500);
        } else {
            startSyncInterval();
        }
    } else {
        pendingVideoId  = videoId;
        pendingSeekTime = seekTime || 0;
        pendingPaused   = paused || false;
    }
}

// ── Blocked message ───────────────────────────────
function showBlockedMessage(videoId) {
    hideBlockedMessage();
    const msg = document.createElement("div");
    msg.id = "blockedMsg";
    msg.style.cssText = "position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#000;padding:24px;text-align:center;";
    msg.innerHTML =
        "<div style='font-size:44px'>🚫</div>" +
        "<div style='color:white;font-size:16px;font-weight:bold'>This video can't be embedded</div>" +
        "<div style='color:rgba(255,255,255,0.5);font-size:12px;line-height:1.7;max-width:280px'>The video owner disabled external playback. Try a different video.</div>" +
        "<a href='https://www.youtube.com/watch?v=" + (videoId||"") + "' target='_blank' style='padding:12px 28px;background:#ff0000;color:white;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold'>▶ Open on YouTube</a>" +
        "<div style='color:rgba(255,255,255,0.3);font-size:11px'>Tip: search for a lyrics or cover version</div>";
    const wrapper = document.querySelector(".video-wrapper");
    if (wrapper) wrapper.appendChild(msg);
    videoStatus.textContent = "⚠️ Blocked — try another video";
}
function hideBlockedMessage() {
    const el = document.getElementById("blockedMsg");
    if (el) el.remove();
}

// ── Extract YouTube ID ────────────────────────────
function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
        /youtube\.com\/shorts\/([^&\n?#]+)/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

// ── Open video panel ──────────────────────────────
function openVideoPanel() {
    videoPanel.classList.remove("hidden");
    contentArea.classList.add("video-open");
    // Hide separate call panel — call is in video panel's call tab
    if (inCall) callPanel.classList.add("hidden");
}
function closeVideoPanel() {
    videoPanel.classList.add("hidden");
    contentArea.classList.remove("video-open");
    searchResults.classList.add("hidden");
    hideBlockedMessage();
    // Restore separate call panel if in call
    if (inCall) callPanel.classList.remove("hidden");
}

// ── Load video (by this user) ─────────────────────
function loadVideo(videoId, title) {
    searchResults.classList.add("hidden");
    videoInput.value = "";
    openVideoPanel();                    // open panel FIRST

    // If a video is already loaded, add to queue instead
    if (currentVideoId !== null) {
        addToQueue(videoId, title);
        setTimeout(() => videoInput.focus(), 300);
        return;
    }

    playVideoById(videoId, 0, false);    // then load video
    videoStatus.textContent = title ? ("🎬 " + title) : "🎬 Watching together!";
    socket.emit("video:load", videoId);
    setTimeout(() => videoInput.focus(), 300);
}

// ── Queue functions ──────────────────────────────
function addToQueue(videoId, title) {
    if (queueList.length >= 6) return;
    const item = { videoId, title: title || "Untitled", addedBy: username.value };
    queueList.push(item);
    socket.emit("video:add-to-queue", item);
    videoStatus.textContent = "➕ Added to queue (" + queueList.length + "/6)";
}

function renderQueue() {
    videoQueue.classList.toggle("hidden", queueList.length === 0);
    queueItems.innerHTML = "";
    queueCount.textContent = queueList.length;
    queueList.forEach((item, i) => {
        const div = document.createElement("div");
        div.className = "queue-item";
        div.innerHTML =
            "<span class='queue-item-title'>" + (item.title || item.videoId) + "</span>" +
            "<button class='queue-item-remove' data-index='" + i + "'>✕</button>";
        div.querySelector(".queue-item-remove").addEventListener("click", (e) => {
            e.stopPropagation();
            queueList.splice(i, 1);
            socket.emit("video:remove-from-queue", i);
        });
        queueItems.appendChild(div);
    });
}

queueHeader.addEventListener("click", () => {
    videoQueue.classList.toggle("collapsed");
});

// ── Resizable video bottom ────────────────────────
const videoBottom   = document.getElementById("videoBottom");
const bottomResize  = document.getElementById("bottomResize");
let isResizing      = false;

bottomResize.addEventListener("mousedown", (e) => {
    isResizing = true;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
});

function onResize(e) {
    if (!isResizing) return;
    const panelRect = videoBottom.parentElement.getBoundingClientRect();
    const newHeight = panelRect.bottom - e.clientY;
    const clamped = Math.max(80, Math.min(newHeight, window.innerHeight * 0.6));
    videoBottom.style.height = clamped + "px";
}

function stopResize() {
    isResizing = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
}

// ── Search ────────────────────────────────────────
const INVIDIOUS = [
    "https://invidious.privacyredirect.com",
    "https://invidious.fdn.fr",
    "https://yt.cdaut.de",
    "https://invidious.nerdvpn.de",
    "https://invidious.io.lol"
];

async function searchYouTube(query) {
    searchResults.innerHTML = "<div style='padding:12px;color:rgba(255,255,255,0.5);font-size:13px;'>🔍 Searching...</div>";
    searchResults.classList.remove("hidden");
    const enc = encodeURIComponent(query);
    for (const inst of INVIDIOUS) {
        try {
            const res = await fetch(inst + "/api/v1/search?q=" + enc + "&type=video&page=1", { signal: AbortSignal.timeout(5000) });
            if (!res.ok) continue;
            const data = await res.json();
            if (data && data.length > 0) { renderResults(data.slice(0, 8)); return; }
        } catch(e) { continue; }
    }
    searchResults.innerHTML =
        "<div style='padding:14px;display:flex;flex-direction:column;gap:10px'>" +
        "<div style='color:rgba(255,255,255,0.5);font-size:13px'>Search unavailable right now.</div>" +
        "<a href='https://www.youtube.com/results?search_query=" + enc + "' target='_blank' style='color:#38bdf8;font-size:13px'>🔗 Search on YouTube → paste the link above</a>" +
        "</div>";
}

function renderResults(items) {
    searchResults.innerHTML = "";
    items.forEach(item => {
        const div = document.createElement("div");
        div.className = "search-item";
        const img = document.createElement("img");
        img.src = "https://i.ytimg.com/vi/" + item.videoId + "/mqdefault.jpg";
        img.onerror = function() { this.style.display = "none"; };
        const info = document.createElement("div");
        info.className = "search-item-info";
        info.innerHTML = "<div class='search-item-title'>" + (item.title||"Unknown") + "</div><div class='search-item-channel'>" + (item.author||"") + "</div>";
        div.appendChild(img); div.appendChild(info);
        div.addEventListener("click", () => loadVideo(item.videoId, item.title));
        searchResults.appendChild(div);
    });
}

loadVideoBtn.addEventListener("click", () => {
    const val = videoInput.value.trim();
    if (!val) return;
    const id = extractVideoId(val);
    if (id) loadVideo(id, "");
    else searchYouTube(val);
});
videoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loadVideoBtn.click(); });
const videoUrlBar = document.querySelector(".video-url-bar");
document.addEventListener("click", (e) => {
    if (!searchResults.contains(e.target) && !videoUrlBar.contains(e.target))
        searchResults.classList.add("hidden");
});

// ── Socket sync (received FROM other users) ───────

// Late joiner — get current room state
socket.on("room:state", (state) => {
    if (!state.videoId) return;
    openVideoPanel();                                      // open panel first
    playVideoById(state.videoId, state.time, !state.playing);
    videoStatus.textContent = "🎬 Synced with room!";
});

// Someone loaded a new video
socket.on("video:load", (videoId) => {
    openVideoPanel();                                      // open panel first
    playVideoById(videoId, 0, false);
    videoStatus.textContent = "🎬 Watching together!";
});

// Play / pause / seek sync
socket.on("video:play", (time) => {
    if (!player || !playerReady) return;
    setPendingRemotePlay();
    player.seekTo(time, true);
    player.playVideo();
});
socket.on("video:pause", (time) => {
    if (!player || !playerReady) return;
    setPendingRemotePause();
    player.seekTo(time, true);
    player.pauseVideo();
});
socket.on("video:seek", (time) => {
    if (!player || !playerReady) return;
    player.seekTo(time, true);
});

socket.on("video:sync", (time) => {
    if (!player || !playerReady) return;
    const drift = player.getCurrentTime() - time;
    if (Math.abs(drift) > 1.5) {
        player.seekTo(time, true);
    }
});

// ── Queue socket sync ────────────────────────────
socket.on("video:queue-update", (q) => {
    queueList = q;
    renderQueue();
});

socket.on("video:next-playing", (title) => {
    videoStatus.textContent = "▶️ " + title;
});

// ── Close video panel (top-right ✕) ─────────────


// ── Video bottom tabs ──────────────────────────────
// ── Video panel chat ───────────────────────────────
const vform = document.getElementById("vform");
const vinput = document.getElementById("vinput");
const vchatMsgs = document.getElementById("vchatMsgs");
const vemojiBtn = document.getElementById("vemojiBtn");

vform.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!vinput.value.trim() || !username.value.trim()) return;
    socket.emit("chat message", { user: username.value, msg: vinput.value });
    vinput.value = "";
    socket.emit("stop typing");
});

vinput.addEventListener("input", () => {
    if (!username.value) return;
    socket.emit("typing", username.value);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stop typing"), 1500);
});

const vemojiPicker = document.getElementById("vemojiPicker");
vemojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    vemojiPicker.classList.toggle("hidden");
});

// ════════════════════════════════════════════════════
// GROUP VIDEO CALL — WebRTC Mesh + Picture-in-Picture
// ════════════════════════════════════════════════════

const callPanel       = document.getElementById("callPanel");
const callVideos      = document.getElementById("callVideos");
const callPipRow      = document.getElementById("callPipRow");
const endCallBtn      = document.getElementById("endCallBtn");
const joinCallBtn     = document.getElementById("joinCallBtn");
const toggleMicBtn    = document.getElementById("toggleMicBtn");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");
const callCount       = document.getElementById("callCount");
const callPanelHeader = document.getElementById("callPanelHeader");
const appEl           = document.querySelector(".app");
let   callExpanded    = false;
let   isCalling       = false;
let   incomingCallFrom = null;
let   callRingTimeout  = null;

// Incoming call overlay DOM refs
const incomingCallOverlay = document.getElementById("incomingCallOverlay");
const incomingCallAvatar  = document.getElementById("incomingCallAvatar");
const incomingCallName    = document.getElementById("incomingCallName");
const incomingCallStatus  = document.getElementById("incomingCallStatus");
const acceptCallBtn       = document.getElementById("acceptCallBtn");
const declineCallBtn      = document.getElementById("declineCallBtn");

// WebRTC config — using free public STUN servers
const RTC_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
    ]
};

let localStream    = null;   // my camera/mic stream
let peers          = {};     // socketId -> RTCPeerConnection
let inCall         = false;
let micEnabled     = true;
let cameraEnabled  = true;

// ── Top menu dropdown toggle ─────────────────────
const topMenuBtn      = document.getElementById("topMenuBtn");
const topMenuDropdown = document.getElementById("topMenuDropdown");

topMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    topMenuDropdown.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
    if (!topMenuDropdown.contains(e.target) && e.target !== topMenuBtn)
        topMenuDropdown.classList.add("hidden");
});

// ── Toggle call panel ─────────────────────────────
const callBtn = document.getElementById("callBtn");
callBtn.addEventListener("click", () => {
    topMenuDropdown.classList.add("hidden");
    if (callPanel.classList.contains("hidden")) {
        callPanel.classList.remove("hidden");
        callPanel.classList.add("expanded");
        callExpanded = true;
        isMinimized = false;
        isMaximized = false;
    } else {
        if (isCalling) cancelCall();
        if (inCall) leaveCall();
        callPanel.classList.add("hidden");
        callPanel.classList.remove("expanded", "minimized", "maximized");
        callExpanded = false;
        isMinimized = false;
        isMaximized = false;
    }
});

function startCalling() {
    isCalling = true;
    joinCallBtn.textContent = "🔔 Ringing...";
    joinCallBtn.classList.add("active");
    socket.emit("call:ring", { username: username.value });
    callRingTimeout = setTimeout(() => {
        if (isCalling) cancelCall();
    }, 30000);
}

function cancelCall() {
    isCalling = false;
    if (callRingTimeout) { clearTimeout(callRingTimeout); callRingTimeout = null; }
    socket.emit("call:cancel");
    joinCallBtn.textContent = "📹 Call";
    joinCallBtn.classList.remove("active");
}

// ── Panel toggle ──────────────────────────────────
exploreBtn.addEventListener("click", () => {
    topMenuDropdown.classList.add("hidden");
    videoPanel.classList.contains("hidden") ? openVideoPanel() : closeVideoPanel();
});

// ── Accept / Decline incoming call ────────────────
acceptCallBtn.addEventListener("click", () => {
    if (!incomingCallFrom) return;
    stopRingtone();
    incomingCallOverlay.classList.add("hidden");
    socket.emit("call:accept", { to: incomingCallFrom });
    incomingCallFrom = null;
    callPanel.classList.remove("hidden");
    callPanel.classList.add("expanded");
    callExpanded = true;
    if (!inCall) joinCall();
});

declineCallBtn.addEventListener("click", () => {
    if (!incomingCallFrom) return;
    stopRingtone();
    incomingCallOverlay.classList.add("hidden");
    socket.emit("call:reject", { to: incomingCallFrom });
    incomingCallFrom = null;
});

// ── Window control buttons ────────────────────────
const minimizeCallBtn = document.getElementById("minimizeCallBtn");
const maximizeCallBtn = document.getElementById("maximizeCallBtn");
const closeCallBtn    = document.getElementById("closeCallBtn");

let isMinimized = false;
let isMaximized = false;
// Store pre-maximize position to restore later
let preMaxState = { left: null, top: null };

// Minimize — show only header bar
minimizeCallBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isMaximized) return; // can't minimize while maximized
    isMinimized = !isMinimized;
    callPanel.classList.toggle("minimized", isMinimized);
    minimizeCallBtn.title = isMinimized ? "Restore" : "Minimize";
    minimizeCallBtn.style.background = isMinimized ? "#94a3b8" : "#fbbf24";
});

// Maximize — go fullscreen, or restore back
maximizeCallBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isMinimized) {
        // Restore from minimized first
        isMinimized = false;
        callPanel.classList.remove("minimized");
    }
    isMaximized = !isMaximized;
    if (isMaximized) {
        // Save current position before maximizing
        preMaxState = { left: callPanel.style.left, top: callPanel.style.top };
        callPanel.classList.add("maximized");
        callPanel.classList.remove("expanded");
        maximizeCallBtn.title = "Restore";
        maximizeCallBtn.textContent = "⧉";
    } else {
        callPanel.classList.remove("maximized");
        // Restore previous position
        if (preMaxState.left) callPanel.style.left = preMaxState.left;
        if (preMaxState.top)  callPanel.style.top  = preMaxState.top;
        maximizeCallBtn.title = "Maximize";
        maximizeCallBtn.textContent = "□";
    }
});

// Close — leave call and hide panel
closeCallBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isCalling) cancelCall();
    if (inCall) leaveCall();
    callPanel.classList.add("hidden");
    callPanel.classList.remove("minimized", "maximized", "expanded");
    isMinimized = false;
    isMaximized = false;
});

// Header click — expand/collapse PIP (only when not minimized/maximized)
callPanelHeader.addEventListener("click", (e) => {
    if (e.target === minimizeCallBtn || e.target === maximizeCallBtn || e.target === closeCallBtn) return;
    if (dragged) { dragged = false; return; }
    if (isMinimized || isMaximized) return;
    callExpanded = !callExpanded;
    callPanel.classList.toggle("expanded", callExpanded);
});

// ── Drag to move call panel ───────────────────────
let dragged   = false;
let dragStartX = 0, dragStartY = 0;
let panelStartX = 0, panelStartY = 0;
let isDragging = false;

callPanelHeader.addEventListener("mousedown", startDrag);
callPanelHeader.addEventListener("touchstart", startDrag, { passive: true });

function startDrag(e) {
    isDragging = true;
    dragged    = false;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = callPanel.getBoundingClientRect();

    dragStartX  = clientX;
    dragStartY  = clientY;
    panelStartX = rect.left;
    panelStartY = rect.top;

    // Switch from bottom/right anchoring to top/left for free movement
    callPanel.style.right  = "auto";
    callPanel.style.bottom = "auto";
    callPanel.style.left   = rect.left + "px";
    callPanel.style.top    = rect.top  + "px";

    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup",   stopDrag);
    document.addEventListener("touchmove", onDrag, { passive: false });
    document.addEventListener("touchend",  stopDrag);
}

function onDrag(e) {
    if (!isDragging) return;
    if (e.cancelable) e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const dx = clientX - dragStartX;
    const dy = clientY - dragStartY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragged = true;

    // Clamp within viewport
    const rect   = callPanel.getBoundingClientRect();
    const newLeft = Math.max(0, Math.min(window.innerWidth  - rect.width,  panelStartX + dx));
    const newTop  = Math.max(0, Math.min(window.innerHeight - rect.height, panelStartY + dy));

    callPanel.style.left = newLeft + "px";
    callPanel.style.top  = newTop  + "px";
}

function stopDrag() {
    isDragging = false;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup",   stopDrag);
    document.removeEventListener("touchmove", onDrag);
    document.removeEventListener("touchend",  stopDrag);
}



// ── Join call ─────────────────────────────────────
async function joinCall() {
    if (inCall) return;
    if (!username.value.trim()) {
        alert("Please enter your name first!");
        return;
    }
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 20 } }, audio: true });
        inCall = true;
        joinCallBtn.textContent = "✅ In Call";
        joinCallBtn.classList.remove("active");
        joinCallBtn.classList.add("in-call-state");
        joinCallBtn.disabled = true;
        callBtn.classList.add("in-call");

        addVideoTile(socket.id, username.value, localStream, true);

        socket.emit("call:join", username.value);
    } catch(e) {
        alert("Camera/mic access denied. Please allow permissions and try again.");
        console.error(e);
    }
}

joinCallBtn.addEventListener("click", async () => {
    if (isCalling) { cancelCall(); return; }
    if (inCall) {
        if (Object.keys(peers).length === 0) leaveCall();
        else return;
    }
    startCalling();
});

function leaveCall() {
    if (!inCall) return;
    inCall = false;

    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    // Close all peer connections
    Object.values(peers).forEach(pc => pc.close());
    peers = {};

    // Clear video grids
    callVideos.innerHTML = "";
    callPipRow.innerHTML = "";

    // Reset UI
    joinCallBtn.textContent = "📹 Join Call";
    joinCallBtn.classList.add("active");
    joinCallBtn.classList.remove("in-call-state");
    joinCallBtn.disabled = false;
    callBtn.classList.remove("in-call");
    micEnabled    = true;
    cameraEnabled = true;
    toggleMicBtn.textContent    = "🎤 Mute";
    toggleCameraBtn.textContent = "📷 Camera Off";
    toggleMicBtn.classList.remove("muted", "danger");
    toggleCameraBtn.classList.remove("muted", "danger");

    socket.emit("call:leave");
}

// ── Mic toggle ────────────────────────────────────
function updateMicUI() {
    toggleMicBtn.textContent = micEnabled ? "🎤 Mute" : "🔇 Unmute";
    toggleMicBtn.classList.toggle("muted", !micEnabled);
    const icon = document.getElementById("tile-" + socket.id)?.querySelector(".tile-muted");
    if (icon) icon.textContent = micEnabled ? "" : "🔇";
}
toggleMicBtn.addEventListener("click", () => {
    if (!inCall || !localStream) {
        alert("Join the call first!");
        return;
    }
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
    updateMicUI();
});

// ── Camera toggle ─────────────────────────────────
function updateCameraUI() {
    toggleCameraBtn.textContent = cameraEnabled ? "📷 Camera Off" : "📷 Camera On";
    toggleCameraBtn.classList.toggle("danger", !cameraEnabled);
    const tile = document.getElementById("tile-" + socket.id);
    if (tile) tile.classList.toggle("no-video", !cameraEnabled);
}
toggleCameraBtn.addEventListener("click", () => {
    if (!inCall || !localStream) {
        alert("Join the call first!");
        return;
    }
    cameraEnabled = !cameraEnabled;
    localStream.getVideoTracks().forEach(t => { t.enabled = cameraEnabled; });
    updateCameraUI();
});

// ── Add video tile (expanded grid + PIP row) ─────
function addVideoTile(socketId, name, stream, isLocal) {
    removeVideoTile(socketId);
    const displayName = isLocal ? (name + " (You)") : name;

    // ── Expanded grid tile ──
    const tile = document.createElement("div");
    tile.className = "call-video-tile";
    tile.id = "tile-" + socketId;

    const video = document.createElement("video");
    video.autoplay = true; video.playsInline = true;
    if (isLocal) video.muted = true;
    video.srcObject = stream;

    const nameTag = document.createElement("div");
    nameTag.className = "tile-name";
    nameTag.textContent = displayName;

    const mutedIcon = document.createElement("div");
    mutedIcon.className = "tile-muted";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "call-avatar-wrap";
    const avatar = document.createElement("div");
    avatar.className = "call-avatar";
    avatar.textContent = name.charAt(0).toUpperCase();
    avatarWrap.appendChild(avatar);

    tile.appendChild(video);
    tile.appendChild(avatarWrap);
    tile.appendChild(nameTag);
    tile.appendChild(mutedIcon);
    callVideos.appendChild(tile);

    // ── PIP small tile ──
    const pip = document.createElement("div");
    pip.className = "call-pip-tile";
    pip.id = "pip-" + socketId;

    const pipVideo = document.createElement("video");
    pipVideo.autoplay = true; pipVideo.playsInline = true;
    if (isLocal) pipVideo.muted = true;
    pipVideo.srcObject = stream;

    const pipName = document.createElement("div");
    pipName.className = "tile-name";
    pipName.textContent = isLocal ? "You" : name;

    pip.appendChild(pipVideo);
    pip.appendChild(pipName);
    callPipRow.appendChild(pip);
}

function removeVideoTile(socketId) {
    const tile = document.getElementById("tile-" + socketId);
    if (tile) tile.remove();
    const pip = document.getElementById("pip-" + socketId);
    if (pip) pip.remove();
}

// ── Create peer connection ────────────────────────
function createPeer(remoteSocketId, initiator) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peers[remoteSocketId] = pc;

    // Add local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // When we get remote stream
    pc.ontrack = (e) => {
        const remoteStream = e.streams[0];
        // Update expanded tile
        const existingTile = document.getElementById("tile-" + remoteSocketId);
        if (existingTile) {
            existingTile.querySelector("video").srcObject = remoteStream;
        }
        // Update PIP tile
        const existingPip = document.getElementById("pip-" + remoteSocketId);
        if (existingPip) {
            existingPip.querySelector("video").srcObject = remoteStream;
        }
    };

    // ICE candidates
    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("call:ice-candidate", { to: remoteSocketId, candidate: e.candidate });
        }
    };

    // Connection state
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            removeVideoTile(remoteSocketId);
            delete peers[remoteSocketId];
        }
    };

    // If initiator, create offer
    if (initiator) {
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                socket.emit("call:offer", { to: remoteSocketId, offer: pc.localDescription });
            })
            .catch(console.error);
    }

    return pc;
}

// ── Socket: existing users when I join ───────────
socket.on("call:existing-users", (users) => {
    users.forEach(({ socketId, username: name }) => {
        // Add placeholder tile
        addVideoTile(socketId, name, new MediaStream(), false);
        // Create peer and send offer
        createPeer(socketId, true);
    });
});

// ── Socket: new user joined after me ─────────────
socket.on("call:user-joined", ({ socketId, username: name }) => {
    if (!inCall) return;
    addVideoTile(socketId, name, new MediaStream(), false);
    createPeer(socketId, false); // they will send offer to me
});

// ── Socket: receive offer ─────────────────────────
socket.on("call:offer", async ({ from, offer }) => {
    if (!inCall) return;
    let pc = peers[from];
    if (!pc) pc = createPeer(from, false);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("call:answer", { to: from, answer: pc.localDescription });
});

// ── Socket: receive answer ────────────────────────
socket.on("call:answer", async ({ from, answer }) => {
    const pc = peers[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

// ── Socket: receive ICE candidate ─────────────────
socket.on("call:ice-candidate", async ({ from, candidate }) => {
    const pc = peers[from];
    if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch(e) { console.error("ICE error:", e); }
    }
});

// ── Socket: user left call ────────────────────────
socket.on("call:user-left", (socketId) => {
    removeVideoTile(socketId);
    if (peers[socketId]) {
        peers[socketId].close();
        delete peers[socketId];
    }
});

// ── Participant count ─────────────────────────────
socket.on("call:participants", (count) => {
    callCount.textContent = count + " in call";
});

// ── Incoming call signaling ───────────────────────
socket.on("call:incoming", ({ from, username: name }) => {
    if (incomingCallFrom) return;
    if (inCall) {
        if (Object.keys(peers).length > 0) return; // In a call with others, ignore
        leaveCall(); // Alone in a stale call, leave so we can accept
    }
    incomingCallFrom = from;
    incomingCallAvatar.textContent = name.charAt(0).toUpperCase();
    incomingCallName.textContent = name;
    incomingCallStatus.textContent = "is calling...";
    incomingCallOverlay.classList.remove("hidden");
    startRingtone();
});

socket.on("call:canceled", () => {
    stopRingtone();
    incomingCallOverlay.classList.add("hidden");
    incomingCallFrom = null;
});

socket.on("call:accepted", async ({ socketId, username: name }) => {
    if (!isCalling) return;
    isCalling = false;
    if (callRingTimeout) { clearTimeout(callRingTimeout); callRingTimeout = null; }
    joinCallBtn.textContent = "✅ " + name + " joined";
    joinCallBtn.classList.remove("active");
    if (!inCall) setTimeout(() => joinCall(), 600);
});

socket.on("call:rejected", ({ socketId, username: name }) => {
    if (!isCalling) return;
    joinCallBtn.textContent = "❌ " + name + " declined";
    setTimeout(() => { if (isCalling) cancelCall(); }, 2000);
});



