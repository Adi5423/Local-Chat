const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users and their typing status
const users = new Map(); // socket.id -> { username, userId, relationInt }
const typingUsers = new Set();
const friendRequests = new Map(); // userId -> Set of userIds
const friends = new Map(); // userId -> Set of userIds
let nextUserId = 1;

// Load saved user data
const USER_DATA_FILE = 'user_data.json';
let savedUserData = {};
let usernameToUserId = new Map(); // username -> userId mapping

try {
    if (fs.existsSync(USER_DATA_FILE)) {
        savedUserData = JSON.parse(fs.readFileSync(USER_DATA_FILE, 'utf8'));
        // Update nextUserId based on saved data
        const maxId = Math.max(...Object.keys(savedUserData).map(id => parseInt(id)), 0);
        nextUserId = maxId + 1;
        
        // Build username to userId mapping
        Object.entries(savedUserData).forEach(([userId, data]) => {
            usernameToUserId.set(data.username, userId);
        });
    }
} catch (error) {
    console.error('Error loading user data:', error);
}

// Save user data to file
function saveUserData() {
    try {
        fs.writeFileSync(USER_DATA_FILE, JSON.stringify(savedUserData, null, 2));
    } catch (error) {
        console.error('Error saving user data:', error);
    }
}

// Generate a 7-digit user ID
function generateUserId() {
    const userId = nextUserId.toString().padStart(7, '0');
    nextUserId++;
    return userId;
}

// Get or create user ID for a username
function getUserId(username) {
    // Check if username exists in mapping
    if (usernameToUserId.has(username)) {
        return usernameToUserId.get(username);
    }
    
    // Generate new user ID and save data
    const userId = generateUserId();
    savedUserData[userId] = {
        username,
        relationInt: 0 // Default relation status
    };
    usernameToUserId.set(username, userId);
    saveUserData();
    return userId;
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected');

    // Handle user joining
    socket.on('userJoin', (username) => {
        const userId = getUserId(username);
        const userData = savedUserData[userId];
        
        // Reset any existing friendship data for this socket
        users.set(socket.id, { 
            username, 
            userId,
            relationInt: 0 // Reset relationInt to 0 for new login
        });

        // Initialize empty friend sets if they don't exist
        if (!friends.has(userId)) {
            friends.set(userId, new Set());
        }

        // Send user list with their online status and friend status
        const userList = Array.from(users.entries()).map(([id, { username, userId, relationInt }]) => ({
            id,
            username,
            online: true,
            userId,
            relationInt,
            isFriend: false // Reset friend status for new login
        }));
        io.emit('userList', userList);
        io.emit('message', {
            user: 'System',
            text: `${username} has joined the chat`,
            time: new Date().toLocaleTimeString()
        });
    });

    // Handle friend requests
    socket.on('sendFriendRequest', ({ from, to }) => {
        const fromUser = Array.from(users.entries())
            .find(([_, user]) => user.username === from);
        const targetSocket = Array.from(users.entries())
            .find(([_, user]) => user.username === to)?.[0];
        
        if (targetSocket && fromUser) {
            const fromUserId = fromUser[1].userId;
            const toUserId = users.get(targetSocket).userId;

            // Only allow request if relationInt is 0
            if (fromUser[1].relationInt !== 0) {
                return;
            }

            // Check if they are already friends
            if (friends.has(fromUserId) && friends.get(fromUserId).has(toUserId)) {
                return;
            }

            // Check if there's already a pending request
            if (friendRequests.has(toUserId) && friendRequests.get(toUserId).has(fromUserId)) {
                return;
            }

            if (!friendRequests.has(toUserId)) {
                friendRequests.set(toUserId, new Set());
            }
            friendRequests.get(toUserId).add(fromUserId);
            
            // Update relationInt to 1 (request sent)
            fromUser[1].relationInt = 1;
            savedUserData[fromUserId].relationInt = 1;
            saveUserData();

            // Notify both users about the request status
            io.to(targetSocket).emit('friendRequest', { 
                from,
                status: 1 // Request sent
            });
            socket.emit('friendRequestStatus', {
                to,
                status: 1 // Request sent
            });
        }
    });

    // Handle friend request response
    socket.on('friendRequestResponse', ({ from, to, accepted }) => {
        const fromUser = Array.from(users.entries())
            .find(([_, user]) => user.username === from);
        const targetSocket = Array.from(users.entries())
            .find(([_, user]) => user.username === to)?.[0];
        
        if (targetSocket && fromUser) {
            const fromUserId = fromUser[1].userId;
            const toUserId = users.get(targetSocket).userId;

            if (accepted) {
                // Add both users to each other's friend lists
                if (!friends.has(fromUserId)) {
                    friends.set(fromUserId, new Set());
                }
                if (!friends.has(toUserId)) {
                    friends.set(toUserId, new Set());
                }
                friends.get(fromUserId).add(toUserId);
                friends.get(toUserId).add(fromUserId);

                // Update relationInt to 2 (friends)
                fromUser[1].relationInt = 2;
                users.get(targetSocket).relationInt = 2;
                savedUserData[fromUserId].relationInt = 2;
                savedUserData[toUserId].relationInt = 2;
                saveUserData();
            } else {
                // Reset relationInt to 0 (not friends)
                fromUser[1].relationInt = 0;
                users.get(targetSocket).relationInt = 0;
                savedUserData[fromUserId].relationInt = 0;
                savedUserData[toUserId].relationInt = 0;
                saveUserData();
            }

            // Remove the friend request
            if (friendRequests.has(toUserId)) {
                friendRequests.get(toUserId).delete(fromUserId);
            }

            // Notify both users about the friendship status
            const status = accepted ? 2 : 0;
            io.to(targetSocket).emit('friendRequestResponse', { 
                from, 
                accepted,
                status
            });
            socket.emit('friendRequestResponse', { 
                from: to, 
                accepted,
                status
            });

            // Update user lists for both users
            const userList = Array.from(users.entries()).map(([id, { username, userId, relationInt }]) => ({
                id,
                username,
                online: true,
                userId,
                relationInt,
                isFriend: false // Reset friend status for new login
            }));
            io.emit('userList', userList);
        }
    });

    // Handle chat messages
    socket.on('chatMessage', (msg) => {
        const { username } = users.get(socket.id);
        io.emit('message', {
            user: username,
            text: msg,
            time: new Date().toLocaleTimeString()
        });
    });

    // Handle voice notes
    socket.on('voiceNote', (audioDataUrl) => {
        const { username } = users.get(socket.id);
        io.emit('voiceNote', {
            user: username,
            audioDataUrl: audioDataUrl,
            time: new Date().toLocaleTimeString()
        });
    });

    // Handle typing indicators
    socket.on('typing', (isTyping) => {
        const { username } = users.get(socket.id);
        if (isTyping) {
            typingUsers.add(username);
        } else {
            typingUsers.delete(username);
        }
        io.emit('typingUsers', Array.from(typingUsers));
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const userData = users.get(socket.id);
        if (userData) {
            const { username } = userData;
            users.delete(socket.id);
            typingUsers.delete(username);
            // Send updated user list with online status
            const userList = Array.from(users.entries()).map(([id, { username, userId, relationInt }]) => ({
                id,
                username,
                online: true,
                userId,
                relationInt,
                isFriend: friends.get(userId)?.has(userId) || false
            }));
            io.emit('userList', userList);
            io.emit('typingUsers', Array.from(typingUsers));
            io.emit('message', {
                user: 'System',
                text: `${username} has left the chat`,
                time: new Date().toLocaleTimeString()
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 