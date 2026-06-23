const SERVER_URL    = "https://chat-app-dptb.onrender.com";
function isCapacitor() { return !!(window.Capacitor && window.Capacitor.isNativePlatform); }
const socket        = io(SERVER_URL, {
    transports: ["websocket"],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity
});

// ── Push notifications & badge count (Capacitor) ──
let unreadCount = 0;
let appIsActive = true;
const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications || null;
const BadgePlugin       = window.Capacitor?.Plugins?.Badge || null;
const CapacitorApp      = window.Capacitor?.Plugins?.App || null;

function requestNotificationPermission() {
    if (LocalNotifications && typeof LocalNotifications.requestPermissions === "function") {
        LocalNotifications.requestPermissions();
    }
}

function sendMessageNotification(user, message) {
    if (!LocalNotifications || !isCapacitor()) return;
    unreadCount++;
    const body = unreadCount === 1
        ? `${user}: ${message}`
        : `${unreadCount} unread messages from ${user} and others`;
    LocalNotifications.schedule({
        notifications: [{
            id: 999,
            title: "Huba Huba",
            body: body,
            ongoing: false,
            autoCancel: true
        }]
    });
    if (BadgePlugin && typeof BadgePlugin.setCount === "function") {
        BadgePlugin.setCount({ count: unreadCount });
    }
}

function clearBadge() {
    unreadCount = 0;
    if (LocalNotifications && typeof LocalNotifications.removeAllDelivered === "function") {
        LocalNotifications.removeAllDelivered();
    }
    if (BadgePlugin && typeof BadgePlugin.setCount === "function") {
        BadgePlugin.setCount({ count: 0 });
    }
}

if (isCapacitor() && CapacitorApp) {
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        appIsActive = isActive;
        if (isActive) clearBadge();
    });
}

requestNotificationPermission();


const form          = document.getElementById("form");
const input         = document.getElementById("input");
const username      = document.getElementById("username");
const chat          = document.getElementById("chat");
const usersList     = document.getElementById("users");
let   isAdmin       = false;
let   lastActivity  = Date.now();
let   userStatus    = "online";
const REACT_EMOJIS = ["👍", "❤️", "😂", "😮"];
const MORE_REACT_EMOJIS = ["😢","🙏","🔥","🎉","👏","💯","😡","🥺","😎","🤔","💔","✨","😴","🙌"];

// ── Swipe-to-reply state ──
let replyTo = null;
function setReplyTo(data) {
    replyTo = { id: data.id, user: data.user, msg: data.msg };
    const snippets = [
        { bar: "replyBar", name: "replyBarName", msg: "replyBarMsg" },
        { bar: "vreplyBar", name: "vreplyBarName", msg: "vreplyBarMsg" },
        { bar: "hreplyBar", name: "hreplyBarName", msg: "hreplyBarMsg" }
    ];
    const snippet = DOMPurify.sanitize(data.msg || (data.image ? "📷 Image" : data.gif ? "🎞️ GIF" : ""));
    snippets.forEach(({ bar: barId, name: nameId, msg: msgId }) => {
        const bar = document.getElementById(barId);
        const nameEl = document.getElementById(nameId);
        const msgEl = document.getElementById(msgId);
        if (bar && nameEl && msgEl) {
            nameEl.textContent = DOMPurify.sanitize(data.user);
            msgEl.textContent = snippet;
            bar.classList.remove("hidden");
        }
    });
}
function cancelReply() {
    replyTo = null;
    document.querySelectorAll(".reply-bar").forEach(b => b.classList.add("hidden"));
}

document.getElementById("replyBarCancel").addEventListener("click", cancelReply);
document.getElementById("vreplyBarCancel").addEventListener("click", cancelReply);
document.getElementById("hreplyBarCancel").addEventListener("click", cancelReply);

const connStatus = document.getElementById("connStatus");
socket.on("connect", () => {
    connStatus.textContent = "✓ Connected to server";
    connStatus.className = "lobby-conn connected";
});
socket.on("connect_error", (err) => {
    connStatus.textContent = "✗ Connection error: " + err.message;
    connStatus.className = "lobby-conn error";
    console.error("Socket connect_error:", err);
    // Reset create button if it was stuck waiting
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "Create Room";
    if (err.message === "xhr poll error") {
        showLobbyError("Server unreachable — it may be waking up from sleep, try again in a moment");
        setTimeout(() => showLobbyError(""), 6000);
    }
});
socket.on("disconnect", (reason) => {
    connStatus.textContent = "Disconnected: " + reason;
    connStatus.className = "lobby-conn error";
});

function generateMessageId() {
    return socket.id + "-" + Date.now();
}


/* ===================================
   LOBBY — Create / Join Room
=================================== */

const lobby         = document.getElementById("lobby");
const lobbyName     = document.getElementById("lobbyName");
const lobbyError    = document.getElementById("lobbyError");
const createTab     = document.querySelector('[data-tab="create"]');
const joinTab       = document.querySelector('[data-tab="join"]');
const lobbyCreate   = document.getElementById("lobbyCreate");
const lobbyJoin     = document.getElementById("lobbyJoin");
const createRoomName = document.getElementById("createRoomName");
const createRoomPassword = document.getElementById("createRoomPassword");
const createRoomBtn = document.getElementById("createRoomBtn");
const roomList      = document.getElementById("roomList");
const app           = document.getElementById("app");
const roomTitle     = document.getElementById("roomTitle");

let currentRoomId = null;
let lastRoomId = null;
let intentionalLeave = false;
let disconnected = false;
let reconnectTimer = null;
let currentRoomPassword = "";

lobbyName.focus();

// ── Lobby tab toggle ──
let roomListInterval = null;
document.querySelectorAll(".lobby-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".lobby-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        lobbyCreate.classList.toggle("hidden", tab.dataset.tab !== "create");
        lobbyJoin.classList.toggle("hidden", tab.dataset.tab !== "join");
        if (roomListInterval) { clearInterval(roomListInterval); roomListInterval = null; }
        if (tab.dataset.tab === "join") {
            refreshRoomList();
            roomListInterval = setInterval(refreshRoomList, 5000);
        }
    });
});

// ── Create room ──
createRoomBtn.addEventListener("click", () => {
    if (!socket.connected) {
        showLobbyError("Not connected to server — wait for connection");
        return;
    }
    const name = lobbyName.value.trim();
    const roomName = createRoomName.value.trim();
    if (!name) { showLobbyError("Enter your name"); return; }
    if (!roomName) { showLobbyError("Enter a room name"); return; }
    showLobbyError("");
    createRoomBtn.disabled = true;
    createRoomBtn.textContent = "Creating...";
    currentRoomPassword = createRoomPassword.value;
    socket.emit("room:create", { name, roomName, password: currentRoomPassword });
});

createRoomName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createRoomBtn.click();
});
createRoomPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createRoomBtn.click();
});

// ── Join room ──
function refreshRoomList() {
    socket.emit("room:list");
}

socket.on("room:list", (rooms) => {
    if (rooms.length === 0) {
        roomList.innerHTML = '<div class="room-list-empty">No rooms available. Create one!</div>';
        return;
    }
    roomList.innerHTML = "";
    rooms.forEach(r => {
        const div = document.createElement("div");
        div.className = "room-list-item";
        div.innerHTML = DOMPurify.sanitize(`
            <div>
                <div class="room-list-name">${r.id}</div>
                <div class="room-list-meta">${r.userCount} user${r.userCount !== 1 ? 's' : ''}</div>
            </div>
            ${r.hasPassword ? '<span class="room-list-pw">🔒</span>' : ''}
        `);
        div.addEventListener("click", () => joinRoom(r.id, r.hasPassword));
        roomList.appendChild(div);
    });
});

function joinRoom(roomId, hasPassword) {
    const name = lobbyName.value.trim();
    if (!name) { showLobbyError("Enter your name first"); return; }
    if (hasPassword) {
        const pw = prompt("Enter room password:");
        if (pw === null) return;
        currentRoomPassword = pw;
        socket.emit("room:join", { roomId, name, password: pw });
    } else {
        currentRoomPassword = "";
        socket.emit("room:join", { roomId, name, password: "" });
    }
}

// ── Lobby error ──
function setBgVideo(isLobby) {
    const lobbyVid = document.getElementById("bgVideoLobby");
    const roomVid = document.getElementById("bgVideoRoom");
    if (lobbyVid && roomVid) {
        lobbyVid.style.display = isLobby ? "" : "none";
        roomVid.style.display = isLobby ? "none" : "";
        (isLobby ? lobbyVid : roomVid).play().catch(() => {});
    }
}

function showLobbyError(msg) {
    lobbyError.textContent = msg;
    lobbyError.classList.toggle("hidden", !msg);
}

// ── Room joined ──
socket.on("room:joined", ({ roomId, isAdmin: admin, hasPassword, username: name, users }) => {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "Create Room";
    lobby.classList.add("hidden");
    app.classList.remove("hidden");
    setBgVideo(false);
    currentRoomId = roomId;
    roomTitle.textContent = roomId;

    username.value = name;
    isAdmin = admin;

    // Password field visibility
    document.getElementById("password").classList.toggle("hidden", !hasPassword);
    document.getElementById("password").placeholder = "Room password";
    document.getElementById("password").value = "";

    // Admin section
    if (admin) {
        document.getElementById("adminSection").classList.remove("hidden");
        document.querySelector(".online-section h3").textContent = "Online (you are admin)";
    }

    // Populate users
    if (users) {
        roomUsersMap = {};
        users.forEach(({ id, username: name }) => { roomUsersMap[id] = name; });
        userStatusMap = {};
        users.forEach(({ id }) => { userStatusMap[id] = "online"; });
        renderUserList();
    }

    // Unlock chat
    document.getElementById("input").disabled = false;
    document.getElementById("emojiBtn").disabled = false;
    document.querySelector("#form button[type='submit']").disabled = false;
    document.getElementById("input").focus();

    // Reset video state for fresh join
    currentVideoId = null;
    loopEnabled = false;
    loopBtn.classList.remove("active");
    loopBtn.title = "Loop";
    queueList = [];
    renderQueue();

    // Initial user status
    lastActivity = Date.now();
    userStatus = "online";
    socket.emit("user:status", "online");
});

// ── Room ended ──
socket.on("room:ended", () => {
    goToLobby("Room ended by admin");
});

// ── Leave room button (top menu) ──
function goToLobby(msg) {
    disconnected = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    showReconnectingBanner(false);
    if (inCall) leaveCall();
    stopRingtone();
    incomingCallOverlay.classList.add("hidden");
    closeVideoPanel();
    closeHyperbeamPanel();
    callPanel.classList.add("hidden");
    app.classList.add("hidden");
    lobby.classList.remove("hidden");
    setBgVideo(true);
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "Create Room";
    if (currentRoomId) {
        intentionalLeave = true;
        lastRoomId = currentRoomId;
        socket.emit("room:leave");
        currentRoomId = null;
    }
    isAdmin = false;
    userStatusMap = {};
    document.getElementById("adminSection").classList.add("hidden");
    document.querySelector(".online-section h3").textContent = "Online";
    document.getElementById("users").innerHTML = "";
    document.getElementById("chat").innerHTML = "";
    if (msg) showLobbyError(msg);
    else showLobbyError("");
    lobbyName.focus();
}

