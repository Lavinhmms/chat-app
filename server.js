const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

let users     = {};
let roomState = { videoId: null, playing: false, time: 0, updatedAt: Date.now() };
let callUsers = {}; // socketId -> username (only users in call)

io.on("connection", (socket) => {

    // ── Chat / presence ───────────────────────────
    socket.on("join", (username) => {
        users[socket.id] = username;
        io.emit("users", Object.values(users));
        if (roomState.videoId) {
            const elapsed = roomState.playing
                ? (Date.now() - roomState.updatedAt) / 1000
                : 0;
            const syncTime = Math.max(0, roomState.time + elapsed);
            console.log("Sending room state to new joiner:", roomState.videoId, "at", syncTime.toFixed(1) + "s");
            socket.emit("room:state", {
                videoId: roomState.videoId,
                time:    syncTime,
                playing: roomState.playing
            });
        }
    });

    socket.on("chat message", (data) => { io.emit("chat message", data); });
    socket.on("typing",       (u)    => { socket.broadcast.emit("typing", u); });
    socket.on("stop typing",  ()     => { socket.broadcast.emit("stop typing"); });

    // ── Video sync ────────────────────────────────
    socket.on("video:load",  (id)   => { roomState = { videoId: id, playing: true,  time: 0, updatedAt: Date.now() }; socket.broadcast.emit("video:load",  id); });
    socket.on("video:play",  (time) => { roomState = { ...roomState, playing: true,  time, updatedAt: Date.now() };   socket.broadcast.emit("video:play",  time); });
    socket.on("video:pause", (time) => { roomState = { ...roomState, playing: false, time, updatedAt: Date.now() };   socket.broadcast.emit("video:pause", time); });
    socket.on("video:seek",  (time) => { roomState = { ...roomState,                 time, updatedAt: Date.now() };   socket.broadcast.emit("video:seek",  time); });

    // ── WebRTC signaling ──────────────────────────

    // User joins the call
    socket.on("call:join", (username) => {
        callUsers[socket.id] = username;
        // Tell this user about everyone already in the call
        const others = Object.entries(callUsers)
            .filter(([id]) => id !== socket.id)
            .map(([id, name]) => ({ socketId: id, username: name }));
        socket.emit("call:existing-users", others);
        // Tell everyone else a new user joined
        socket.broadcast.emit("call:user-joined", { socketId: socket.id, username });
        io.emit("call:participants", Object.keys(callUsers).length);
    });

    // Leave the call
    socket.on("call:leave", () => {
        delete callUsers[socket.id];
        socket.broadcast.emit("call:user-left", socket.id);
        io.emit("call:participants", Object.keys(callUsers).length);
    });

    // WebRTC offer (sent to specific peer)
    socket.on("call:offer", ({ to, offer }) => {
        io.to(to).emit("call:offer", { from: socket.id, offer });
    });

    // WebRTC answer (sent to specific peer)
    socket.on("call:answer", ({ to, answer }) => {
        io.to(to).emit("call:answer", { from: socket.id, answer });
    });

    // ICE candidate (sent to specific peer)
    socket.on("call:ice-candidate", ({ to, candidate }) => {
        io.to(to).emit("call:ice-candidate", { from: socket.id, candidate });
    });

    // ── Disconnect ────────────────────────────────
    socket.on("disconnect", () => {
        delete users[socket.id];
        io.emit("users", Object.values(users));
        if (callUsers[socket.id]) {
            delete callUsers[socket.id];
            socket.broadcast.emit("call:user-left", socket.id);
            io.emit("call:participants", Object.keys(callUsers).length);
        }
    });
});

server.listen(3000, () => console.log("Server running on http://localhost:3000"));