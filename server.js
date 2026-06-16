const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const multer     = require("multer");
const path       = require("path");
const fs         = require("fs");
const https      = require("https");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const GIPHY_API_KEY = process.env.GIPHY_KEY || "7ts8YUGRxPmmILiPdopADIpMekHL2Y4S";
const HB_API_KEY = process.env.HB_API_KEY;
const gifCache = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of gifCache) {
        if (now - entry.ts > 60000) gifCache.delete(key);
    }
}, 30000);

app.get("/api/gif-search", (req, res) => {
    const q = (req.query.q || "").trim().toLowerCase();
    if (!q) return res.json({ results: [], error: null });
    if (!GIPHY_API_KEY) return res.json({ results: [], error: "need_key" });

    const cached = gifCache.get(q);
    if (cached) return res.json(cached.data);

    const url = "https://api.giphy.com/v1/gifs/search?api_key=" + GIPHY_API_KEY + "&q=" + encodeURIComponent(q) + "&limit=10&rating=g";
    const gReq = https.get(url, (gRes) => {
        let data = "";
        gRes.on("data", chunk => data += chunk);
        gRes.on("end", () => {
            try {
                const json = JSON.parse(data);
                if (json.meta && json.meta.status === 401) {
                    return res.json({ results: [], error: "bad_key" });
                }
                const results = (json.data || []).map(g => ({
                    id: g.id,
                    url: g.images.preview_gif?.url || g.images.fixed_height_small.url,
                    mp4: g.images.fixed_width_small?.mp4 || g.images.preview?.mp4 || "",
                    chat: g.images.downsized.url,
                    original: g.images.original.url
                }));
                const out = { results, error: null };
                gifCache.set(q, { data: out, ts: Date.now() });
                res.json(out);
            } catch(e) { res.json({ results: [], error: null }); }
        });
    });
    gReq.setTimeout(8000, () => { gReq.destroy(); res.json({ results: [], error: null }); });
    gReq.on("error", () => res.json({ results: [], error: null }));
});

app.get("/api/video-stream", (req, res) => {
    const videoId = req.query.videoId;
    if (!videoId) return res.status(400).json({ error: "missing videoId" });
    // Use YouTube's video URL directly instead of ytdl-core (unreliable)
    res.json({ url: "https://www.youtube.com/watch?v=" + videoId });
});

app.post("/upload", upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    res.json({ url: "/uploads/" + req.file.filename });
});

const rooms = {};

function getRoom(socket) {
    return rooms[socket.roomId];
}

function cleanupDisconnectedUsers(room) {
    if (!room) return;
    Object.keys(room.users).forEach(id => {
        const sock = io.sockets.sockets.get(id);
        if (!sock || !sock.connected) {
            delete room.users[id];
            if (room.callUsers[id]) delete room.callUsers[id];
            room.admins.delete(id);
        }
    });
}

// Periodic cleanup of stale rooms
setInterval(() => {
    Object.keys(rooms).forEach(roomId => {
        const room = rooms[roomId];
        cleanupDisconnectedUsers(room);
        if (Object.keys(room.users).length === 0) {
            endHyperbeamSession(room);
            delete rooms[roomId];
        }
    });
}, 10000);

function endHyperbeamSession(room) {
    if (!room || !room.hyperbeam || !HB_API_KEY) return;
    const endReq = https.request({
        hostname: "engine.hyperbeam.com",
        path: "/v0/vm/" + room.hyperbeam.sessionId,
        method: "DELETE",
        headers: { "Authorization": "Bearer " + HB_API_KEY }
    });
    endReq.on("error", () => {});
    endReq.end();
    room.hyperbeam = null;
}