// Add leave room to top menu dropdown
const leaveBtn = document.createElement("button");
leaveBtn.className = "dropdown-item";
leaveBtn.style.cssText = "background:rgba(220,38,38,0.2);color:#fca5a5;";
leaveBtn.innerHTML = "🚪 Leave Room";
leaveBtn.addEventListener("click", () => {
    topMenuDropdown.classList.add("hidden");
    goToLobby("");
});
document.getElementById("topMenuDropdown").appendChild(leaveBtn);

// ── Socket disconnect ──
socket.on("disconnect", () => {
    if (intentionalLeave) { intentionalLeave = false; return; }
    if (!currentRoomId) return;
    disconnected = true;
    showReconnectingBanner(true);
    reconnectTimer = setTimeout(() => {
        if (disconnected) {
            disconnected = false;
            showReconnectingBanner(false);
            goToLobby("Connection lost - please rejoin");
        }
    }, 30000);
});

socket.on("connect", () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    if (currentRoomId && username.value) {
        disconnected = false;
        showReconnectingBanner(false);
        socket.emit("room:join", { roomId: currentRoomId, name: username.value, password: currentRoomPassword });
        return;
    }

    if (lastRoomId) {
        socket.emit("room:leave", { roomId: lastRoomId });
        lastRoomId = null;
    }
});

function showReconnectingBanner(show) {
    let banner = document.getElementById("reconnectBanner");
    if (!show) {
        if (banner) banner.remove();
        return;
    }
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "reconnectBanner";
        banner.textContent = "⚡ Reconnecting...";
        banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:10000;background:#f59e0b;color:#000;text-align:center;padding:8px 16px;font-size:14px;font-weight:600;";
        document.body.appendChild(banner);
    }
}

/* ===================================
   LOGIN LOCK — now handled by lobby
=================================== */

const passwordInput = document.getElementById("password");
const authError     = document.getElementById("authError");

input.disabled = true;
document.getElementById("emojiBtn").disabled = true;
document.querySelector("#form button[type='submit']").disabled = true;

socket.on("auth:status", ({ hasPassword, isAdmin: admin }) => {
    document.getElementById("password").classList.toggle("hidden", !hasPassword);
    if (hasPassword) {
        document.getElementById("password").placeholder = "Room password";
    }
    if (admin) {
        isAdmin = true;
        document.getElementById("adminSection").classList.remove("hidden");
        document.querySelector(".online-section h3").textContent = "Online (you are admin)";
    }
});

socket.on("auth:error", (msg) => {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "Create Room";
    if (!lobby.classList.contains("hidden")) {
        showLobbyError(msg);
        setTimeout(() => showLobbyError(""), 5000);
        return;
    }
    disconnected = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    showReconnectingBanner(false);
    if (currentRoomId) {
        lastRoomId = currentRoomId;
        currentRoomId = null;
    }
    if (msg === "Room not found") {
        goToLobby("");
    } else {
        goToLobby("Disconnected: " + msg);
    }
});

socket.on("auth:kicked", () => {
    intentionalLeave = true;
    goToLobby("You have been kicked from the room");
});

socket.on("auth:password-updated", ({ hasPassword }) => {
    document.getElementById("password").classList.toggle("hidden", !hasPassword);
    document.getElementById("password").placeholder = "Room password";
    document.getElementById("password").value = "";
    document.getElementById("adminPassword").value = "";
    document.getElementById("clearPasswordBtn").classList.toggle("hidden", !hasPassword);
});

document.getElementById("setPasswordBtn").addEventListener("click", () => {
    const pw = document.getElementById("adminPassword").value;
    socket.emit("auth:set-password", pw);
});
document.getElementById("clearPasswordBtn").addEventListener("click", () => {
    if (confirm("Remove room password?")) socket.emit("auth:set-password", "");
});

document.getElementById("endRoomBtn").addEventListener("click", () => {
    if (confirm("End the room for everyone?")) socket.emit("room:end");
});

const typingIndicator = document.getElementById("typingIndicator");
const emojiBtn      = document.getElementById("emojiBtn");
const emojiPicker   = document.getElementById("emojiPicker");
const backBtn       = document.getElementById("backBtn");
const exploreBtn    = document.getElementById("exploreBtn");
const videoPanel    = document.getElementById("videoPanel");
const videoInput    = document.getElementById("videoInput");
const loadVideoBtn  = document.getElementById("loadVideoBtn");
const videoStatus   = document.getElementById("videoStatus");
const videoStatusText = document.getElementById("videoStatusText");
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

// ── User status tracking ─────────────────────────
const STATUS_EVENTS = ["keydown", "click", "touchstart", "focus"];
function onUserActivity() {
    lastActivity = Date.now();
    if (userStatus !== "online") {
        userStatus = "online";
        socket.emit("user:status", "online");
    }
}
STATUS_EVENTS.forEach(ev => document.addEventListener(ev, onUserActivity, { passive: true }));
let mousemoveThrottle;
document.addEventListener("mousemove", () => {
    if (mousemoveThrottle) return;
    mousemoveThrottle = setTimeout(() => { mousemoveThrottle = null; }, 300);
    onUserActivity();
}, { passive: true });
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        userStatus = "away";
        socket.emit("user:status", "away");
    } else {
        onUserActivity();
    }
});
window.addEventListener("blur", () => {
    userStatus = "away";
    socket.emit("user:status", "away");
});
window.addEventListener("focus", onUserActivity);
setInterval(() => {
    const elapsed = Date.now() - lastActivity;
    let newStatus;
    if (elapsed > 120000) newStatus = "away";
    else if (elapsed > 30000) newStatus = "idle";
    else newStatus = "online";
    if (newStatus !== userStatus) {
        userStatus = newStatus;
        socket.emit("user:status", userStatus);
    }
}, 15000);

function statusDot(status) {
    if (status === "online") return "🟢";
    if (status === "idle") return "🟡";
    if (status === "away") return "⚫";
    return "⚫";
}

// ── Sidebar ───────────────────────────────────────
function openSidebar()  { sidebar.classList.add("open");    sidebarOverlay.classList.add("visible"); }
function closeSidebar() { sidebar.classList.remove("open"); sidebarOverlay.classList.remove("visible"); }
    if (hamburger) hamburger.addEventListener("click", () => sidebar.classList.contains("open") ? closeSidebar() : openSidebar());
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
    const msgText = input.value.trim();
    if ((!msgText && !pendingImage) || !username.value.trim()) return;

    const msgId = generateMessageId();
    const payload = { id: msgId, user: username.value, msg: msgText };
    if (replyTo) payload.replyTo = replyTo;
    if (pendingImage) {
        uploadImage(pendingImage).then(url => {
            if (url) {
                payload.image = url;
                socket.emit("chat message", payload);
            }
            clearPending("main");
        });
    } else {
        socket.emit("chat message", payload);
    }
    input.value = "";
    cancelReply();
    socket.emit("stop typing");
    emojiPicker.classList.add("hidden");
});
function appendMessage(data, container) {
    const div = document.createElement("div");
    div.classList.add("message");
    if (data.user === username.value) div.classList.add("self");
    else if (container === chat) playNotification();
    if (data.id) div.dataset.id = data.id;
    let html = "";
    if (data.replyTo) {
        const replySnippet = data.replyTo.msg || (data.replyTo.image ? "📷 Image" : data.replyTo.gif ? "🎞️ GIF" : "");
        html += '<div class="reply-quoted"><span class="reply-quoted-name">' + DOMPurify.sanitize(data.replyTo.user) + '</span><span class="reply-quoted-msg">' + DOMPurify.sanitize(replySnippet) + '</span></div>';
    }
    html += "<strong>" + DOMPurify.sanitize(data.user) + "</strong>" + DOMPurify.sanitize(data.msg);
    if (data.image) {
        const src = data.image.startsWith("/") ? SERVER_URL + data.image : data.image;
        html += '<img class="message-media" src="' + DOMPurify.sanitize(src) + '" loading="lazy" />';
    }
    if (data.gif) html += '<img class="message-media" src="' + DOMPurify.sanitize(data.gif) + '" loading="lazy" />';
    div.innerHTML = DOMPurify.sanitize(html);

    div.querySelectorAll(".message-media").forEach(img => {
        img.addEventListener("click", () => {
            const url = img.src;
            if (isCapacitor()) {
                window.open(url, "_system");
            } else {
                window.open(url);
            }
        });
    });

    const reactionsDiv = document.createElement("div");
    reactionsDiv.className = "message-reactions";
    div.appendChild(reactionsDiv);

    // Long press / double-tap for WhatsApp-style reactions
    let longPressTimer = null;
    let longPressTriggered = false;
    let lastTapTime = 0;

    div.addEventListener("click", (e) => {
        if (longPressTriggered) { longPressTriggered = false; return; }
        const now = Date.now();
        if (now - lastTapTime < 350) {
            e.preventDefault();
            if (data.id) socket.emit("message:react", { messageId: data.id, emoji: "👍" });
            lastTapTime = 0;
            return;
        }
        lastTapTime = now;
    });

    // Swipe-to-reply state for this message
    let swipeStartX = 0, swipeStartY = 0, swipeDx = 0, swiping = false;
    const swipeIndicator = document.createElement("div");
    swipeIndicator.className = "swipe-reply-indicator";

    div.addEventListener("touchstart", (e) => {
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
        swipeDx = 0;
        swiping = false;
        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            if (data.id && !e.target.closest(".message-reactions")) {
                showReactionBarAt(data.id, div);
            }
        }, 500);
    }, { passive: true });

    div.addEventListener("touchmove", (e) => {
        clearTimeout(longPressTimer);
        swipeDx = e.touches[0].clientX - swipeStartX;
        const dy = Math.abs(e.touches[0].clientY - swipeStartY);
        if (swipeDx > 20 && dy < 30) {
            swiping = true;
            swipeIndicator.style.transform = `translateX(${Math.min(swipeDx, 60)}px)`;
            swipeIndicator.style.opacity = Math.min(swipeDx / 60, 1);
            div.classList.add("swiping");
        } else if (dy > 30) {
            swiping = false;
            div.classList.remove("swiping");
            swipeIndicator.style.transform = "translateX(0)";
            swipeIndicator.style.opacity = "0";
        }
    }, { passive: true });

    div.addEventListener("touchend", () => {
        clearTimeout(longPressTimer);
        if (swiping && swipeDx > 50) {
            div.classList.remove("swiping");
            swipeIndicator.style.transform = "translateX(0)";
            swipeIndicator.style.opacity = "0";
            if (data.id) setReplyTo(data);
        }
        swiping = false;
        swipeDx = 0;
    });

    // Small hover trigger for desktop (subtle ⋯)
    const hoverTrigger = document.createElement("button");
    hoverTrigger.className = "reaction-trigger";
    hoverTrigger.textContent = "⋯";
    hoverTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const existingBar = document.getElementById("global-reaction-bar");
        if (existingBar && existingBar.style.visibility === "visible") {
            closeReactionUI();
        } else {
            showReactionBarAt(data.id, div);
        }
    });
    div.appendChild(hoverTrigger);

    // Desktop reply button
    const replyBtn = document.createElement("button");
    replyBtn.className = "reply-trigger";
    replyBtn.textContent = "↩";
    replyBtn.title = "Reply";
    replyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (data.id) setReplyTo(data);
    });
    div.appendChild(replyBtn);
    div.appendChild(swipeIndicator);

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

