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
    socket.emit("room:create", { name, roomName, password: createRoomPassword.value });
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
        socket.emit("room:join", { roomId, name, password: pw });
    } else {
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
        const ul = document.getElementById("users");
        ul.innerHTML = "";
        users.forEach(({ id, username: name }) => {
            const li = document.createElement("li");
            li.innerHTML = "<span>🟢 " + name + "</span>";
            if (admin && id !== socket.id) {
                const kickBtn = document.createElement("button");
                kickBtn.className = "kick-btn";
                kickBtn.textContent = "✕";
                kickBtn.title = "Kick " + name;
                kickBtn.addEventListener("click", () => {
                    if (confirm("Kick " + name + "?")) socket.emit("auth:kick", id);
                });
                li.appendChild(kickBtn);
            }
            ul.appendChild(li);
        });
    }

    // Unlock chat
    document.getElementById("input").disabled = false;
    document.getElementById("emojiBtn").disabled = false;
    document.querySelector("#form button[type='submit']").disabled = false;
    document.getElementById("input").focus();

    // Reset video state for fresh join
    currentVideoId = null;
    queueList = [];
    renderQueue();
});

// ── Room ended ──
socket.on("room:ended", () => {
    goToLobby("Room ended by admin");
});

// ── Leave room button (top menu) ──
function goToLobby(msg) {
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
    goToLobby("Disconnected from server");
});

socket.on("connect", () => {
    // Clean up stale room from previous session if room:leave didn't arrive
    if (lastRoomId) {
        socket.emit("room:leave", { roomId: lastRoomId });
        lastRoomId = null;
    }
    if (!lobby.classList.contains("hidden")) return;
    // Reconnected while in a room — go back to lobby
    goToLobby("Reconnected");
});

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
    showLobbyError(msg);
    setTimeout(() => showLobbyError(""), 3000);
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
socket.on("users", (userList) => {
    if (!usersList) return;
    usersList.innerHTML = "";
    userList.forEach(({ id, username: name }) => {
        const li = document.createElement("li");
        li.innerHTML = "<span>🟢 " + name + "</span>";
        if (isAdmin && id !== socket.id) {
            const kickBtn = document.createElement("button");
            kickBtn.className = "kick-btn";
            kickBtn.textContent = "✕";
            kickBtn.title = "Kick " + name;
            kickBtn.addEventListener("click", () => {
                if (confirm("Kick " + name + "?")) socket.emit("auth:kick", id);
            });
            li.appendChild(kickBtn);
        }
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
        if (searchInput.value.trim()) searchGiphy(searchInput.value.trim(), resultsEl);
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
            data.results.forEach(g => {
                const img = document.createElement("img");
                img.src = g.url;
                img.loading = "lazy";
                img.addEventListener("click", () => {
                    socket.emit("chat message", { user: username.value, msg: "", gif: g.chat });
                    gifPicker.classList.add("hidden");
                    vgifPicker.classList.add("hidden");
                });
                resultsEl.appendChild(img);
            });
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
    gifSearchTimer = setTimeout(() => {
        if (gifSearch.value.trim()) searchGiphy(gifSearch.value.trim(), gifResults);
        else { gifResults.innerHTML = ""; gifResults.classList.add("gif-results-empty"); }
    }, 400);
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
    gifSearchTimer = setTimeout(() => {
        if (vgifSearch.value.trim()) searchGiphy(vgifSearch.value.trim(), vgifResults);
        else { vgifResults.innerHTML = ""; vgifResults.classList.add("gif-results-empty"); }
    }, 400);
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



// ── YouTube Player ────────────────────────────────
let player           = null;
let playerReady      = false;
let pendingVideoId   = null;
let pendingSeekTime  = null;
let pendingPaused    = false;
let currentVideoId   = null;

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
    videoStatus.textContent = "⚠️ Blocked — try another video";
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
    videoStatus.textContent = title ? ("🎬 " + title) : "🎬 Watching together!";
    socket.emit("video:load", videoId);
    setTimeout(() => videoInput.focus(), 300);
}

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

// ── Socket sync ──────────────────────────────────
socket.on("room:state", (state) => {
    if (!state.videoId) return;
    openVideoPanel();
    playVideoById(state.videoId, state.time, !state.playing);
    videoStatus.textContent = "🎬 Synced with room!";
});

socket.on("video:load", (videoId) => {
    openVideoPanel();
    playVideoById(videoId, 0, false);
    videoStatus.textContent = "🎬 Watching together!";
});

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

socket.on("video:queue-update", (q) => {
    queueList = q;
    renderQueue();
});

socket.on("video:next-playing", (title) => {
    videoStatus.textContent = "▶️ " + title;
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
const callCount       = document.getElementById("callCount");
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
    if (isCalling) cancelCall();
    if (inCall) leaveCall();
    callPanel.classList.add("hidden");
    callPanel.classList.remove("minimized", "maximized", "expanded");
    isMinimized = false;
    isMaximized = false;
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
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 20 } }, audio: true });
        joinCallBtn.textContent = "✅ In Call";
        joinCallBtn.classList.remove("active");
        joinCallBtn.classList.add("in-call-state");
        joinCallBtn.disabled = true;
        callBtn.classList.add("in-call");

        addVideoTile(socket.id, username.value, localStream, true);

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

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    Object.values(peers).forEach(pc => pc.close());
    peers = {};

    callVideos.innerHTML = "";
    callPipRow.innerHTML = "";

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
});

socket.on("call:user-joined", ({ socketId, username: name }) => {
    if (!inCall) return;
    addVideoTile(socketId, name, new MediaStream(), false);
    createPeer(socketId, false);
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
    joinCallBtn.textContent = "✅ " + name + " joined";
    joinCallBtn.classList.remove("active");
    if (!inCall) setTimeout(() => joinCall(), 600);
});

socket.on("call:rejected", ({ socketId, username: name }) => {
    if (!isCalling) return;
    joinCallBtn.textContent = "❌ " + name + " declined";
    setTimeout(() => { if (isCalling) cancelCall(); }, 2000);
});
