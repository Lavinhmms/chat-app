const socket = io();

const form = document.getElementById("form");
const input = document.getElementById("input");
const username = document.getElementById("username");
const chat = document.getElementById("chat");
const usersList = document.getElementById("users");

username.addEventListener("change", () => {
    socket.emit("join", username.value);
});

form.addEventListener("submit", (e) => {
    e.preventDefault();

    if (input.value && username.value) {
        socket.emit("chat message", {
            user: username.value,
            msg: input.value
        });

        input.value = "";
    }
});

socket.on("chat message", (data) => {
    const div = document.createElement("div");
    div.textContent = `${data.user}: ${data.msg}`;
    chat.appendChild(div);
});

socket.on("users", (users) => {
    usersList.innerHTML = "";
    users.forEach(user => {
        const li = document.createElement("li");
        li.textContent = user;
        usersList.appendChild(li);
    });
});