socket.on("chat message", (data) => {
    appendMessage(data, chat);
    appendMessage(data, vchatMsgs);
    appendMessage(data, hchatMsgs);
    if (!appIsActive && data.user !== username.value) {
        sendMessageNotification(data.user, data.msg);
    }
});

socket.on("message:reactions-update", ({ messageId, reactions }) => {
    const updateContainer = (container) => {
        const msg = container.querySelector(`.message[data-id="${messageId}"]`);
        if (!msg) return;
        const reactionsDiv = msg.querySelector(".message-reactions");
        if (!reactionsDiv) return;
        reactionsDiv.innerHTML = "";
        Object.entries(reactions).forEach(([emoji, users]) => {
            const badge = document.createElement("span");
            badge.className = "reaction-badge";
            if (users.includes(socket.id)) badge.classList.add("active");
            badge.textContent = emoji + " " + users.length;
            reactionsDiv.appendChild(badge);
        });
    };
    updateContainer(chat);
    updateContainer(vchatMsgs);
    updateContainer(hchatMsgs);
});

// ── Global reaction bar (on body) ────────────────
function createGlobalBar() {
    let bar = document.getElementById("global-reaction-bar");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "global-reaction-bar";
    bar.className = "reaction-bar";
    REACT_EMOJIS.forEach(emoji => {
        const opt = document.createElement("span");
        opt.className = "reaction-opt";
        opt.textContent = emoji;
        opt.addEventListener("click", (e) => {
            e.stopPropagation();
            const msgId = bar.dataset.messageId;
            if (msgId) socket.emit("message:react", { messageId: msgId, emoji });
            closeReactionUI();
        });
        bar.appendChild(opt);
    });
    const more = document.createElement("span");
    more.className = "reaction-more";
    more.textContent = "+";
    more.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleMoreReactions(bar);
    });
    bar.appendChild(more);
    document.body.appendChild(bar);
    return bar;
}

function showReactionBarAt(messageId, messageEl) {
    closeReactionUI();
    const bar = createGlobalBar();
    bar.dataset.messageId = messageId || "";
    const rect = messageEl.getBoundingClientRect();
    const chatRect = document.querySelector(".chat-container").getBoundingClientRect();
    const barW = 180;
    let left = rect.left;
    left = Math.max(left, chatRect.left + 4);
    left = Math.min(left, window.innerWidth - barW - 8);
    bar.style.left = left + "px";
    bar.style.right = "auto";
    bar.style.top = Math.max(chatRect.top + 4, rect.top - 48) + "px";
    bar.style.position = "fixed";
    bar.style.transform = "scale(1)";
    bar.style.visibility = "visible";
    bar.style.opacity = "1";
    bar.style.pointerEvents = "auto";
}

function closeReactionUI() {
    const bar = document.getElementById("global-reaction-bar");
    if (bar) {
        bar.style.visibility = "hidden";
        bar.style.opacity = "0";
        bar.style.pointerEvents = "none";
        bar.style.top = "";
        bar.style.left = "";
        bar.style.right = "";
        bar.dataset.messageId = "";
    }
    document.querySelectorAll(".more-reactions-popup").forEach(p => p.remove());
}

function toggleMoreReactions(bar) {
    const existing = bar.querySelector(".more-reactions-popup");
    if (existing) { existing.remove(); return; }
    document.querySelectorAll(".more-reactions-popup").forEach(p => p.remove());
    const popup = document.createElement("div");
    const barRect = bar.getBoundingClientRect();
    popup.className = "more-reactions-popup" + (barRect.top < 220 ? " below" : "");
    MORE_REACT_EMOJIS.forEach(emoji => {
        const opt = document.createElement("span");
        opt.className = "reaction-opt";
        opt.textContent = emoji;
        opt.addEventListener("click", (e) => {
            e.stopPropagation();
            const msgId = bar.dataset.messageId;
            if (msgId) socket.emit("message:react", { messageId: msgId, emoji });
            closeReactionUI();
        });
        popup.appendChild(opt);
    });
    bar.appendChild(popup);
}

// ── Typing ────────────────────────────────────────
let typingTimeout;
input.addEventListener("input", () => {
    if (!username.value) return;
    socket.emit("typing", username.value);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stop typing"), 1500);
});
socket.on("typing",      (u) => { typingIndicator.textContent = u + " is typing..."; document.getElementById("vchatTyping").textContent = u + " is typing..."; document.getElementById("hchatTyping").textContent = u + " is typing..."; });
socket.on("stop typing", ()  => { typingIndicator.textContent = ""; document.getElementById("vchatTyping").textContent = ""; document.getElementById("hchatTyping").textContent = ""; });

// ── Users ─────────────────────────────────────────
let roomUsersMap = {};
let userStatusMap = {};
socket.on("user:status-update", ({ socketId, status }) => {
    userStatusMap[socketId] = status;
    renderUserList();
});

function renderUserList() {
    if (!usersList) return;
    usersList.innerHTML = "";
    Object.entries(roomUsersMap).forEach(([id, name]) => {
        const li = document.createElement("li");
        const status = userStatusMap[id] || "online";
        li.innerHTML = "<span>" + statusDot(status) + " " + DOMPurify.sanitize(name) + "</span>";
        if (isAdmin && id !== socket.id) {
            const kickBtn = document.createElement("button");
            kickBtn.className = "kick-btn";
            kickBtn.textContent = "✕";
            kickBtn.title = name;
            kickBtn.addEventListener("click", () => {
                if (confirm("Kick " + name + "?")) socket.emit("auth:kick", id);
            });
            li.appendChild(kickBtn);
        }
        usersList.appendChild(li);
    });
}

socket.on("users", (userList) => {
    roomUsersMap = {};
    userList.forEach(({ id, username: name }) => { roomUsersMap[id] = name; });
    renderUserList();
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
const hgrid = document.querySelector("#hemojiPicker .emoji-grid");
emojis.forEach(emoji => {
    const span = document.createElement("span");
    span.textContent = emoji;
    span.addEventListener("pointerdown", (e) => { e.preventDefault(); input.value += emoji; input.focus(); });
    grid.appendChild(span);
    const vspan = document.createElement("span");
    vspan.textContent = emoji;
    vspan.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const activeInput = document.activeElement;
        if (activeInput === vinput) { vinput.value += emoji; vinput.focus(); }
        else { input.value += emoji; input.focus(); }
    });
    vgrid.appendChild(vspan);
    const hspan = document.createElement("span");
    hspan.textContent = emoji;
    hspan.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const activeInput = document.activeElement;
        if (activeInput === hinput) { hinput.value += emoji; hinput.focus(); }
        else { input.value += emoji; input.focus(); }
    });
    hgrid.appendChild(hspan);
});
emojiBtn.addEventListener("click", (e) => { e.stopPropagation(); emojiPicker.classList.toggle("hidden"); });
document.addEventListener("click", (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) emojiPicker.classList.add("hidden");
    if (!document.getElementById("vemojiPicker").contains(e.target) && e.target !== vemojiBtn) document.getElementById("vemojiPicker").classList.add("hidden");
    if (!hemojiPicker.contains(e.target) && e.target !== hemojiBtn) hemojiPicker.classList.add("hidden");
});
document.addEventListener("click", (e) => {
    if (!e.target.closest(".message") && !e.target.closest("#global-reaction-bar")) closeReactionUI();
});
document.getElementById("chat").addEventListener("scroll", closeReactionUI, { passive: true });

// ── GIF Picker (Giphy API) ──────────────────────
const gifBtn = document.getElementById("gifBtn");
const vgifBtn = document.getElementById("vgifBtn");
const gifPicker = document.getElementById("gifPicker");
const vgifPicker = document.getElementById("vgifPicker");
const gifSearch = document.getElementById("gifSearch");
const vgifSearch = document.getElementById("vgifSearch");
const gifResults = document.getElementById("gifResults");
const vgifResults = document.getElementById("vgifResults");
const closeGifPicker = document.getElementById("closeGifPicker");
const vcloseGifPicker = document.getElementById("vcloseGifPicker");

let gifSearchTimer = null;

function toggleGifPicker(picker, searchInput, resultsEl) {
    const opening = picker.classList.toggle("hidden");
    emojiPicker.classList.add("hidden");
    vemojiPicker.classList.add("hidden");
    hemojiPicker.classList.add("hidden");
    if (opening) {
        searchInput.focus();
        searchInput.select();
        searchGiphy(searchInput.value.trim() || "trending", resultsEl);
    }
}

function searchGiphy(query, resultsEl) {
    resultsEl.innerHTML = '<div class="gif-loading">Searching...</div>';
    resultsEl.classList.remove("gif-results-empty");
    fetch(SERVER_URL + "/api/gif-search?q=" + encodeURIComponent(query))
        .then(r => r.json())
        .then(data => {
            resultsEl.innerHTML = "";
            if (data.error === "need_key") {
                resultsEl.innerHTML = '<div class="gif-loading" style="color:#fbbf24">⚠️ Set your Giphy API key<br><span style="font-size:11px;color:rgba(255,255,255,0.4)">Get a free key at developers.giphy.com</span></div>';
                resultsEl.classList.add("gif-results-empty");
                return;
            }
            if (data.error === "bad_key") {
                resultsEl.innerHTML = '<div class="gif-loading" style="color:#f87171">⚠️ Invalid API key</div>';
                resultsEl.classList.add("gif-results-empty");
                return;
            }
            if (!data.results || data.results.length === 0) {
                resultsEl.innerHTML = '<div class="gif-loading">No results — try another search</div>';
                resultsEl.classList.add("gif-results-empty");
                return;
            }
            const frag = document.createDocumentFragment();
            data.results.forEach(g => {
                const el = g.mp4 ? document.createElement("video") : document.createElement("img");
                if (g.mp4) {
                    el.src = g.mp4;
                    el.autoplay = true;
                    el.muted = true;
                    el.loop = true;
                    el.playsInline = true;
                } else {
                    el.src = g.url;
                    el.loading = "lazy";
                    el.decoding = "async";
                }
                el.addEventListener("click", () => {
                    const payload = { id: generateMessageId(), user: username.value, msg: "", gif: g.chat };
                    if (replyTo) payload.replyTo = replyTo;
                    socket.emit("chat message", payload);
                    cancelReply();
                    gifPicker.classList.add("hidden");
                    vgifPicker.classList.add("hidden");
                    hgifPicker.classList.add("hidden");
                });
                frag.appendChild(el);
            });
            resultsEl.appendChild(frag);
        })
        .catch((err) => {
            resultsEl.innerHTML = '<div class="gif-loading">Search failed</div>';
            console.error("GIF search error:", err);
        });
}

gifBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGifPicker(gifPicker, gifSearch, gifResults);
});
gifSearch.addEventListener("input", () => {
    clearTimeout(gifSearchTimer);
    const val = gifSearch.value.trim();
    if (!val) { gifResults.innerHTML = '<div class="gif-loading">Search GIFs...</div>'; return; }
    gifSearchTimer = setTimeout(() => searchGiphy(val, gifResults), 200);
});
gifSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchGiphy(gifSearch.value.trim(), gifResults);
});
closeGifPicker.addEventListener("click", () => gifPicker.classList.add("hidden"));

vgifBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGifPicker(vgifPicker, vgifSearch, vgifResults);
});
vgifSearch.addEventListener("input", () => {
    clearTimeout(gifSearchTimer);
    const val = vgifSearch.value.trim();
    if (!val) { vgifResults.innerHTML = '<div class="gif-loading">Search GIFs...</div>'; return; }
    gifSearchTimer = setTimeout(() => searchGiphy(val, vgifResults), 200);
});
vgifSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchGiphy(vgifSearch.value.trim(), vgifResults);
});
vcloseGifPicker.addEventListener("click", () => vgifPicker.classList.add("hidden"));

document.addEventListener("click", (e) => {
    if (!gifPicker.contains(e.target) && e.target !== gifBtn) gifPicker.classList.add("hidden");
    if (!vgifPicker.contains(e.target) && e.target !== vgifBtn) vgifPicker.classList.add("hidden");
    if (!hgifPicker.contains(e.target) && e.target !== hgifBtn) hgifPicker.classList.add("hidden");
});

// ── Image Upload ──────────────────────────────────
const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const vimageBtn = document.getElementById("vimageBtn");
const vimageInput = document.getElementById("vimageInput");
const attachPreview = document.getElementById("attachPreview");
const attachPreviewImg = document.getElementById("attachPreviewImg");
const attachPreviewRemove = document.getElementById("attachPreviewRemove");
const vattachPreview = document.getElementById("vattachPreview");
const vattachPreviewImg = document.getElementById("vattachPreviewImg");
const vattachPreviewRemove = document.getElementById("vattachPreviewRemove");
let pendingImage = null;
let vpendingImage = null;

function uploadImage(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    return fetch(SERVER_URL + "/upload", { method: "POST", body: formData })
        .then(r => r.json())
        .then(data => data.url || null)
        .catch(() => null);
}

function showPreview(file, previewEl, imgEl, btnEl) {
    const reader = new FileReader();
    reader.onload = (e) => {
        imgEl.src = e.target.result;
        previewEl.classList.remove("hidden");
        btnEl.textContent = "📎";
        btnEl.style.background = "rgba(22,163,74,0.3)";
    };
    reader.readAsDataURL(file);
}

function clearPending(which) {
    if (which === "main") {
        pendingImage = null;
        attachPreview.classList.add("hidden");
        attachPreviewImg.src = "";
        imageBtn.textContent = "📷";
        imageBtn.style.background = "";
    } else if (which === "video") {
        vpendingImage = null;
        vattachPreview.classList.add("hidden");
        vattachPreviewImg.src = "";
        vimageBtn.textContent = "📷";
        vimageBtn.style.background = "";
    } else {
        hpendingImage = null;
        hattachPreview.classList.add("hidden");
        hattachPreviewImg.src = "";
        himageBtn.textContent = "📷";
        himageBtn.style.background = "";
    }
}

imageBtn.addEventListener("click", () => {
    if (pendingImage) { clearPending("main"); return; }
    imageInput.click();
});
imageInput.addEventListener("change", () => {
    if (imageInput.files[0]) {
        pendingImage = imageInput.files[0];
        showPreview(imageInput.files[0], attachPreview, attachPreviewImg, imageBtn);
    }
});
attachPreviewRemove.addEventListener("click", () => clearPending("main"));

vimageBtn.addEventListener("click", () => {
    if (vpendingImage) { clearPending("video"); return; }
    vimageInput.click();
});
vimageInput.addEventListener("change", () => {
    if (vimageInput.files[0]) {
        vpendingImage = vimageInput.files[0];
        showPreview(vimageInput.files[0], vattachPreview, vattachPreviewImg, vimageBtn);
    }
});
vattachPreviewRemove.addEventListener("click", () => clearPending("video"));

// ── Paste & Drop image support ──────────────────
function handleImageFile(file, target) {
    const isV = target === vinput || target.closest("#vform");
    const isH = target === hinput || target.closest("#hform");
    if (isV) {
        vpendingImage = file;
        showPreview(file, vattachPreview, vattachPreviewImg, vimageBtn);
    } else if (isH) {
        hpendingImage = file;
        showPreview(file, hattachPreview, hattachPreviewImg, himageBtn);
    } else {
        pendingImage = file;
        showPreview(file, attachPreview, attachPreviewImg, imageBtn);
    }
}

document.addEventListener("paste", (e) => {
    const target = e.target;
    if (target !== input && target !== vinput && target !== hinput) return;
    const items = e.clipboardData.items;
    for (const item of items) {
        if (item.type.startsWith("image/")) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) handleImageFile(file, target);
            break;
        }
    }
});



function updateMediaSession(title) {
    if (!("mediaSession" in navigator)) return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title || "Huba Huba",
            artist: "Watch Together",
        });
        navigator.mediaSession.setActionHandler("play", () => {
            if (player && playerReady) { player.playVideo(); }
        });
        navigator.mediaSession.setActionHandler("pause", () => {
            if (player && playerReady) { player.pauseVideo(); }
        });
    } catch(e) {}
}

// ── YouTube Player ────────────────────────────────
let player           = null;
let playerReady      = false;
let pendingVideoId   = null;
let pendingSeekTime  = null;
let pendingPaused    = false;
let currentVideoId   = null;
let loopEnabled      = false;

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
    }, 5000);
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
                    videoStatusText.textContent = "⏭️ Loading next from queue...";
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

