const socket        = io();
const form          = document.getElementById("form");
const input         = document.getElementById("input");
const username      = document.getElementById("username");
const chat          = document.getElementById("chat");
const usersList     = document.getElementById("users");
let   isAdmin       = false;



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
        div.innerHTML = `
            <div>
                <div class="room-list-name">${r.id}</div>
                <div class="room-list-meta">${r.userCount} user${r.userCount !== 1 ? 's' : ''}</div>
            </div>
            ${r.hasPassword ? '<span class="room-list-pw">🔒</span>' : ''}
        `;
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
        const ul = document.getElementById("users");
        ul.innerHTML = "";
        users.forEach(({ id, username: name }) => {
            roomUsersMap[id] = name;
            const li = document.createElement("li");
            li.innerHTML = "<span>🟢 " + name + "</span>";
            if (admin && id !== socket.id) {
                const kickBtn = document.createElement("button");
                kickBtn.className = "kick-btn";
                kickBtn.textContent = "✕";
                kickBtn.title = name;
                kickBtn.addEventListener("click", () => {
                    if (confirm("Kick " + name + "?")) socket.emit("auth:kick", id);
                });
                li.appendChild(kickBtn);
            }
            ul.appendChild(li);
        });
        ppCount.textContent = users.length;
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
    callPanel.classList.add("hidden");
    app.classList.add("hidden");
    lobby.classList.remove("hidden");
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "Create Room";
    if (currentRoomId) {
        intentionalLeave = true;
        lastRoomId = currentRoomId;
        socket.emit("room:leave");
        currentRoomId = null;
    }
    isAdmin = false;
    handRaised = false;
    document.getElementById("adminSection").classList.add("hidden");
    document.querySelector(".online-section h3").textContent = "Online";
    document.getElementById("users").innerHTML = "";
    document.getElementById("chat").innerHTML = "";
    participantsPanel.classList.add("hidden");
    micSettings.classList.add("hidden");
    camSettings.classList.add("hidden");
    endMeetingDropdown.classList.add("hidden");
    renameModal.classList.add("hidden");
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
            goToLobby("Connection lost");
        }
    }, 10000);
});