io.on("connection", (socket) => {
    socket.roomId = null;

    // ── Room management ──────────────────────────
    socket.on("room:list", () => {
        const list = Object.entries(rooms)
            .filter(([id, room]) => Object.keys(room.users).length > 0)
            .map(([id, room]) => ({
                id,
                userCount: Object.keys(room.users).length,
                hasPassword: !!room.roomPassword
            }));
        socket.emit("room:list", list);
    });

    socket.on("room:create", ({ name, roomName, password }) => {
        const roomId = (roomName || "").trim().toLowerCase().replace(/\s+/g, "-");
        const username = (name || "").trim();
        if (!roomId || !username) return;
        if (rooms[roomId]) {
            cleanupDisconnectedUsers(rooms[roomId]);
            if (Object.keys(rooms[roomId].users).length > 0) {
                socket.emit("auth:error", "Room name is taken");
                return;
            }
        }
        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: {},
                roomState: { videoId: null, playing: false, time: 0, updatedAt: Date.now() },
                queue: [],
                callUsers: {},
                roomPassword: "",
                admins: new Set(),
                loopEnabled: false,
                reactions: {},
                userStatus: {},
                hyperbeam: null
            };
        }
        const room = rooms[roomId];
        room.roomPassword = password || "";
        room.admins = new Set([socket.id]);
        room.users = {};
        room.roomState = { videoId: null, playing: false, time: 0, updatedAt: Date.now() };
        room.queue = [];
        room.callUsers = {};
        room.loopEnabled = false;
        room.reactions = {};
        room.userStatus = {};
        room.hyperbeam = null;

        socket.roomId = roomId;
        socket.join(roomId);
        room.users[socket.id] = username;

        socket.emit("room:joined", {
            roomId,
            isAdmin: true,
            hasPassword: !!room.roomPassword,
            username,
            users: Object.entries(room.users).map(([id, u]) => ({ id, username: u }))
        });
    });

    socket.on("room:join", ({ roomId, name, password }) => {
        const room = rooms[roomId];
        const username = (name || "").trim();
        if (!room) { socket.emit("auth:error", "Room not found"); return; }
        if (!username) return;
        if (room.roomPassword && password !== room.roomPassword) { socket.emit("auth:error", "Wrong password"); return; }

        socket.roomId = roomId;
        socket.join(roomId);
        room.users[socket.id] = username;

        if (!room.admins.size) {
            room.admins.add(socket.id);
        }

        const isAdmin = room.admins.has(socket.id);
        socket.emit("room:joined", {
            roomId,
            isAdmin,
            hasPassword: !!room.roomPassword,
            username,
            users: Object.entries(room.users).map(([id, u]) => ({ id, username: u }))
        });

        socket.to(roomId).emit("users", Object.entries(room.users).map(([id, u]) => ({ id, username: u })));
        socket.emit("auth:status", { hasPassword: !!room.roomPassword, isAdmin });

        if (room.roomState.videoId) {
            const elapsed = room.roomState.playing
                ? (Date.now() - room.roomState.updatedAt) / 1000
                : 0;
            const syncTime = Math.max(0, room.roomState.time + elapsed);
            socket.emit("room:state", { videoId: room.roomState.videoId, time: syncTime, playing: room.roomState.playing });
        }
        socket.emit("video:loop-state", room.loopEnabled);
        socket.emit("video:queue-update", room.queue);
    });

    // ── Auth ──────────────────────────────────────
    socket.on("auth:set-password", (password) => {
        const room = getRoom(socket);
        if (!room || !room.admins.has(socket.id)) return;
        room.roomPassword = password || "";
        io.to(socket.roomId).emit("auth:password-updated", { hasPassword: !!room.roomPassword });
    });

    socket.on("auth:kick", (targetId) => {
        const room = getRoom(socket);
        if (!room || !room.admins.has(socket.id)) return;
        if (room.users[targetId]) {
            io.to(targetId).emit("auth:kicked");
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) targetSocket.disconnect(true);
        }
    });

    // ── Chat / presence ───────────────────────────
    socket.on("chat message", (data) => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit("chat message", data);
    });
    socket.on("typing", (u) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit("typing", u);
    });
    socket.on("stop typing", () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit("stop typing");
    });

    // ── Message reactions ──────────────────────────
    socket.on("message:react", ({ messageId, emoji }) => {
        const room = getRoom(socket);
        if (!room || !messageId || !emoji) return;
        if (!room.reactions) room.reactions = {};
        if (!room.reactions[messageId]) room.reactions[messageId] = {};
        const msgReactions = room.reactions[messageId];
        // Remove user from any existing reaction on this message
        let alreadyReacted = false;
        Object.keys(msgReactions).forEach(e => {
            const arr = msgReactions[e];
            const idx = arr.indexOf(socket.id);
            if (idx > -1) {
                arr.splice(idx, 1);
                if (arr.length === 0) delete msgReactions[e];
                if (e === emoji) alreadyReacted = true;
            }
        });
        // Add user to new emoji (unless they just toggled off the same one)
        if (!alreadyReacted) {
            if (!msgReactions[emoji]) msgReactions[emoji] = [];
            msgReactions[emoji].push(socket.id);
        }
        io.to(socket.roomId).emit("message:reactions-update", { messageId, reactions: { ...msgReactions } });
    });

    // ── User status ────────────────────────────────
    socket.on("user:status", (status) => {
        const room = getRoom(socket);
        if (!room) return;
        if (!room.userStatus) room.userStatus = {};
        room.userStatus[socket.id] = status;
        socket.to(socket.roomId).emit("user:status-update", { socketId: socket.id, status });
    });

    // ── Video sync ────────────────────────────────
    socket.on("video:load", (id) => {
        const room = getRoom(socket);
        if (!room) return;
        room.roomState = { videoId: id, playing: true, time: 0, updatedAt: Date.now() };
        socket.to(socket.roomId).emit("video:load", id);
    });
    socket.on("video:play", (time) => {
        const room = getRoom(socket);
        if (!room) return;
        room.roomState = { ...room.roomState, playing: true, time, updatedAt: Date.now() };
        socket.to(socket.roomId).emit("video:play", time);
    });
    socket.on("video:pause", (time) => {
        const room = getRoom(socket);
        if (!room) return;
        room.roomState = { ...room.roomState, playing: false, time, updatedAt: Date.now() };
        socket.to(socket.roomId).emit("video:pause", time);
    });
    socket.on("video:seek", (time) => {
        const room = getRoom(socket);
        if (!room) return;
        room.roomState = { ...room.roomState, time, updatedAt: Date.now() };
        socket.to(socket.roomId).emit("video:seek", time);
    });
    socket.on("video:sync", (time) => {
        const room = getRoom(socket);
        if (!room) return;
        room.roomState = { ...room.roomState, playing: true, time, updatedAt: Date.now() };
        socket.to(socket.roomId).emit("video:sync", time);
    });

    // ── Video queue ──────────────────────────────
    socket.on("video:add-to-queue", (video) => {
        const room = getRoom(socket);
        if (!room) return;
        if (room.queue.length >= 6) return;
        room.queue.push(video);
        io.to(socket.roomId).emit("video:queue-update", room.queue);
    });

    socket.on("video:remove-from-queue", (index) => {
        const room = getRoom(socket);
        if (!room) return;
        if (index >= 0 && index < room.queue.length) {
            room.queue.splice(index, 1);
            io.to(socket.roomId).emit("video:queue-update", room.queue);
        }
    });

    socket.on("video:next-from-queue", () => {
        const room = getRoom(socket);
        if (!room) return;
        if (room.loopEnabled && room.roomState.videoId) {
            io.to(socket.roomId).emit("video:loop-restart", room.roomState.videoId);
            return;
        }
        if (room.queue.length > 0) {
            const next = room.queue.shift();
            room.roomState = { videoId: next.videoId, playing: true, time: 0, updatedAt: Date.now() };
            io.to(socket.roomId).emit("video:queue-update", room.queue);
            io.to(socket.roomId).emit("video:load", next.videoId);
            io.to(socket.roomId).emit("video:next-playing", next.title || "Next video");
        }
    });

    socket.on("video:play-from-queue", (index) => {
        const room = getRoom(socket);
        if (!room) return;
        if (index >= 0 && index < room.queue.length) {
            const next = room.queue.splice(index, 1)[0];
            room.roomState = { videoId: next.videoId, playing: true, time: 0, updatedAt: Date.now() };
            io.to(socket.roomId).emit("video:queue-update", room.queue);
            io.to(socket.roomId).emit("video:load", next.videoId);
            io.to(socket.roomId).emit("video:next-playing", next.title || "Next video");
        }
    });

    socket.on("video:play-random-from-queue", () => {
        const room = getRoom(socket);
        if (!room) return;
        if (room.queue.length > 0) {
            const idx = Math.floor(Math.random() * room.queue.length);
            const next = room.queue.splice(idx, 1)[0];
            room.roomState = { videoId: next.videoId, playing: true, time: 0, updatedAt: Date.now() };
            io.to(socket.roomId).emit("video:queue-update", room.queue);
            io.to(socket.roomId).emit("video:load", next.videoId);
            io.to(socket.roomId).emit("video:next-playing", next.title || "Next video");
        }
    });

    socket.on("video:toggle-loop", () => {
        const room = getRoom(socket);
        if (!room) return;
        room.loopEnabled = !room.loopEnabled;
        io.to(socket.roomId).emit("video:loop-state", room.loopEnabled);
    });

    // ── Hyperbeam co-browsing ─────────────────────
    socket.on("hyperbeam:start", () => {
        const room = getRoom(socket);
        if (!room || !room.admins.has(socket.id)) return;
        if (room.hyperbeam) {
            io.to(socket.roomId).emit("hyperbeam:session", { embedUrl: room.hyperbeam.embedUrl });
            return;
        }
        const hbReq = https.request({
            hostname: "engine.hyperbeam.com",
            path: "/v0/vm",
            method: "POST",
            headers: {
                "Authorization": "Bearer " + HB_API_KEY,
                "Content-Type": "application/json"
            }
        }, (hbRes) => {
            let data = "";
            hbRes.on("data", chunk => data += chunk);
            hbRes.on("end", () => {
                try {
                    const result = JSON.parse(data);
                    console.log("Hyperbeam raw response:", JSON.stringify(result));
                    if (result.embed_url) {
                        room.hyperbeam = {
                            sessionId: result.session_id,
                            embedUrl: result.embed_url,
                            adminToken: result.admin_token
                        };
                        io.to(socket.roomId).emit("hyperbeam:session", { embedUrl: result.embed_url });
                    } else {
                        const errMsg = result.message || result.error || "Failed to create session";
                        console.log("Hyperbeam error response:", errMsg);
                        io.to(socket.roomId).emit("hyperbeam:error", errMsg);
                    }
                } catch(e) {
                    console.log("Hyperbeam parse error:", e.message, "raw data:", data);
                    io.to(socket.roomId).emit("hyperbeam:error", "Invalid response from Hyperbeam");
                }
            });
        });
        hbReq.on("error", () => io.to(socket.roomId).emit("hyperbeam:error", "Network error"));
        hbReq.setTimeout(15000, () => { hbReq.destroy(); io.to(socket.roomId).emit("hyperbeam:error", "Timeout"); });
        hbReq.write("{}");
        hbReq.end();
    });

    socket.on("hyperbeam:stop", () => {
        const room = getRoom(socket);
        if (!room || !room.admins.has(socket.id) || !room.hyperbeam) return;
        endHyperbeamSession(room);
        io.to(socket.roomId).emit("hyperbeam:ended");
    });

    socket.on("hyperbeam:get-session", () => {
        const room = getRoom(socket);
        if (!room || !room.hyperbeam) return;
        socket.emit("hyperbeam:session", { embedUrl: room.hyperbeam.embedUrl });
    });

    // ── WebRTC signaling ──────────────────────────
    socket.on("call:join", (username) => {
        const room = getRoom(socket);
        if (!room) return;
        room.callUsers[socket.id] = username;
        const others = Object.entries(room.callUsers)
            .filter(([id]) => id !== socket.id)
            .map(([id, name]) => ({ socketId: id, username: name }));
        socket.emit("call:existing-users", others);
        socket.to(socket.roomId).emit("call:user-joined", { socketId: socket.id, username });
        io.to(socket.roomId).emit("call:participants", Object.keys(room.callUsers).length);
    });

    socket.on("call:leave", () => {
        const room = getRoom(socket);
        if (!room) return;
        delete room.callUsers[socket.id];
        socket.to(socket.roomId).emit("call:user-left", socket.id);
        io.to(socket.roomId).emit("call:participants", Object.keys(room.callUsers).length);
    });

    socket.on("call:offer", ({ to, offer }) => {
        io.to(to).emit("call:offer", { from: socket.id, offer });
    });

    socket.on("call:answer", ({ to, answer }) => {
        io.to(to).emit("call:answer", { from: socket.id, answer });
    });

    socket.on("call:ice-candidate", ({ to, candidate }) => {
        io.to(to).emit("call:ice-candidate", { from: socket.id, candidate });
    });

    // ── Call ringing ────────────────────────────
    socket.on("call:ring", (data) => {
        socket.to(socket.roomId).emit("call:incoming", { from: socket.id, username: data.username });
    });

    socket.on("call:cancel", () => {
        socket.to(socket.roomId).emit("call:canceled");
    });

    socket.on("call:accept", (data) => {
        const room = getRoom(socket);
        io.to(data.to).emit("call:accepted", { socketId: socket.id, username: room ? (room.users[socket.id] || "Unknown") : "Unknown" });
    });

    socket.on("call:reject", (data) => {
        const room = getRoom(socket);
        io.to(data.to).emit("call:rejected", { socketId: socket.id, username: room ? (room.users[socket.id] || "Unknown") : "Unknown" });
    });



    // ── Leave room ─────────────────────────────────
    socket.on("room:leave", (data) => {
        const roomId = (data && data.roomId) || socket.roomId;
        if (!roomId) return;
        const room = rooms[roomId];
        if (room) {
            delete room.users[socket.id];
            if (room.userStatus && room.userStatus[socket.id]) {
                delete room.userStatus[socket.id];
                socket.to(roomId).emit("user:status-update", { socketId: socket.id, status: "offline" });
            }
            if (room.callUsers[socket.id]) {
                delete room.callUsers[socket.id];
                socket.to(roomId).emit("call:user-left", socket.id);
                io.to(roomId).emit("call:participants", Object.keys(room.callUsers).length);
            }
            socket.to(roomId).emit("users", Object.entries(room.users).map(([id, name]) => ({ id, username: name })));
            const wasAdmin = room.admins.has(socket.id);
            if (wasAdmin) {
                room.admins.delete(socket.id);
                if (Object.keys(room.users).length > 0) {
                    const newAdminId = Object.keys(room.users)[0];
                    room.admins.add(newAdminId);
                    io.to(newAdminId).emit("auth:status", { hasPassword: !!room.roomPassword, isAdmin: true });
                    io.to(roomId).emit("users", Object.entries(room.users).map(([id, name]) => ({ id, username: name })));
                }
            }
            if (Object.keys(room.users).length === 0) {
                delete rooms[roomId];
            }
        }
        socket.leave(roomId);
        socket.roomId = null;
    });

    // ── End room ──────────────────────────────────
    socket.on("room:end", () => {
        const room = getRoom(socket);
        if (!room || !room.admins.has(socket.id)) return;
        io.to(socket.roomId).emit("room:ended");
        endHyperbeamSession(room);
        Object.keys(room.users).forEach(id => {
            const s = io.sockets.sockets.get(id);
            if (s) s.disconnect(true);
        });
        delete rooms[socket.roomId];
    });

    // ── Disconnect ────────────────────────────────
    socket.on("disconnect", () => {
        const roomId = socket.roomId;
        const room = rooms[roomId];
        if (!room) return;

        const wasAdmin = room.admins.has(socket.id);
        if (wasAdmin) room.admins.delete(socket.id);
        delete room.users[socket.id];
        if (room.userStatus && room.userStatus[socket.id]) {
            delete room.userStatus[socket.id];
            socket.to(roomId).emit("user:status-update", { socketId: socket.id, status: "offline" });
        }
        if (room.callUsers[socket.id]) {
            delete room.callUsers[socket.id];
            socket.to(roomId).emit("call:user-left", socket.id);
            socket.to(roomId).emit("call:canceled");
            io.to(roomId).emit("call:participants", Object.keys(room.callUsers).length);
        }
        io.to(roomId).emit("users", Object.entries(room.users).map(([id, name]) => ({ id, username: name })));
        if (!room.admins.size && Object.keys(room.users).length > 0) {
            room.admins.add(Object.keys(room.users)[0]);
            io.to(Object.keys(room.users)[0]).emit("auth:status", { hasPassword: !!room.roomPassword, isAdmin: true });
            io.to(roomId).emit("users", Object.entries(room.users).map(([id, name]) => ({ id, username: name })));
        }
        if (Object.keys(room.users).length === 0) {
            delete rooms[roomId];
        }
    });
});

// Prevent server crashes from unhandled errors
process.on("uncaughtException", (err) => console.error("Uncaught:", err));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));

console.log("HB_API_KEY available:", !!HB_API_KEY);
server.listen(3000, () => console.log("Server running on http://localhost:3000"));