function playVideoById(videoId, seekTime, paused) {
    currentVideoId = videoId;
    videoEmpty.classList.add("hidden");
    hideBlockedMessage();
    updateMediaSession("Watch Together");

    if (playerReady && player) {
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

function showBlockedMessage(videoId) {
    hideBlockedMessage();
    const msg = document.createElement("div");
    msg.id = "blockedMsg";
    msg.style.cssText = "position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#000;padding:24px;text-align:center;";
    msg.innerHTML =
        "<div style='font-size:44px'>🚫</div>" +
        "<div style='color:white;font-size:16px;font-weight:bold'>This video can't be embedded</div>" +
        "<div style='color:rgba(255,255,255,0.5);font-size:12px;line-height:1.7;max-width:280px'>The video owner disabled external playback. Try a different video.</div>" +
        "<a href='https://www.youtube.com/watch?v=" + DOMPurify.sanitize(videoId||"") + "' target='_blank' style='padding:12px 28px;background:#ff0000;color:white;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold'>▶ Open on YouTube</a>" +
        "<div style='color:rgba(255,255,255,0.3);font-size:11px'>Tip: search for a lyrics or cover version</div>";
    const wrapper = document.querySelector(".video-wrapper");
    if (wrapper) wrapper.appendChild(msg);
    videoStatusText.textContent = "⚠️ Blocked — try another video";
}
function hideBlockedMessage() {
    const el = document.getElementById("blockedMsg");
    if (el) el.remove();
}

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

function openVideoPanel() {
    closeHyperbeamPanel();
    videoPanel.classList.remove("hidden");
    contentArea.classList.add("video-open");
    backBtn.classList.remove("hidden");
    if (inCall) callPanel.classList.add("hidden");
}
function closeVideoPanel() {
    videoPanel.classList.add("hidden");
    contentArea.classList.remove("video-open");
    searchResults.classList.add("hidden");
    hideBlockedMessage();
    if (inCall) callPanel.classList.remove("hidden");
    updateBackBtn();
}

function loadVideo(videoId, title) {
    searchResults.classList.add("hidden");
    videoInput.value = "";
    openVideoPanel();

    if (currentVideoId !== null) {
        addToQueue(videoId, title);
        setTimeout(() => videoInput.focus(), 300);
        return;
    }

    playVideoById(videoId, 0, false);
    videoStatusText.textContent = title ? ("🎬 " + title) : "🎬 Watching together!";
    socket.emit("video:load", videoId);
    setTimeout(() => videoInput.focus(), 300);
}

function addToQueue(videoId, title) {
    if (queueList.length >= 6) return;
    const item = { videoId, title: title || "Untitled", addedBy: username.value };
    queueList.push(item);
    socket.emit("video:add-to-queue", item);
    videoStatusText.textContent = "➕ Added to queue (" + queueList.length + "/6)";
}

function renderQueue() {
    videoQueue.classList.toggle("hidden", queueList.length === 0);
    queueItems.innerHTML = "";
    queueCount.textContent = queueList.length;
    queueList.forEach((item, i) => {
        const div = document.createElement("div");
        div.className = "queue-item";
        div.innerHTML =
            "<span class='queue-item-title'>" + DOMPurify.sanitize(item.title || item.videoId) + "</span>" +
            "<button class='queue-item-remove' data-index='" + i + "'>✕</button>";
        div.addEventListener("click", () => {
            socket.emit("video:play-from-queue", i);
        });
        div.querySelector(".queue-item-remove").addEventListener("click", (e) => {
            e.stopPropagation();
            socket.emit("video:remove-from-queue", i);
        });
        queueItems.appendChild(div);
    });
}

queueHeader.addEventListener("click", () => {
    videoQueue.classList.toggle("collapsed");
});

const videoBottom   = document.getElementById("videoBottom");
const bottomResize  = document.getElementById("bottomResize");
let isResizing      = false;

function resizeStart(e) {
    isResizing = true;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
    document.addEventListener("touchmove", onResizeTouch, { passive: false });
    document.addEventListener("touchend", stopResize);
    document.addEventListener("touchcancel", stopResize);
}
bottomResize.addEventListener("mousedown", resizeStart);
bottomResize.addEventListener("touchstart", resizeStart, { passive: true });

function getResizeY(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
}

function onResize(e) {
    if (!isResizing) return;
    const panelRect = videoBottom.parentElement.getBoundingClientRect();
    const newHeight = panelRect.bottom - getResizeY(e);
    const clamped = Math.max(80, Math.min(newHeight, window.innerHeight * 0.6));
    videoBottom.style.height = clamped + "px";
}

function onResizeTouch(e) {
    if (e.cancelable) e.preventDefault();
    onResize(e);
}

function stopResize() {
    isResizing = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
    document.removeEventListener("touchmove", onResizeTouch);
    document.removeEventListener("touchend", stopResize);
    document.removeEventListener("touchcancel", stopResize);
}

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
        DOMPurify.sanitize("<div style='padding:14px;display:flex;flex-direction:column;gap:10px'>" +
        "<div style='color:rgba(255,255,255,0.5);font-size:13px'>Search unavailable right now.</div>" +
        "<a href='https://www.youtube.com/results?search_query=" + enc + "' target='_blank' style='color:#38bdf8;font-size:13px'>🔗 Search on YouTube → paste the link above</a>" +
        "</div>");
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
        info.innerHTML = DOMPurify.sanitize("<div class='search-item-title'>" + (item.title||"Unknown") + "</div><div class='search-item-channel'>" + (item.author||"") + "</div>");
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

// ── Loop toggle ──────────────────────────────────
const loopBtn = document.getElementById("loopBtn");
loopBtn.addEventListener("click", () => {
    socket.emit("video:toggle-loop");
});

// ── Shuffle / random from queue ──────────────────
const shuffleBtn = document.getElementById("shuffleBtn");
shuffleBtn.addEventListener("click", () => {
    socket.emit("video:play-random-from-queue");
});

// ── Socket sync ──────────────────────────────────
socket.on("room:state", (state) => {
    if (!state.videoId) return;
    openVideoPanel();
    setPendingRemotePlay();
    playVideoById(state.videoId, state.time, !state.playing);
    videoStatusText.textContent = "🎬 Synced with room!";
});

socket.on("video:load", (videoId) => {
    openVideoPanel();
    setPendingRemotePlay();
    playVideoById(videoId, 0, false);
    videoStatusText.textContent = "🎬 Watching together!";
});

socket.on("video:play", (time) => {
    if (!player || !playerReady) return;
    setPendingRemotePlay();
    player.seekTo(time, true);
    player.playVideo();
});
socket.on("video:pause", (time) => {
    if (!player || !playerReady) return;
    setPendingRemotePlay();
    setPendingRemotePause();
    player.seekTo(time, true);
    player.pauseVideo();
});
socket.on("video:seek", (time) => {
    if (!player || !playerReady) return;
    setPendingRemotePlay();
    player.seekTo(time, true);
});

socket.on("video:sync", (time) => {
    if (!player || !playerReady) return;
    const drift = player.getCurrentTime() - time;
    if (Math.abs(drift) > 1.5) {
        setPendingRemotePlay();
        player.seekTo(time, true);
    }
});

socket.on("video:queue-update", (q) => {
    queueList = q;
    renderQueue();
});

socket.on("video:next-playing", (title) => {
    videoStatusText.textContent = "▶️ " + title;
});

socket.on("video:loop-state", (enabled) => {
    loopEnabled = enabled;
    loopBtn.classList.toggle("active", enabled);
    loopBtn.title = enabled ? "Looping on" : "Loop";
});

socket.on("video:loop-restart", (videoId) => {
    if (!player || !playerReady) return;
    stopSyncInterval();
    setPendingRemotePlay();
    player.loadVideoById({ videoId, startSeconds: 0 });
    videoStatusText.textContent = "🔁 Looping";
});

// ── Video panel chat ──────────────────────────────
const vform = document.getElementById("vform");
const vinput = document.getElementById("vinput");
const vchatMsgs = document.getElementById("vchatMsgs");
const vemojiBtn = document.getElementById("vemojiBtn");

vform.addEventListener("submit", (e) => {
    e.preventDefault();
    const msgText = vinput.value.trim();
    if ((!msgText && !vpendingImage) || !username.value.trim()) return;

    const msgId = generateMessageId();
    const payload = { id: msgId, user: username.value, msg: msgText };
    if (replyTo) payload.replyTo = replyTo;
    if (vpendingImage) {
        uploadImage(vpendingImage).then(url => {
            if (url) {
                payload.image = url;
                socket.emit("chat message", payload);
            }
            clearPending("video");
        });
    } else {
        socket.emit("chat message", payload);
    }
    vinput.value = "";
    cancelReply();
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
// HYPERBEAM PANEL CHAT
// ════════════════════════════════════════════════════

const hform = document.getElementById("hform");
const hinput = document.getElementById("hinput");
const hchatMsgs = document.getElementById("hchatMsgs");
const hemojiBtn = document.getElementById("hemojiBtn");

hform.addEventListener("submit", (e) => {
    e.preventDefault();
    const msgText = hinput.value.trim();
    if ((!msgText && !hpendingImage) || !username.value.trim()) return;

    const msgId = generateMessageId();
    const payload = { id: msgId, user: username.value, msg: msgText };
    if (replyTo) payload.replyTo = replyTo;
    if (hpendingImage) {
        uploadImage(hpendingImage).then(url => {
            if (url) {
                payload.image = url;
                socket.emit("chat message", payload);
            }
            clearPending("hyperbeam");
        });
    } else {
        socket.emit("chat message", payload);
    }
    hinput.value = "";
    cancelReply();
    socket.emit("stop typing");
});

hinput.addEventListener("input", () => {
    if (!username.value) return;
    socket.emit("typing", username.value);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stop typing"), 1500);
});

const hemojiPicker = document.getElementById("hemojiPicker");
hemojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hemojiPicker.classList.toggle("hidden");
});

// ── Hyperbeam GIF Picker ──
const hgifBtn = document.getElementById("hgifBtn");
const hgifPicker = document.getElementById("hgifPicker");
const hgifSearch = document.getElementById("hgifSearch");
const hgifResults = document.getElementById("hgifResults");
const hcloseGifPicker = document.getElementById("hcloseGifPicker");

hgifBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGifPicker(hgifPicker, hgifSearch, hgifResults);
});
hgifSearch.addEventListener("input", () => {
    clearTimeout(gifSearchTimer);
    const val = hgifSearch.value.trim();
    if (!val) { hgifResults.innerHTML = '<div class="gif-loading">Search GIFs...</div>'; return; }
    gifSearchTimer = setTimeout(() => searchGiphy(val, hgifResults), 200);
});
hgifSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchGiphy(hgifSearch.value.trim(), hgifResults);
});
hcloseGifPicker.addEventListener("click", () => hgifPicker.classList.add("hidden"));

// ── Hyperbeam Image Upload ──
const himageBtn = document.getElementById("himageBtn");
const himageInput = document.getElementById("himageInput");
const hattachPreview = document.getElementById("hattachPreview");
const hattachPreviewImg = document.getElementById("hattachPreviewImg");
const hattachPreviewRemove = document.getElementById("hattachPreviewRemove");
let hpendingImage = null;

himageBtn.addEventListener("click", () => {
    if (hpendingImage) { clearPending("hyperbeam"); return; }
    himageInput.click();
});
himageInput.addEventListener("change", () => {
    if (himageInput.files[0]) {
        hpendingImage = himageInput.files[0];
        showPreview(himageInput.files[0], hattachPreview, hattachPreviewImg, himageBtn);
    }
});
hattachPreviewRemove.addEventListener("click", () => clearPending("hyperbeam"));

// ── Hyperbeam bottom resize ──
const hbottomResize = document.getElementById("hbottomResize");
const hyperbeamBottom = document.getElementById("hyperbeamBottom");
let hisResizing = false;

function hResizeStart(e) {
    hisResizing = true;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", hOnResize);
    document.addEventListener("mouseup", hStopResize);
    document.addEventListener("touchmove", hOnResizeTouch, { passive: false });
    document.addEventListener("touchend", hStopResize);
    document.addEventListener("touchcancel", hStopResize);
}
hbottomResize.addEventListener("mousedown", hResizeStart);
hbottomResize.addEventListener("touchstart", hResizeStart, { passive: true });

function hGetResizeY(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
}

function hOnResize(e) {
    if (!hisResizing) return;
    const panelRect = hyperbeamBottom.parentElement.getBoundingClientRect();
    const newHeight = panelRect.bottom - hGetResizeY(e);
    const clamped = Math.max(60, Math.min(newHeight, window.innerHeight * 0.6));
    hyperbeamBottom.style.height = clamped + "px";
}

function hOnResizeTouch(e) {
    if (e.cancelable) e.preventDefault();
    hOnResize(e);
}

function hStopResize() {
    hisResizing = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", hOnResize);
    document.removeEventListener("mouseup", hStopResize);
    document.removeEventListener("touchmove", hOnResizeTouch);
    document.removeEventListener("touchend", hStopResize);
    document.removeEventListener("touchcancel", hStopResize);
}

// ════════════════════════════════════════════════════
// VOICE CALL — Audio only
// ════════════════════════════════════════════════════

const voiceMicBtn       = document.getElementById("voiceMicBtn");

let inVoiceCall     = false;
let voiceEnabled    = true;
let voiceStream     = null;
let voicePeers      = {};
let voiceAudioElements = {};
let voiceActiveRoom = false;

const VOICE_RTC_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
    ]
};

function updateVoiceMicBtn() {
    voiceMicBtn.classList.toggle("muted", voiceEnabled);
    voiceMicBtn.title = voiceEnabled ? "Mute" : "Unmute";
}

async function startVoiceStream() {
    if (voiceStream) return voiceStream;
    try {
        voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        voiceEnabled = true;
        updateVoiceMicBtn();
        startSpeakingDetection(voiceStream);
        return voiceStream;
    } catch(e) {
        console.warn("Microphone access denied");
        return null;
    }
}

function stopVoiceStream() {
    stopSpeakingDetection();
    if (voiceStream) {
        voiceStream.getTracks().forEach(t => t.stop());
        voiceStream = null;
    }
}

// ── Speaking detection ──
let voiceSpeakingMap = {};
let speakingInterval = null;
let speakingAudioCtx = null;
let isCurrentlySpeaking = false;

function startSpeakingDetection(stream) {
    stopSpeakingDetection();
    if (!stream) return;
    try {
        speakingAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = speakingAudioCtx.createMediaStreamSource(stream);
        const analyser = speakingAudioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        speakingInterval = setInterval(() => {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            if (avg > 18 && !isCurrentlySpeaking) {
                isCurrentlySpeaking = true;
                socket.emit("voice:speaking");
            } else if (avg <= 12 && isCurrentlySpeaking) {
                isCurrentlySpeaking = false;
                socket.emit("voice:stopped-speaking");
            }
        }, 300);
    } catch(e) {}
}