socket.on("connect", () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    if (disconnected && currentRoomId && username.value) {
        disconnected = false;
        showReconnectingBanner(false);
        socket.emit("room:join", { roomId: currentRoomId, name: username.value, password: currentRoomPassword });
        return;
    }

    if (lastRoomId) {
        socket.emit("room:leave", { roomId: lastRoomId });
        lastRoomId = null;
    }
    if (!lobby.classList.contains("hidden")) return;
    goToLobby("Reconnected");
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
        setTimeout(() => showLobbyError(""), 3000);
        return;
    }
    disconnected = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    showReconnectingBanner(false);
    goToLobby(msg);
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
    const msgText = input.value.trim();
    if ((!msgText && !pendingImage) || !username.value.trim()) return;

    if (pendingImage) {
        uploadImage(pendingImage).then(url => {
            if (url) {
                socket.emit("chat message", { user: username.value, msg: msgText, image: url });
            }
            clearPending("main");
        });
    } else {
        socket.emit("chat message", { user: username.value, msg: msgText });
    }
    input.value = "";
    socket.emit("stop typing");
    emojiPicker.classList.add("hidden");
});
function appendMessage(data, container) {
    const div = document.createElement("div");
    div.classList.add("message");
    if (data.user === username.value) div.classList.add("self");
    else if (container === chat) playNotification();
    let html = "<strong>" + data.user + "</strong>" + data.msg;
    if (data.image) html += '<img class="message-media" src="' + data.image + '" onclick="window.open(this.src)" loading="lazy" />';
    if (data.gif) html += '<img class="message-media" src="' + data.gif + '" loading="lazy" />';
    div.innerHTML = html;
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
let roomUsersMap = {};
socket.on("users", (userList) => {
    roomUsersMap = {};
    userList.forEach(({ id, username: name }) => { roomUsersMap[id] = name; });
    if (!usersList) return;
    usersList.innerHTML = "";
    userList.forEach(({ id, username: name }) => {
        const li = document.createElement("li");
        li.innerHTML = "<span>🟢 " + name + "</span>";
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
    if (!participantsPanel.classList.contains("hidden")) {
        updateParticipantsList();
    }
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
    if (opening) {
        searchInput.focus();
        searchInput.select();
        searchGiphy(searchInput.value.trim() || "trending", resultsEl);
    }
}

function searchGiphy(query, resultsEl) {
    resultsEl.innerHTML = '<div class="gif-loading">Searching...</div>';
    resultsEl.classList.remove("gif-results-empty");
    fetch("/api/gif-search?q=" + encodeURIComponent(query))
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
                    socket.emit("chat message", { user: username.value, msg: "", gif: g.chat });
                    gifPicker.classList.add("hidden");
                    vgifPicker.classList.add("hidden");
                });
                frag.appendChild(el);
            });
            resultsEl.appendChild(frag);
        })
        .catch(() => {
            resultsEl.innerHTML = '<div class="gif-loading">Search failed</div>';
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
    return fetch("/upload", { method: "POST", body: formData })
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
    } else {
        vpendingImage = null;
        vattachPreview.classList.add("hidden");
        vattachPreviewImg.src = "";
        vimageBtn.textContent = "📷";
        vimageBtn.style.background = "";
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
    if (isV) {
        vpendingImage = file;
        showPreview(file, vattachPreview, vattachPreviewImg, vimageBtn);
    } else {
        pendingImage = file;
        showPreview(file, attachPreview, attachPreviewImg, imageBtn);
    }
}

document.addEventListener("paste", (e) => {
    const target = e.target;
    if (target !== input && target !== vinput) return;
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



// ── Picture-in-Picture Background Playback ──────
let pipVideo = null;
let pipActive = false;
let pipLeaveTime = 0;

function isPipSupported() {
    return 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
}

async function enterPip(videoId, currentTime) {
    if (!isPipSupported() || pipActive) return;
    try {
        const resp = await fetch(`/api/video-stream?videoId=${videoId}`);
        const data = await resp.json();
        if (!data.url) { console.warn("PiP: no stream URL"); return; }

        pipVideo = document.createElement("video");
        pipVideo.src = data.url;
        pipVideo.currentTime = currentTime;
        pipVideo.muted = false;
        pipVideo.playsInline = true;
        pipVideo.style.display = "none";
        pipVideo.setAttribute("playsinline", "");
        pipVideo.setAttribute("webkit-playsinline", "");
        document.body.appendChild(pipVideo);

        await pipVideo.play();
        pipLeaveTime = currentTime;

        setTimeout(async () => {
            if (pipVideo && !pipVideo.paused && isPipSupported()) {
                try {
                    await pipVideo.requestPictureInPicture();
                    pipActive = true;
                } catch(e) { console.warn("PiP request failed:", e); }
            }
        }, 300);
    } catch(e) { console.warn("PiP enter error:", e); if (pipVideo) { pipVideo.remove(); pipVideo = null; } }
}

async function exitPip() {
    let time = null;
    try {
        if (document.pictureInPictureElement && pipVideo) {
            await document.exitPictureInPicture();
        }
    } catch(e) {}
    if (pipVideo) {
        time = pipVideo.currentTime;
        pipVideo.pause();
        pipVideo.remove();
        pipVideo = null;
    }
    pipActive = false;
    return time;
}

function updateMediaSession(title) {
    if (!("mediaSession" in navigator)) return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title || "Huba Huba",
            artist: "Watch Together",
        });
        navigator.mediaSession.setActionHandler("play", () => {
            if (pipActive && pipVideo) { pipVideo.play(); }
            else if (player && playerReady) { player.playVideo(); }
        });
        navigator.mediaSession.setActionHandler("pause", () => {
            if (pipActive && pipVideo) { pipVideo.pause(); }
            else if (player && playerReady) { player.pauseVideo(); }
        });
    } catch(e) {}
}

document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
        if (player && playerReady && player.getPlayerState() === YT.PlayerState.PLAYING) {
            const ct = player.getCurrentTime();
            enterPip(currentVideoId, ct);
        }
    } else {
        const time = await exitPip();
        if (time && player && playerReady) {
            stopSyncInterval();
            player.seekTo(time, true);
            if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
                setPendingRemotePlay();
                player.playVideo();
            }
            setTimeout(() => {
                if (player && playerReady && player.getPlayerState() === YT.PlayerState.PLAYING) {
                    startSyncInterval();
                    socket.emit("video:sync", time);
                }
            }, 500);
        }
    }
});

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
    videoPanel.classList.remove("hidden");
    contentArea.classList.add("video-open");
    if (inCall) callPanel.classList.add("hidden");
}
function closeVideoPanel() {
    videoPanel.classList.add("hidden");
    contentArea.classList.remove("video-open");
    searchResults.classList.add("hidden");
    hideBlockedMessage();
    if (inCall) callPanel.classList.remove("hidden");
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
            "<span class='queue-item-title'>" + (item.title || item.videoId) + "</span>" +
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
    playVideoById(state.videoId, state.time, !state.playing);
    videoStatusText.textContent = "🎬 Synced with room!";
});

