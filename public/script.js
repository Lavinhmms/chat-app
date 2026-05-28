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

    div.classList.add("message");

    if (data.user === username.value) {
        div.classList.add("self");
    }

    div.innerHTML = `
        <strong>${data.user}</strong>
        ${data.msg}
    `;

    chat.appendChild(div);

    chat.scrollTop = chat.scrollHeight;
});

socket.on("users", (users) => {

    usersList.innerHTML = "";

    users.forEach(user => {

        const li = document.createElement("li");

        li.textContent = "🟢 " + user;

        usersList.appendChild(li);
    });
});

document.body.classList.add("dark");

const themeToggle = document.getElementById("themeToggle");

themeToggle.addEventListener("click", () => {

    if (document.body.classList.contains("dark")) {

        document.body.classList.remove("dark");
        document.body.classList.add("light");

        themeToggle.textContent = "◑";

    } else {

        document.body.classList.remove("light");
        document.body.classList.add("dark");

        themeToggle.textContent = "◐";
    }
});