function stopSpeakingDetection() {
    if (speakingInterval) {
        clearInterval(speakingInterval);
        speakingInterval = null;
    }
    if (speakingAudioCtx) {
        try { speakingAudioCtx.close(); } catch(e) {}
        speakingAudioCtx = null;
    }
    isCurrentlySpeaking = false;
}

function joinVoiceCall() {
    if (inVoiceCall) return;
    inVoiceCall = true;
    voiceMicBtn.title = "Mute";
    socket.emit("voice:join");
}

function leaveVoiceCall() {
    if (!inVoiceCall) return;
    inVoiceCall = false;
    voiceActiveRoom = false;
    voiceMicBtn.title = "Start voice call";

    Object.values(voicePeers).forEach(pc => pc.close());
    voicePeers = {};
    Object.values(voiceAudioElements).forEach(el => el.remove());
    voiceAudioElements = {};
    stopVoiceStream();

    socket.emit("voice:leave");
}

function createVoicePeer(remoteSocketId, initiator) {
    const pc = new RTCPeerConnection(VOICE_RTC_CONFIG);
    voicePeers[remoteSocketId] = pc;

    if (voiceStream) {
        voiceStream.getTracks().forEach(track => pc.addTrack(track, voiceStream));
    }

    pc.ontrack = (e) => {
        if (!voiceAudioElements[remoteSocketId]) {
            const audio = document.createElement("audio");
            audio.autoplay = true;
            audio.style.display = "none";
            document.body.appendChild(audio);
            voiceAudioElements[remoteSocketId] = audio;
        }
        voiceAudioElements[remoteSocketId].srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("voice:ice-candidate", { to: remoteSocketId, candidate: e.candidate });
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            delete voicePeers[remoteSocketId];
        }
    };

    if (initiator) {
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                socket.emit("voice:offer", { to: remoteSocketId, offer: pc.localDescription });
            })
            .catch(console.error);
    }

    return pc;
}

// ── Voice Call mic button (top bar) ──
voiceMicBtn.addEventListener("click", async () => {
    if (!voiceActiveRoom) {
        await startVoiceStream();
        socket.emit("voice:start");
    } else {
        if (!voiceStream) {
            await startVoiceStream();
            if (!voiceStream) return;
        }
        voiceEnabled = !voiceEnabled;
        if (voiceStream) {
            voiceStream.getAudioTracks().forEach(t => { t.enabled = voiceEnabled; });
        }
        updateVoiceMicBtn();
    }
});

// ── Socket events ──
socket.on("voice:started", async ({ participants }) => {
    voiceActiveRoom = true;
    voiceSpeakingMap = {};
    if (!voiceStream) await startVoiceStream();
    if (!inVoiceCall) joinVoiceCall();
    renderUserList();
});

socket.on("voice:existing-users", (users) => {
    users.forEach(({ socketId }) => {
        createVoicePeer(socketId, true);
    });
});

socket.on("voice:user-joined", async ({ socketId }) => {
    if (!inVoiceCall) return;
    if (!voiceStream) await startVoiceStream();
    createVoicePeer(socketId, false);
});

socket.on("voice:offer", async ({ from, offer }) => {
    if (!inVoiceCall) return;
    let pc = voicePeers[from];
    if (!pc) pc = createVoicePeer(from, false);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("voice:answer", { to: from, answer: pc.localDescription });
});

socket.on("voice:answer", async ({ from, answer }) => {
    const pc = voicePeers[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("voice:ice-candidate", async ({ from, candidate }) => {
    const pc = voicePeers[from];
    if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch(e) { console.error("Voice ICE error:", e); }
    }
});

socket.on("voice:user-left", (socketId) => {
    if (voicePeers[socketId]) {
        voicePeers[socketId].close();
        delete voicePeers[socketId];
    }
    if (inVoiceCall && Object.keys(voicePeers).length === 0) {
        leaveVoiceCall();
    }
});

socket.on("voice:participants", (count) => {});

socket.on("voice:ended", () => {
    voiceActiveRoom = false;
    voiceSpeakingMap = {};
    voiceEnabled = false;
    voiceMicBtn.classList.remove("muted");
    voiceMicBtn.title = "Start voice call";
    if (inVoiceCall) leaveVoiceCall();
    renderUserList();
});

socket.on("voice:admin-muted", () => {
    voiceEnabled = false;
    if (voiceStream) {
        voiceStream.getAudioTracks().forEach(t => { t.enabled = false; });
    }
    updateVoiceMicBtn();
});

socket.on("voice:admin-unmuted", () => {
    voiceEnabled = true;
    if (voiceStream) {
        voiceStream.getAudioTracks().forEach(t => { t.enabled = true; });
    }
    updateVoiceMicBtn();
});

// ── Speaking detection events ──
socket.on("voice:speaking", ({ socketId }) => {
    voiceSpeakingMap[socketId] = true;
    renderUserList();
});

socket.on("voice:stopped-speaking", ({ socketId }) => {
    voiceSpeakingMap[socketId] = false;
    renderUserList();
});

// ── Inject admin voice mute buttons in user list ──
// (rendered inside renderUserList)
const _origRender = renderUserList;
function renderUserListWithVoice() {
    if (!usersList) return;
    usersList.innerHTML = "";
    Object.entries(roomUsersMap).forEach(([id, name]) => {
        const li = document.createElement("li");
        if (voiceSpeakingMap[id]) li.classList.add("speaking");
        const status = userStatusMap[id] || "online";
        li.innerHTML = "<span>" + statusDot(status) + " " + DOMPurify.sanitize(name) + "</span>";
        if (isAdmin && id !== socket.id) {
            const kickBtn = document.createElement("button");
            kickBtn.className = "kick-btn";
            kickBtn.textContent = "✕";
            kickBtn.title = name;
            kickBtn.addEventListener("click", () => {
                if (confirm("Kick " + name + "?")) socket.emit("auth:kick", id);
            });
            li.appendChild(kickBtn);
        }
        // Voice mute button for admin
        if (isAdmin && id !== socket.id && voiceActiveRoom) {
            const muted = voicePeers[id] && voicePeers[id]._adminMuted;
            const muteBtn = document.createElement("button");
            muteBtn.className = "voice-mute-btn" + (muted ? " muted" : "");
            muteBtn.textContent = muted ? "🔇" : "🎙️";
            muteBtn.title = muted ? "Unmute" : "Mute";
            muteBtn.addEventListener("click", () => {
                if (muted) {
                    socket.emit("voice:admin-unmute", id);
                    if (voicePeers[id]) voicePeers[id]._adminMuted = false;
                } else {
                    socket.emit("voice:admin-mute", id);
                    if (voicePeers[id]) voicePeers[id]._adminMuted = true;
                }
                renderUserListWithVoice();
            });
            li.appendChild(muteBtn);
        }
        usersList.appendChild(li);
    });
}
renderUserList = renderUserListWithVoice;

// Also clean up voice on room leave
const _origGoToLobby = goToLobby;
function goToLobbyWithVoice(msg) {
    if (inVoiceCall) leaveVoiceCall();
    _origGoToLobby(msg);
}
goToLobby = goToLobbyWithVoice;

// ════════════════════════════════════════════════════
// GROUP VIDEO CALL — WebRTC Mesh + Picture-in-Picture
// ════════════════════════════════════════════════════

const callPanel       = document.getElementById("callPanel");
const callVideos      = document.getElementById("callVideos");
const callPipRow      = document.getElementById("callPipRow");
const joinCallBtn     = document.getElementById("joinCallBtn");
const toggleMicBtn    = document.getElementById("toggleMicBtn");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");

const participantsBtn = document.getElementById("participantsBtn");


const callPanelHeader = document.getElementById("callPanelHeader");
const appEl           = document.querySelector(".app");
let   callExpanded    = false;
let   isCalling       = false;
let   incomingCallFrom = null;
let   callRingTimeout  = null;

const incomingCallOverlay = document.getElementById("incomingCallOverlay");
const incomingCallAvatar  = document.getElementById("incomingCallAvatar");
const incomingCallName    = document.getElementById("incomingCallName");
const incomingCallStatus  = document.getElementById("incomingCallStatus");
const acceptCallBtn       = document.getElementById("acceptCallBtn");
const declineCallBtn      = document.getElementById("declineCallBtn");

const RTC_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
    ]
};

let localStream    = null;
let peers          = {};
let inCall         = false;
let micEnabled     = true;
let cameraEnabled  = true;

function updateEndCallBtn() {
    const show = isCalling || (inCall && Object.keys(peers).length > 0);
    endCallBtn.classList.toggle("hidden", !show);
}

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
        if (!inCall && !isCalling) {
            joinCallBtn.textContent = "📹 Call";
            joinCallBtn.classList.remove("active", "in-call-state");
            joinCallBtn.disabled = false;
            startLocalPreview();
        }
    } else {
        if (isCalling) cancelCall();
        if (inCall) leaveCall();
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
            const localTile = document.getElementById("tile-" + socket.id);
            if (localTile) localTile.remove();
        }
        callPanel.classList.add("hidden");
        callPanel.classList.remove("expanded", "minimized", "maximized");
        callExpanded = false;
        isMinimized = false;
        isMaximized = false;
    }
});

async function startLocalPreview() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 20 } }, audio: true });
        addVideoTile(socket.id, username.value, localStream, true);
        micEnabled = true;
        cameraEnabled = true;
        updateMicUI();
        updateCameraUI();
        Object.values(peers).forEach(pc => {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        });
    } catch(e) {
        console.warn("Camera/mic access denied for preview");
    }
}

async function startCalling() {
    if (inCall) return;
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 20 } }, audio: true });
    } catch(e) {
        alert("Camera/mic access denied");
        return;
    }
    const existingTile = document.getElementById("tile-" + socket.id);
    if (existingTile) {
        existingTile.querySelector("video").srcObject = localStream;
    } else {
        addVideoTile(socket.id, username.value, localStream, true);
    }
    micEnabled = true;
    cameraEnabled = true;
    updateMicUI();
    updateCameraUI();
    isCalling = true;
    joinCallBtn.classList.add("active");
    joinCallBtn.disabled = false;
    joinCallBtn.textContent = "🔔 Ringing...";
    updateEndCallBtn();
    Object.values(peers).forEach(pc => {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    });
    socket.emit("call:ring", { username: username.value });
    callRingTimeout = setTimeout(() => {
        if (isCalling) cancelCall();
    }, 30000);
}