socket.on("video:load", (videoId) => {
    openVideoPanel();
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

    if (vpendingImage) {
        uploadImage(vpendingImage).then(url => {
            if (url) {
                socket.emit("chat message", { user: username.value, msg: msgText, image: url });
            }
            clearPending("video");
        });
    } else {
        socket.emit("chat message", { user: username.value, msg: msgText });
    }
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
const joinCallBtn     = document.getElementById("joinCallBtn");
const toggleMicBtn    = document.getElementById("toggleMicBtn");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");
const micArrow        = document.getElementById("micArrow");
const camArrow        = document.getElementById("camArrow");
const micSettings     = document.getElementById("micSettings");
const camSettings     = document.getElementById("camSettings");
const micSelect       = document.getElementById("micSelect");
const camSelect       = document.getElementById("camSelect");
const testSpeakerBtn  = document.getElementById("testSpeakerBtn");
const noiseSuppressionToggle = document.getElementById("noiseSuppressionToggle");
const bgOptions       = document.getElementById("bgOptions");
const videoFilterSelect = document.getElementById("videoFilterSelect");
const participantsBtn = document.getElementById("participantsBtn");
const participantsPanel = document.getElementById("participantsPanel");
const participantsList = document.getElementById("participantsList");
const ppCount         = document.getElementById("ppCount");
const closeParticipantsBtn = document.getElementById("closeParticipantsBtn");
const raiseHandBtn    = document.getElementById("raiseHandBtn");
const renameBtn       = document.getElementById("renameBtn");
const renameModal     = document.getElementById("renameModal");
const renameInput     = document.getElementById("renameInput");
const renameCancelBtn = document.getElementById("renameCancelBtn");
const renameSaveBtn   = document.getElementById("renameSaveBtn");
const endMeetingArrow = document.getElementById("endMeetingArrow");
const endMeetingDropdown = document.getElementById("endMeetingDropdown");
const leaveMeetingBtn = document.getElementById("leaveMeetingBtn");
const endForAllBtn    = document.getElementById("endForAllBtn");
const callPanelHeader = document.getElementById("callPanelHeader");
const appEl           = document.querySelector(".app");
let   callExpanded    = false;
let   isCalling       = false;
let   incomingCallFrom = null;
let   callRingTimeout  = null;

let handRaised = false;
let selectedBg = "none";
let selectedFilter = "none";
let availableMics = [];
let availableCams = [];

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
        applyBgAndFilter();
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
    applyBgAndFilter();
    const localVid = document.querySelector("#tile-" + socket.id + " video");
    if (localVid) openPip(localVid);
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
    videoPanel.classList.contains("hidden") ? openVideoPanel() : closeVideoPanel();
});

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
        applyBgAndFilter();
        const localVid2 = document.querySelector("#tile-" + socket.id + " video");
        if (localVid2) openPip(localVid2);
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
    closePip();
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

// ── Audio device enumeration ──────────────────────
async function enumerateAudioDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        availableMics = devices.filter(d => d.kind === "audioinput");
        micSelect.innerHTML = "";
        availableMics.forEach((d, i) => {
            const opt = document.createElement("option");
            opt.value = d.deviceId;
            opt.textContent = d.label || "Microphone " + (i + 1);
            if (d.deviceId === "default" || i === 0) opt.selected = true;
            micSelect.appendChild(opt);
        });
    } catch(e) { console.warn("Could not enumerate audio devices"); }
}

micSelect.addEventListener("change", async () => {
    if (!inCall || !localStream) return;
    const deviceId = micSelect.value;
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: deviceId ? { exact: deviceId } : undefined, noiseSuppression: noiseSuppressionToggle.checked }
        });
        const oldTrack = localStream.getAudioTracks()[0];
        if (oldTrack) {
            localStream.removeTrack(oldTrack);
            oldTrack.stop();
        }
        const newTrack = newStream.getAudioTracks()[0];
        if (newTrack) {
            newTrack.enabled = micEnabled;
            localStream.addTrack(newTrack);
            Object.values(peers).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === "audio");
                if (sender) sender.replaceTrack(newTrack);
            });
        }
    } catch(e) { console.warn("Failed to switch mic:", e); }
});

testSpeakerBtn.addEventListener("click", () => {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.type = "sine";
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1);
        osc.start();
        osc.stop(audioCtx.currentTime + 1);
        setTimeout(() => { try { audioCtx.close(); } catch(e) {} }, 1500);
    } catch(e) {}
});

