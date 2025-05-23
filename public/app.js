const socket = io();
let username = '';

// DOM Elements
const usernameModal = document.getElementById('username-modal');
const usernameInput = document.getElementById('username-input');
const joinButton = document.getElementById('join-button');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const messagesDiv = document.getElementById('messages');
const usersDiv = document.getElementById('users');
const friendRequestsList = document.getElementById('friend-requests-list');
const typingIndicator = document.getElementById('typing-indicator');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');

// Join chat
joinButton.addEventListener('click', () => {
    username = usernameInput.value.trim();
    if (username) {
        socket.emit('userJoin', username);
        usernameModal.style.display = 'none';
    }
});

// Toggle sidebar
sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
});

// Send message
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('chatMessage', message);
        messageInput.value = '';
    }
}

// Handle typing indicator
let typingTimeout;
messageInput.addEventListener('input', () => {
    socket.emit('typing', true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', false);
    }, 1000);
});

// Update user list
socket.on('userList', (users) => {
    usersDiv.innerHTML = '';
    users.forEach(user => {
        if (user.username !== username) { // Don't show current user
            const userElement = document.createElement('div');
            userElement.className = 'user-item';
            
            let buttonHTML = '';
            switch(user.relationInt) {
                case 0: // Not friends
                    buttonHTML = `<button class="add-friend-btn" data-username="${user.username}"><i class="fas fa-user-plus"></i></button>`;
                    break;
                case 1: // Request sent
                    buttonHTML = `<button class="friend-status" disabled><i class="fas fa-clock"></i></button>`;
                    break;
                case 2: // Friends
                    buttonHTML = `<button class="friend-status" disabled><i class="fas fa-check"></i></button>`;
                    break;
            }

            userElement.innerHTML = `
                <div class="user-info">
                    <span class="online-status ${user.online ? '' : 'offline'}"></span>
                    <span>${user.username}</span>
                </div>
                ${buttonHTML}
            `;
            usersDiv.appendChild(userElement);
        }
    });

    // Add event listeners to friend request buttons
    document.querySelectorAll('.add-friend-btn').forEach(button => {
        button.addEventListener('click', () => {
            const targetUsername = button.dataset.username;
            socket.emit('sendFriendRequest', {
                from: username,
                to: targetUsername
            });
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-clock"></i>';
            button.className = 'friend-status';
            button.title = 'Request sent';
        });
    });
});

// Handle friend request response
socket.on('friendRequestResponse', ({ from, accepted, status }) => {
    const button = document.querySelector(`[data-username="${from}"]`);
    if (button) {
        switch(status) {
            case 0: // Not friends
                button.innerHTML = '<i class="fas fa-user-plus"></i>';
                button.disabled = false;
                button.className = 'add-friend-btn';
                button.title = 'Add friend';
                break;
            case 1: // Request sent
                button.innerHTML = '<i class="fas fa-clock"></i>';
                button.disabled = true;
                button.className = 'friend-status';
                button.title = 'Request sent';
                break;
            case 2: // Friends
                button.innerHTML = '<i class="fas fa-check"></i>';
                button.disabled = true;
                button.className = 'friend-status';
                button.title = 'Friends';
                break;
        }
    }
});

// Handle friend request status update
socket.on('friendRequestStatus', ({ to, status }) => {
    const button = document.querySelector(`[data-username="${to}"]`);
    if (button) {
        switch(status) {
            case 0: // Not friends
                button.innerHTML = '<i class="fas fa-user-plus"></i>';
                button.disabled = false;
                button.className = 'add-friend-btn';
                button.title = 'Add friend';
                break;
            case 1: // Request sent
                button.innerHTML = '<i class="fas fa-clock"></i>';
                button.disabled = true;
                button.className = 'friend-status';
                button.title = 'Request sent';
                break;
            case 2: // Friends
                button.innerHTML = '<i class="fas fa-check"></i>';
                button.disabled = true;
                button.className = 'friend-status';
                button.title = 'Friends';
                break;
        }
    }
});

// Handle friend requests
socket.on('friendRequest', ({ from }) => {
    const requestElement = document.createElement('div');
    requestElement.className = 'friend-request-item';
    requestElement.innerHTML = `
        <span>${from} wants to be your friend</span>
        <div class="friend-request-actions">
            <button class="accept-btn" data-username="${from}">Accept</button>
            <button class="reject-btn" data-username="${from}">Reject</button>
        </div>
    `;
    friendRequestsList.appendChild(requestElement);

    // Add event listeners to accept/reject buttons
    const acceptBtn = requestElement.querySelector('.accept-btn');
    const rejectBtn = requestElement.querySelector('.reject-btn');

    acceptBtn.addEventListener('click', () => {
        socket.emit('friendRequestResponse', {
            from: username,
            to: from,
            accepted: true
        });
        requestElement.remove();
    });

    rejectBtn.addEventListener('click', () => {
        socket.emit('friendRequestResponse', {
            from: username,
            to: from,
            accepted: false
        });
        requestElement.remove();
    });
});

// Handle messages
socket.on('message', (msg) => {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${msg.user === username ? 'sent' : 'received'}`;
    messageElement.innerHTML = `
        <div class="message-header">
            <span class="message-user">${msg.user}</span>
            <span class="message-time">${msg.time}</span>
        </div>
        <div class="message-content">${msg.text}</div>
    `;
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

// Handle voice notes
socket.on('voiceNote', (data) => {
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.innerHTML = `
        <div class="message-header">
            <span class="message-user">${data.user}</span>
            <span class="message-time">${data.time}</span>
        </div>
        <div class="message-content">
            <audio controls src="${data.audioDataUrl}"></audio>
        </div>
    `;
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

// Handle typing indicators
socket.on('typingUsers', (users) => {
    const typingUsersWithoutSelf = users.filter(user => user !== username);
    if (typingUsersWithoutSelf.length > 0) {
        typingIndicator.textContent = `${typingUsersWithoutSelf.join(', ')} ${typingUsersWithoutSelf.length === 1 ? 'is' : 'are'} typing...`;
        typingIndicator.style.display = 'block';
    } else {
        typingIndicator.style.display = 'none';
    }
}); 