function cancelCall() {
    isCalling = false;
    joinCallBtn.classList.remove("active");
    joinCallBtn.textContent = "📹 Call";
    joinCallBtn.disabled = false;
    updateEndCallBtn();
    if (callRingTimeout) { clearTimeout(callRingTimeout); callRingTimeout = null; }
    callVideos.querySelectorAll(".call-video-tile").forEach(el => {
        if (el.dataset.socketId !== socket.id) el.remove();
    });
    callPipRow.querySelectorAll(".call-pip-tile").forEach(el => {
        if (el.dataset.socketId !== socket.id) el.remove();
    });
    if (localStream) {
        localStream.getTracks().forEach(t => { t.enabled = true; });
    }
    micEnabled = true;
    cameraEnabled = true;
    updateMicUI();
    updateCameraUI();
    socket.emit("call:cancel");
}

exploreBtn.addEventListener("click", () => {
    topMenuDropdown.classList.add("hidden");
    closeHyperbeamPanel();
    videoPanel.classList.contains("hidden") ? openVideoPanel() : closeVideoPanel();
});

backBtn.addEventListener("click", () => {
    closeVideoPanel();
    closeHyperbeamPanel();
});

// ════════════════════════════════════════════════════
// HYPERBEAM CO-BROWSING
// ════════════════════════════════════════════════════

const hyperbeamBtn = document.getElementById("hyperbeamBtn");
const hyperbeamPanel = document.getElementById("hyperbeamPanel");
const hyperbeamContainer = document.getElementById("hyperbeamContainer");
const hyperbeamEmpty = document.getElementById("hyperbeamEmpty");
const startHyperbeamBtn = document.getElementById("startHyperbeamBtn");
const hyperbeamUrlInput = document.getElementById("hyperbeamUrlInput");
const hyperbeamGoBtn = document.getElementById("hyperbeamGoBtn");
const hyperbeamStatusText = document.getElementById("hyperbeamStatusText");
const hyperbeamWrapper = document.getElementById("hyperbeamWrapper");
const hyperbeamToolbar = document.getElementById("hyperbeamToolbar");

let hyperbeamSessionActive = false;
let hyperbeamIframe = null;

function openHyperbeamPanel() {
    closeVideoPanel();
    hyperbeamPanel.classList.remove("hidden");
    contentArea.classList.add("hyperbeam-open");
    backBtn.classList.remove("hidden");
    if (inCall) callPanel.classList.add("hidden");
}

function closeHyperbeamPanel() {
    hyperbeamPanel.classList.add("hidden");
    contentArea.classList.remove("hyperbeam-open");
    if (inCall) callPanel.classList.remove("hidden");
    updateBackBtn();
}

function updateBackBtn() {
    const bothHidden = videoPanel.classList.contains("hidden") && hyperbeamPanel.classList.contains("hidden");
    backBtn.classList.toggle("hidden", bothHidden);
}

hyperbeamBtn.addEventListener("click", () => {
    topMenuDropdown.classList.add("hidden");
    closeVideoPanel();
    if (hyperbeamPanel.classList.contains("hidden")) {
        openHyperbeamPanel();
        if (!hyperbeamSessionActive) {
            socket.emit("hyperbeam:get-session");
        }
    } else {
        closeHyperbeamPanel();
    }
});

startHyperbeamBtn.addEventListener("click", () => {
    if (hyperbeamSessionActive) {
        if (confirm("End the co-browsing session for everyone?")) {
            socket.emit("hyperbeam:stop");
        }
    } else {
        socket.emit("hyperbeam:start");
        hyperbeamStatusText.textContent = "⏳ Starting session...";
    }
});

// Socket events
socket.on("hyperbeam:session", ({ embedUrl }) => {
    hyperbeamSessionActive = true;
    hyperbeamEmpty.classList.add("hidden");
    hyperbeamContainer.classList.remove("hidden");
    startHyperbeamBtn.textContent = "⏹ End";
    startHyperbeamBtn.className = "hb-btn hb-stop";
    hyperbeamStatusText.textContent = "✅ Co-browsing session active";

    hyperbeamContainer.innerHTML = "";
    hyperbeamIframe = document.createElement("iframe");
    hyperbeamIframe.src = embedUrl;
    hyperbeamIframe.allow = "camera; microphone; fullscreen; autoplay";
    hyperbeamIframe.sandbox = "allow-same-origin allow-scripts allow-forms allow-popups allow-modals";
    hyperbeamContainer.appendChild(hyperbeamIframe);
    hyperbeamFsBtn.classList.remove("hidden");
    hbZoomControls.classList.remove("hidden");
    if (hbPanMode) hbExitPanMode();
    hbResetZoom();
});

socket.on("hyperbeam:ended", () => {
    hyperbeamSessionActive = false;
    hyperbeamEmpty.classList.remove("hidden");
    hyperbeamContainer.classList.add("hidden");
    hyperbeamContainer.innerHTML = "";
    hyperbeamIframe = null;
    startHyperbeamBtn.textContent = "▷ Start";
    startHyperbeamBtn.className = "hb-btn hb-start";
    hyperbeamStatusText.textContent = "⏹ Session ended";
    hyperbeamUrlInput.value = "";
    hyperbeamFsBtn.classList.add("hidden");
    hbZoomControls.classList.add("hidden");
    if (hbPanMode) hbExitPanMode();
    hbResetZoom();
    if (getFullscreenElement()) exitFullscreen();
});

socket.on("hyperbeam:error", (msg) => {
    const isRateLimit = msg && msg.toLowerCase().includes("rate-limited");
    hyperbeamStatusText.textContent = isRateLimit
        ? "⚠️ Co-browsing API rate-limited — try again later or get a new key at hyperbeam.com"
        : "⚠️ " + msg;
    if (!hyperbeamSessionActive) {
        startHyperbeamBtn.textContent = "▷ Start";
        startHyperbeamBtn.className = "hb-btn hb-start";
    }
});

// ── Hyperbeam Fullscreen ─────────────────────────
const hyperbeamFsBtn = document.getElementById("hyperbeamFullscreenBtn");
let hyperbeamFsActive = false;

function requestFullscreen(el) {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (fn) {
        fn.call(el);
    } else if (el.webkitEnterFullscreen && el.tagName === "VIDEO") {
        el.webkitEnterFullscreen();
    } else {
        hyperbeamStatusText.textContent = "⚠️ Fullscreen not supported on this device";
    }
}

function exitFullscreen() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (fn) fn.call(document);
}

function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
}

function updateHyperbeamFsBtn() {
    hyperbeamFsBtn.textContent = hyperbeamFsActive ? "⧉" : "⛶";
    hyperbeamFsBtn.title = hyperbeamFsActive ? "Exit full screen (F)" : "Full screen (F)";
}

hyperbeamFsBtn.addEventListener("click", () => {
    if (!getFullscreenElement()) {
        requestFullscreen(hyperbeamWrapper);
    } else {
        exitFullscreen();
    }
});

document.addEventListener("fullscreenchange", () => {
    hyperbeamFsActive = !!getFullscreenElement();
    updateHyperbeamFsBtn();
});
document.addEventListener("webkitfullscreenchange", () => {
    hyperbeamFsActive = !!getFullscreenElement();
    updateHyperbeamFsBtn();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "f" || e.key === "F") {
        const activeTag = document.activeElement?.tagName || "";
        if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
        if (hyperbeamPanel.classList.contains("hidden")) return;
        hyperbeamFsBtn.click();
    }
});

// ── Hyperbeam Zoom ──────────────────────
const hbZoomControls = document.getElementById("hbZoomControls");
const hbZoomInBtn = document.getElementById("hbZoomIn");
const hbZoomOutBtn = document.getElementById("hbZoomOut");
const hbZoomResetBtn = document.getElementById("hbZoomReset");
const hbZoomValue = document.getElementById("hbZoomValue");
const hbPanOverlay = document.getElementById("hbPanOverlay");
const hbPanBtn = document.getElementById("hbPanBtn");
let hbZoom = 1;
let hbPanX = 0;
let hbPanY = 0;
let hbPanMode = false;
let hbDragStartX = 0;
let hbDragStartY = 0;
let hbDragStartPanX = 0;
let hbDragStartPanY = 0;
let hbIsDragging = false;

function hbApplyZoom() {
    if (hbZoom === 1 && hbPanX === 0 && hbPanY === 0) {
        hyperbeamContainer.style.transform = "";
    } else {
        hyperbeamContainer.style.transform = `scale(${hbZoom}) translate(${hbPanX}px, ${hbPanY}px)`;
        hyperbeamContainer.style.transformOrigin = "0 0";
    }
    hbZoomValue.textContent = Math.round(hbZoom * 10) / 10 + "×";
    hbPanBtn.classList.toggle("hidden", hbZoom <= 1);
    if (hbZoom <= 1 && hbPanMode) hbExitPanMode();
}

function hbResetZoom() {
    hbZoom = 1;
    hbPanX = 0;
    hbPanY = 0;
    hbApplyZoom();
}

function hbEnterPanMode() {
    hbPanMode = true;
    hbPanOverlay.classList.remove("hidden");
    hbPanBtn.classList.add("active");
    hbPanBtn.textContent = "🔍";
}

function hbExitPanMode() {
    hbPanMode = false;
    hbPanOverlay.classList.add("hidden");
    hbPanBtn.classList.remove("active");
    hbPanBtn.textContent = "✋";
}

hbPanBtn.addEventListener("click", () => {
    if (hbPanMode) hbExitPanMode();
    else hbEnterPanMode();
});

// Pan via overlay drag
hbPanOverlay.addEventListener("mousedown", (e) => {
    if (!hbPanMode || hbZoom <= 1) return;
    hbIsDragging = true;
    hbDragStartX = e.clientX;
    hbDragStartY = e.clientY;
    hbDragStartPanX = hbPanX;
    hbDragStartPanY = hbPanY;
});

window.addEventListener("mousemove", (e) => {
    if (!hbIsDragging) return;
    hbPanX = hbDragStartPanX + (e.clientX - hbDragStartX);
    hbPanY = hbDragStartPanY + (e.clientY - hbDragStartY);
    hbApplyZoom();
});

window.addEventListener("mouseup", () => {
    hbIsDragging = false;
});

hbPanOverlay.addEventListener("touchstart", (e) => {
    if (!hbPanMode || hbZoom <= 1 || e.touches.length !== 1) return;
    hbIsDragging = true;
    hbDragStartX = e.touches[0].clientX;
    hbDragStartY = e.touches[0].clientY;
    hbDragStartPanX = hbPanX;
    hbDragStartPanY = hbPanY;
});

hbPanOverlay.addEventListener("touchmove", (e) => {
    if (!hbIsDragging || e.touches.length !== 1) return;
    hbPanX = hbDragStartPanX + (e.touches[0].clientX - hbDragStartX);
    hbPanY = hbDragStartPanY + (e.touches[0].clientY - hbDragStartY);
    hbApplyZoom();
});

hbPanOverlay.addEventListener("touchend", () => {
    hbIsDragging = false;
});