noiseSuppressionToggle.addEventListener("change", () => {
    if (micSelect.value) micSelect.dispatchEvent(new Event("change"));
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

// ── Video device enumeration ──────────────────────
async function enumerateVideoDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        availableCams = devices.filter(d => d.kind === "videoinput");
        camSelect.innerHTML = "";
        availableCams.forEach((d, i) => {
            const opt = document.createElement("option");
            opt.value = d.deviceId;
            opt.textContent = d.label || "Camera " + (i + 1);
            if (d.deviceId === "default" || i === 0) opt.selected = true;
            camSelect.appendChild(opt);
        });
    } catch(e) { console.warn("Could not enumerate video devices"); }
}

camSelect.addEventListener("change", async () => {
    if (!inCall || !localStream) return;
    const deviceId = camSelect.value;
    try {
        const constraints = {
            video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 20 } }
        };
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        const oldTrack = localStream.getVideoTracks()[0];
        if (oldTrack) {
            localStream.removeTrack(oldTrack);
            oldTrack.stop();
        }
        const newTrack = newStream.getVideoTracks()[0];
        if (newTrack) {
            newTrack.enabled = cameraEnabled;
            localStream.addTrack(newTrack);
            Object.values(peers).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
                if (sender) sender.replaceTrack(newTrack);
            });
            const tile = document.getElementById("tile-" + socket.id);
            if (tile) {
                const video = tile.querySelector("video");
                if (video) video.srcObject = localStream;
            }
            const pip = document.getElementById("pip-" + socket.id);
            if (pip) {
                const pv = pip.querySelector("video");
                if (pv) pv.srcObject = localStream;
            }
            applyBgAndFilter();
        }
    } catch(e) { console.warn("Failed to switch camera:", e); }
});

// ── Virtual Backgrounds ──────────────────────────
function applyBgAndFilter() {
    const tile = document.getElementById("tile-" + socket.id);
    if (!tile) return;
    tile.classList.remove("bg-blur", "bg-color", "bg-image", "filter-grayscale", "filter-sepia", "filter-invert", "filter-vintage");
    if (selectedBg === "blur") tile.classList.add("bg-blur");
    else if (selectedBg === "color") tile.classList.add("bg-color");
    else if (selectedBg === "image") {
        tile.classList.add("bg-image");
        tile.style.backgroundImage = "url('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=640')";
    }
    if (selectedFilter !== "none") tile.classList.add("filter-" + selectedFilter);
}

bgOptions.addEventListener("click", (e) => {
    const btn = e.target.closest(".bg-opt");
    if (!btn) return;
    bgOptions.querySelectorAll(".bg-opt").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedBg = btn.dataset.bg;
    applyBgAndFilter();
});

videoFilterSelect.addEventListener("change", () => {
    selectedFilter = videoFilterSelect.value;
    applyBgAndFilter();
});

// ── Participants Panel ───────────────────────────
function openParticipantsPanel() {
    micSettings.classList.add("hidden");
    camSettings.classList.add("hidden");
    endMeetingDropdown.classList.add("hidden");
    participantsPanel.classList.toggle("hidden");
    if (!participantsPanel.classList.contains("hidden")) {
        updateParticipantsList();
    }
}

closeParticipantsBtn.addEventListener("click", () => participantsPanel.classList.add("hidden"));

function updateParticipantsList() {
    const entries = Object.entries(roomUsersMap);
    participantsList.innerHTML = "";
    entries.forEach(([id, name]) => {
        const div = document.createElement("div");
        div.className = "pp-item";
        const isLocal = id === socket.id;
        const nameSpan = document.createElement("span");
        nameSpan.className = "pp-name";
        nameSpan.textContent = isLocal ? name + " (You)" : name;
        div.appendChild(nameSpan);
        if (isLocal && handRaised) {
            const badge = document.createElement("span");
            badge.className = "pp-badge";
            badge.textContent = "✋";
            div.appendChild(badge);
        }
        if (isAdmin && id === socket.id) {
            const badge = document.createElement("span");
            badge.className = "pp-host-badge";
            badge.textContent = "Host";
            div.appendChild(badge);
        }
        if (isAdmin && !isLocal) {
            const actions = document.createElement("div");
            actions.className = "pp-host-actions";
            const muteBtn = document.createElement("button");
            muteBtn.textContent = "🔇";
            muteBtn.title = "Mute " + name;
            muteBtn.addEventListener("click", () => socket.emit("participants:host-mute", id));
            actions.appendChild(muteBtn);
            const stopVidBtn = document.createElement("button");
            stopVidBtn.textContent = "📷";
            stopVidBtn.title = "Stop video for " + name;
            stopVidBtn.addEventListener("click", () => socket.emit("participants:host-stop-video", id));
            actions.appendChild(stopVidBtn);
            const kickBtn = document.createElement("button");
            kickBtn.textContent = "✕";
            kickBtn.className = "danger";
            kickBtn.title = name;
            kickBtn.addEventListener("click", () => {
                if (confirm("Kick " + name + "?")) socket.emit("auth:kick", id);
            });
            actions.appendChild(kickBtn);
            div.appendChild(actions);
        }
        participantsList.appendChild(div);
    });
    ppCount.textContent = entries.length;
}

