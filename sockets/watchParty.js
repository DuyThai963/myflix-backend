const { redisClient } = require('../configs/db');

const memoryRooms = {};

async function saveRoom(roomId, roomData) {
  if (redisClient) {
    try {
      await redisClient.set(`room:${roomId}`, JSON.stringify(roomData), { EX: 259200 });
    } catch (err) { console.error(`❌ Lỗi lưu phòng ${roomId}:`, err.message); }
  } else {
    memoryRooms[roomId] = roomData;
  }
}

async function getRoom(roomId) {
  if (redisClient) {
    try {
      const data = await redisClient.get(`room:${roomId}`);
      return data ? JSON.parse(data) : null;
    } catch (err) { return null; }
  }
  return memoryRooms[roomId] || null;
}

module.exports = function (io) {
  async function broadcastActiveRooms() {
    try {
      let activeRooms = [];
      if (redisClient) {
        const keys = await redisClient.keys("room:*");
        for (const key of keys) {
          const data = await redisClient.get(key);
          if (data) {
            const room = JSON.parse(data);
            if (room.users.length > 0) activeRooms.push(room);
          }
        }
      } else {
        activeRooms = Object.values(memoryRooms).filter(r => r.users.length > 0);
      }
      io.emit("active_rooms_list", activeRooms);
    } catch (err) { console.error("❌ Lỗi sảnh:", err.message); }
  }

  io.on("connection", (socket) => {
    socket.on("create_room", async ({ roomName, movieInfo, hostUserId, hostUsername }) => {
      const roomId = "wp_" + Math.random().toString(36).substring(2, 10);
      const hostToken = Math.random().toString(36).substring(2, 15);

      const roomData = {
        roomId,
        roomName: roomName || `Phòng của ${hostUsername || 'Admin'}`,
        hostUserId, hostUsername, hostId: socket.id, hostToken,
        movieState: { slug: movieInfo.slug, title: movieInfo.title, episode: movieInfo.episode || "Tập 1", currentTime: 0, isPlaying: false },
        users: []
      };
      await saveRoom(roomId, roomData);
      socket.emit("room_created_success", { roomId, hostToken });
      await broadcastActiveRooms();
    });

    socket.on("get_active_rooms", async () => { await broadcastActiveRooms(); });

    socket.on("join_room", async ({ roomId, userName, userId, hostToken, resumeTime, resumeEpisode }) => {
      let room = await getRoom(roomId);
      if (!room) {
        socket.emit("room_error", { message: "Phòng này không tồn tại hoặc đã hết hạn!" });
        return;
      }

      socket.join(roomId);

      let finalName = userName;
      let finalUserId = userId ? Number(userId) : null;
      const isHostRoute = (hostToken && room.hostToken === hostToken) || (userId && Number(room.hostUserId) === Number(userId));
      
      if (isHostRoute) {
        finalName = room.hostUsername;
        finalUserId = Number(room.hostUserId);
      } else if (!finalName) {
        finalName = `Khách_${socket.id.substring(0, 4)}`;
      }

      const isUserExists = room.users.some(user => user.socketId === socket.id);
      
      if (room.users.length === 0) {
        room.hostId = socket.id; 
        if (resumeTime) room.movieState.currentTime = resumeTime;
        if (resumeEpisode) room.movieState.episode = resumeEpisode;
      }

      if (!isUserExists) {
        room.users.push({ socketId: socket.id, name: finalName, userId: finalUserId });
      }

      await saveRoom(roomId, room);
      socket.emit("room_state", { roomId: room.roomId, roomName: room.roomName, isHost: room.hostId === socket.id, movieState: room.movieState });
      await broadcastActiveRooms();
    });

    socket.on("host_submitted_time_for_newbie", async ({ roomId, targetSocketId, currentTime, isPlaying, episodeName }) => {
      const room = await getRoom(roomId);
      if (room) {
        room.movieState.currentTime = currentTime;
        room.movieState.isPlaying = isPlaying;
        if (episodeName) room.movieState.episode = episodeName;
        await saveRoom(roomId, room);
      }
      io.to(targetSocketId).emit("sync_initial_time_to_guest", { currentTime, isPlaying });
    });

    socket.on("disconnect", async () => {
      if (redisClient) {
        try {
          const keys = await redisClient.keys("room:*");
          for (const key of keys) {
            const data = await redisClient.get(key);
            if (!data) continue;

            const room = JSON.parse(data);
            const oldLength = room.users.length;
            room.users = room.users.filter(user => user.socketId !== socket.id);

            if (oldLength !== room.users.length) {
              if (room.users.length === 0) {
                room.hostId = null;
                await redisClient.set(key, JSON.stringify(room), { EX: 259200 }); 
              } else {
                if (room.hostId === socket.id) {
                  room.hostId = room.users[0].socketId;
                  io.to(room.hostId).emit("you_are_promoted_to_host");
                }
                await redisClient.set(key, JSON.stringify(room), { EX: 259200 });
              }
            }
          }
        } catch (err) {}
      } else {
        Object.keys(memoryRooms).forEach((roomId) => {
          const room = memoryRooms[roomId];
          const oldLength = room.users.length;
          room.users = room.users.filter(user => user.socketId !== socket.id);
          if (oldLength !== room.users.length) {
            if (room.users.length === 0) delete memoryRooms[roomId];
            else if (room.hostId === socket.id) {
              room.hostId = room.users[0].socketId;
              io.to(room.hostId).emit("you_are_promoted_to_host");
            }
          }
        });
      }
      await broadcastActiveRooms();
    });

    socket.on("delete_room", async ({ roomId, hostToken }) => {
      const room = await getRoom(roomId);
      if (!room || room.hostToken !== hostToken) return;
      io.to(roomId).emit("room_deleted_by_host");
      if (redisClient) await redisClient.del(`room:${roomId}`);
      else delete memoryRooms[roomId];
      await broadcastActiveRooms();
    });
  });
};