hbPanOverlay.addEventListener("touchcancel", () => {
    hbIsDragging = false;
});

hbZoomInBtn.addEventListener("click", () => {
    hbZoom = Math.min(5, hbZoom + 0.5);
    hbApplyZoom();
});

hbZoomOutBtn.addEventListener("click", () => {
    hbZoom = Math.max(0.5, hbZoom - 0.5);
    hbApplyZoom();
});

hbZoomResetBtn.addEventListener("click", hbResetZoom);

// Scroll-wheel zoom on wrapper
hyperbeamWrapper.addEventListener("wheel", (e) => {
    const delta = -e.deltaY * 0.002;
    const prev = hbZoom;
    hbZoom = Math.max(0.5, Math.min(hbZoom + delta, 5));
    if (hbZoom !== prev) {
        e.preventDefault();
        hbApplyZoom();
    }
}, { passive: false });

// Show zoom controls when session starts
// Visibility handled in hyperbeam:session and hyperbeam:ended

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

const minimizeCallBtn = document.getElementById("minimizeCallBtn");
const maximizeCallBtn = document.getElementById("maximizeCallBtn");
const closeCallBtn    = document.getElementById("closeCallBtn");
const endCallBtn      = document.getElementById("endCallBtn");

let isMinimized = false;
let isMaximized = false;
let preMaxState = { left: null, top: null };

minimizeCallBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isMaximized) return;
    isMinimized = !isMinimized;
    callPanel.classList.toggle("minimized", isMinimized);
    minimizeCallBtn.title = isMinimized ? "Restore" : "Minimize";
    minimizeCallBtn.style.background = isMinimized ? "#94a3b8" : "#fbbf24";
});

maximizeCallBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isMinimized) {
        isMinimized = false;
        callPanel.classList.remove("minimized");
    }
    isMaximized = !isMaximized;
    if (isMaximized) {
        preMaxState = { left: callPanel.style.left, top: callPanel.style.top };
        callPanel.classList.add("maximized");
        callPanel.classList.remove("expanded");
        maximizeCallBtn.title = "Restore";
        maximizeCallBtn.textContent = "⧉";
    } else {
        callPanel.classList.remove("maximized");
        if (preMaxState.left) callPanel.style.left = preMaxState.left;
        if (preMaxState.top)  callPanel.style.top  = preMaxState.top;
        maximizeCallBtn.title = "Maximize";
        maximizeCallBtn.textContent = "□";
    }
});

closeCallBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeCallPanel();
});

endCallBtn.addEventListener("click", () => {
    if (inCall) leaveCall();
    else if (isCalling) cancelCall();
});

callPanelHeader.addEventListener("click", (e) => {
    if (e.target === minimizeCallBtn || e.target === maximizeCallBtn || e.target === closeCallBtn) return;
    if (dragged) { dragged = false; return; }
    if (isMinimized || isMaximized) return;
    callExpanded = !callExpanded;
    callPanel.classList.toggle("expanded", callExpanded);
});

let dragged   = false;
let dragStartX = 0, dragStartY = 0;
let panelStartX = 0, panelStartY = 0;
let isDragging = false;

callPanelHeader.addEventListener("mousedown", startDrag);
callPanelHeader.addEventListener("touchstart", startDrag, { passive: false });

function startDrag(e) {
    const target = e.target;
    if (target === minimizeCallBtn || target === maximizeCallBtn || target === closeCallBtn) return;
    if (e.cancelable) e.preventDefault();
    isDragging = true;
    dragged    = false;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = callPanel.getBoundingClientRect();

    dragStartX  = clientX;
    dragStartY  = clientY;
    panelStartX = rect.left;
    panelStartY = rect.top;

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

    const rect   = callPanel.getBoundingClientRect();
    const newLeft = Math.max(0, Math.min(window.innerWidth  - rect.width,  panelStartX + dx));
    const newTop  = Math.max(0, Math.min(window.innerHeight - rect.height, panelStartY + dy));

    callPanel.style.left = newLeft + "px";
    callPanel.style.top  = newTop  + "px";
}

function stopDrag() {
    isDragging = false;
    dragged    = false;
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
    inCall = true;
    updateEndCallBtn();
    try {
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 20 } }, audio: true });
        const existingTile = document.getElementById("tile-" + socket.id);
        if (existingTile) {
            existingTile.querySelector("video").srcObject = localStream;
        } else {
            addVideoTile(socket.id, username.value, localStream, true);
        }
        micEnabled = true;
        cameraEnabled = true;
        updateMicUI();
        updateCameraUI();
        joinCallBtn.textContent = "✅ In Call";
        joinCallBtn.classList.remove("active");
        joinCallBtn.classList.add("in-call-state");
        joinCallBtn.disabled = true;
        callBtn.classList.add("in-call");

        Object.values(peers).forEach(pc => {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        });

        socket.emit("call:join", username.value);
    } catch(e) {
        inCall = false;
        leaveCall();
        alert("Camera/mic access denied. Please allow permissions and try again.");
        console.error(e);
    }
}

joinCallBtn.addEventListener("click", async () => {
    if (inCall) return;
    if (isCalling) { cancelCall(); return; }
    startCalling();
});

function leaveCall() {
    if (!inCall) return;
    inCall = false;
    joinCallBtn.textContent = "📹 Call";
    joinCallBtn.classList.remove("active", "in-call-state");
    joinCallBtn.disabled = false;
    updateEndCallBtn();

    Object.values(peers).forEach(pc => pc.close());
    peers = {};

    callVideos.querySelectorAll(".call-video-tile").forEach(el => {
        if (el.dataset.socketId !== socket.id) el.remove();
    });
    callPipRow.querySelectorAll(".call-pip-tile").forEach(el => {
        if (el.dataset.socketId !== socket.id) el.remove();
    });
    callBtn.classList.remove("in-call");
    micEnabled    = true;
    cameraEnabled = true;
    toggleMicBtn.textContent    = "🎤";
    toggleCameraBtn.textContent = "📷";
    toggleMicBtn.classList.remove("muted", "danger");
    toggleCameraBtn.classList.remove("muted", "danger");

    socket.emit("call:leave");
}

// ── Audio controls ─────────────────────────────────
function updateMicUI() {
    toggleMicBtn.textContent = micEnabled ? "🎤" : "🔇";
    toggleMicBtn.classList.toggle("muted", !micEnabled);
    toggleMicBtn.title = micEnabled ? "Mute" : "Unmute";
    const icon = document.getElementById("tile-" + socket.id)?.querySelector(".tile-muted");
    if (icon) icon.textContent = micEnabled ? "" : "🔇";
}
toggleMicBtn.addEventListener("click", () => {
    if (!localStream) return;
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
    updateMicUI();
});



// ── Video controls ─────────────────────────────────
function updateCameraUI() {
    toggleCameraBtn.textContent = cameraEnabled ? "📷" : "🚫";
    toggleCameraBtn.title = cameraEnabled ? "Stop Video" : "Start Video";
    toggleCameraBtn.classList.toggle("danger", !cameraEnabled);
    const tile = document.getElementById("tile-" + socket.id);
    if (tile) tile.classList.toggle("no-video", !cameraEnabled);
}
toggleCameraBtn.addEventListener("click", () => {
    if (!localStream) return;
    cameraEnabled = !cameraEnabled;
    localStream.getVideoTracks().forEach(t => { t.enabled = cameraEnabled; });
    updateCameraUI();
});




function closeCallPanel() {
    if (isCalling) cancelCall();
    if (inCall) leaveCall();
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
        const localTile = document.getElementById("tile-" + socket.id);
        if (localTile) localTile.remove();
    }
    callPanel.classList.add("hidden");
    callPanel.classList.remove("minimized", "maximized", "expanded");
    isMinimized = false;
    isMaximized = false;
}

function addVideoTile(socketId, name, stream, isLocal) {
    removeVideoTile(socketId);
    const displayName = isLocal ? (name + " (You)") : name;

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

function createPeer(remoteSocketId, initiator) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peers[remoteSocketId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (e) => {
        const remoteStream = e.streams[0];
        const existingTile = document.getElementById("tile-" + remoteSocketId);
        if (existingTile) {
            existingTile.querySelector("video").srcObject = remoteStream;
        }
        const existingPip = document.getElementById("pip-" + remoteSocketId);
        if (existingPip) {
            existingPip.querySelector("video").srcObject = remoteStream;
        }
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("call:ice-candidate", { to: remoteSocketId, candidate: e.candidate });
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            removeVideoTile(remoteSocketId);
            delete peers[remoteSocketId];
            updateEndCallBtn();
        }
    };

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

socket.on("call:existing-users", (users) => {
    users.forEach(({ socketId, username: name }) => {
        addVideoTile(socketId, name, new MediaStream(), false);
        createPeer(socketId, true);
    });
    updateEndCallBtn();
});

socket.on("call:user-joined", ({ socketId, username: name }) => {
    if (!inCall) return;
    addVideoTile(socketId, name, new MediaStream(), false);
    createPeer(socketId, false);
    updateEndCallBtn();
});

socket.on("call:offer", async ({ from, offer }) => {
    if (!inCall) return;
    let pc = peers[from];
    if (!pc) pc = createPeer(from, false);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("call:answer", { to: from, answer: pc.localDescription });
});

socket.on("call:answer", async ({ from, answer }) => {
    const pc = peers[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("call:ice-candidate", async ({ from, candidate }) => {
    const pc = peers[from];
    if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch(e) { console.error("ICE error:", e); }
    }
});

socket.on("call:user-left", (socketId) => {
    removeVideoTile(socketId);
    if (peers[socketId]) {
        peers[socketId].close();
        delete peers[socketId];
    }
    if (inCall && Object.keys(peers).length === 0) {
        inCall = false;
        joinCallBtn.textContent = "📹 Call";
        joinCallBtn.classList.remove("active", "in-call-state");
        joinCallBtn.disabled = false;
        callBtn.classList.remove("in-call");
    }
    updateEndCallBtn();
});

socket.on("call:participants", (count) => {
    callCount.textContent = count + " in call";
});

socket.on("call:incoming", ({ from, username: name }) => {
    if (incomingCallFrom) return;
    if (inCall) {
        if (Object.keys(peers).length > 0) return;
        leaveCall();
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
    if (!inCall) {
        inCall = true;
        joinCallBtn.textContent = "✅ In Call";
        joinCallBtn.classList.remove("active");
        joinCallBtn.classList.add("in-call-state");
        joinCallBtn.disabled = true;
        callBtn.classList.add("in-call");
        socket.emit("call:join", username.value);
    }
    updateEndCallBtn();
});

socket.on("call:rejected", ({ socketId, username: name }) => {
    if (!isCalling) return;
    joinCallBtn.textContent = "❌ " + name + " declined";
    setTimeout(() => { if (isCalling) cancelCall(); }, 2000);
});