// ── Raise Hand ───────────────────────────────────
raiseHandBtn.addEventListener("click", () => {
    socket.emit("participants:raise-hand");
});

socket.on("participants:hand-status", ({ socketId, raised }) => {
    if (socketId === socket.id) {
        handRaised = raised;
        raiseHandBtn.textContent = raised ? "✋ Lower Hand" : "✋ Raise Hand";
        raiseHandBtn.classList.toggle("active", raised);
    }
    if (!participantsPanel.classList.contains("hidden")) {
        updateParticipantsList();
    }
});

// ── Rename ───────────────────────────────────────
renameBtn.addEventListener("click", () => {
    renameInput.value = username.value;
    renameInput.dataset.targetId = "";
    renameModal.classList.remove("hidden");
    setTimeout(() => renameInput.focus(), 100);
});

renameCancelBtn.addEventListener("click", () => renameModal.classList.add("hidden"));
renameSaveBtn.addEventListener("click", () => {
    const newName = renameInput.value.trim();
    if (newName && newName.length <= 30) {
        const targetId = renameInput.dataset.targetId || "";
        socket.emit("participants:rename", { socketId: targetId, newName });
        if (!targetId) username.value = newName;
    }
    renameModal.classList.add("hidden");
});
renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") renameSaveBtn.click();
});

// ── Host mute/stop-video handlers ────────────────
socket.on("participants:host-muted", () => {
    if (!inCall || !localStream) return;
    micEnabled = false;
    localStream.getAudioTracks().forEach(t => { t.enabled = false; });
    updateMicUI();
    alert("Host has muted you");
});

socket.on("participants:host-stopped-video", () => {
    if (!inCall || !localStream) return;
    cameraEnabled = false;
    localStream.getVideoTracks().forEach(t => { t.enabled = false; });
    updateCameraUI();
    alert("Host has stopped your video");
});

// ── End Meeting ──────────────────────────────────
leaveMeetingBtn.addEventListener("click", () => {
    endMeetingDropdown.classList.add("hidden");
    if (inCall) leaveCall();
    closeCallPanel();
});

endForAllBtn.addEventListener("click", () => {
    endMeetingDropdown.classList.add("hidden");
    if (confirm("End the meeting for everyone?")) {
        if (inCall) leaveCall();
        socket.emit("room:end");
    }
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
    participantsPanel.classList.add("hidden");
    renameModal.classList.add("hidden");
}

// ── Close settings dropdowns on outside click ────
document.addEventListener("click", (e) => {
    if (!participantsPanel.contains(e.target)) {
        participantsPanel.classList.add("hidden");
    }
});

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

    if (!isLocal) switchPipToRemote();
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
        switchPipToRemote();
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

// ── Picture-in-Picture (keep video playing when tab is hidden) ──────
let pipRequested = false;
function openPip(videoEl) {
    if (!document.pictureInPictureEnabled || document.pictureInPictureElement) return;
    videoEl.requestPictureInPicture().then(() => { pipRequested = true; }).catch(() => {});
}
function switchPipToRemote() {
    if (!pipRequested) return;
    const tiles = document.querySelectorAll(".call-video-tile, .call-pip-tile");
    for (const t of tiles) {
        if (t.id !== "tile-" + socket.id) {
            const remVid = t.querySelector("video");
            if (remVid && remVid.srcObject && remVid.srcObject.active) {
                remVid.requestPictureInPicture().then(() => { pipRequested = true; }).catch(() => {});
            }
            break;
        }
    }
}
function closePip() {
    pipRequested = false;
    if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
    }
}
// Re-request PiP when tab becomes hidden if it was closed
document.addEventListener("visibilitychange", () => {
    if (document.hidden && inCall && !document.pictureInPictureElement) {
        const tiles = document.querySelectorAll(".call-video-tile, .call-pip-tile");
        for (const t of tiles) {
            if (t.id !== "tile-" + socket.id) {
                const rv = t.querySelector("video");
                if (rv && rv.srcObject && rv.srcObject.active) {
                    rv.requestPictureInPicture().then(() => { pipRequested = true; }).catch(() => {});
                }
                break;
            }
        }
    }
});
