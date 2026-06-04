const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
// 🚀 TÍCH HỢP THƯ VIỆN REDIS ADAPTER TRÊN PRODUCTION
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

const app = express();

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    // Sử dụng biến môi trường FRONTEND_URL, nếu không có thì mặc định localhost
    origin: process.env.FRONTEND_URL || "http://localhost:3000", 
    methods: ["GET", "POST"],
    credentials: true
  },
  // 🚀 CẤU HÌNH BẢO HIỂM GIỮ SÓNG TRÊN RENDER: Chống sập kết nối WebSockets ngầm
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000
});

// =========================================================================
// 🔗 KẾT NỐI HẠ TẦNG REDIS ADAPTER CHUẨN KIẾN TRÚC CLOUD
// =========================================================================
if (process.env.REDIS_URL) {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      console.log("✅ [Hạ tầng] Đã tích hợp thành công Redis Adapter!");
    })
    .catch((err) => {
      console.error("❌ [Lỗi hạ tầng] Không thể kết nối Redis:", err.message);
    });
} else {
  console.log("⚠️ [Cảnh báo] Không tìm thấy REDIS_URL. Hệ thống đang chạy bằng RAM cục bộ.");
}

// Kho lưu trữ dữ liệu phòng trên RAM Backend (Giữ nguyên luồng xử lý cũ)
const rooms = {};

// =========================================================================
// 🌐 HỆ THỐNG GIÁM SÁT SOCKET VÀ LOGIC ĐỒNG BỘ BAN ĐẦU (GIỮ NGUYÊN 100%)
// =========================================================================
io.on("connection", (socket) => {

  socket.on("create_room", ({ roomName, movieInfo }) => {
    const roomId = "wp_" + Math.random().toString(36).substring(2, 10);
    const hostToken = Math.random().toString(36).substring(2, 15);

    rooms[roomId] = {
      roomId,
      roomName: roomName || `Phòng xem chung #${roomId.substring(3)}`,
      hostId: socket.id,
      hostToken,
      movieState: {
        slug: movieInfo.slug,
        title: movieInfo.title,
        episode: movieInfo.episode || "1",
        currentTime: 0,
        isPlaying: false
      },
      users: []
    };

    socket.emit("room_created_success", { roomId, hostToken });
    io.emit("active_rooms_list", Object.values(rooms).filter(r => r.users.length > 0 || r.hostId));
  });

  socket.on("get_active_rooms", () => {
    const activeRooms = Object.values(rooms).filter(r => r.users.length > 0 || r.hostId);
    socket.emit("active_rooms_list", activeRooms);
  });

  socket.on("delete_room", ({ roomId, hostToken }) => {
    if (!rooms[roomId]) return;
    if (rooms[roomId].hostToken !== hostToken) return;
    
    io.to(roomId).emit("room_deleted_by_host");
    delete rooms[roomId];
    io.emit("active_rooms_list", Object.values(rooms).filter(r => r.users.length > 0 || r.hostId));
  });

  socket.on("join_room", ({ roomId, userName }) => {
    if (!rooms[roomId]) {
      socket.emit("room_error", { message: "Phòng này không tồn tại!" });
      return;
    }

    socket.join(roomId);
    const room = rooms[roomId];

    const isUserExists = room.users.some(user => user.socketId === socket.id);
    if (isUserExists) return;

    const newUser = {
      socketId: socket.id,
      name: userName || `Khách_${socket.id.substring(0, 4)}`
    };
    room.users.push(newUser);

    if (room.users.length === 1) {
      room.hostId = socket.id;
      socket.emit("room_state", { roomId, roomName: room.roomName, isHost: true, movieState: room.movieState });
    } else {
      socket.emit("room_state", { roomId, roomName: room.roomName, isHost: false, movieState: room.movieState });
      if (room.hostId) {
        io.to(room.hostId).emit("request_current_time_from_host", { targetSocketId: socket.id });
      }
    }
    
    io.emit("active_rooms_list", Object.values(rooms).filter(r => r.users.length > 0 || r.hostId));
  });

  socket.on("host_submitted_time_for_newbie", ({ roomId, targetSocketId, currentTime, isPlaying }) => {
    if (rooms[roomId]) {
      rooms[roomId].movieState.currentTime = currentTime;
      rooms[roomId].movieState.isPlaying = isPlaying;
    }
    io.to(targetSocketId).emit("sync_initial_time_to_guest", { currentTime, isPlaying });
  });

  socket.on("disconnect", () => {
    Object.keys(rooms).forEach((roomId) => {
      const room = rooms[roomId];
      const oldLength = room.users.length;
      room.users = room.users.filter(user => user.socketId !== socket.id);

      if (oldLength !== room.users.length) {
        if (room.users.length === 0) {
          room.hostId = null;
        } else if (room.hostId === socket.id) {
          room.hostId = room.users[0].socketId;
          io.to(room.hostId).emit("you_are_promoted_to_host");
        }
      }
    });
    io.emit("active_rooms_list", Object.values(rooms).filter(r => r.users.length > 0 || r.hostId));
  });
});

// --- API PROXY GỐC ---
app.get("/api/home", async (req, res) => {
  try {
    const response = await axios.get("https://ophim1.com/v1/api/home");
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: "Failed to fetch movies" }); }
});

app.get("/api/movie/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const response = await axios.get(`https://ophim1.com/phim/${slug}`);
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: "Failed to fetch movie detail" }); }
});

app.get("/api/search", async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) return res.status(400).json({ error: "Keyword is required" });
    const response = await axios.get(`https://ophim1.com/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}`);
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: "Failed to search movies" }); }
});

app.get("/api/category/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const { page } = req.query;
    const pageParam = page ? `?page=${page}` : '';
    const response = await axios.get(`https://ophim1.com/v1/api/the-loai/${slug}${pageParam}`);
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: "Failed to fetch category movies" }); }
});

app.get('/api/danh-sach/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1 } = req.query;
    const response = await axios.get(`https://ophim1.com/v1/api/danh-sach/${slug}?page=${page}`);
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ĐÓNG KHÓA CỔNG ĐỘNG BẢO HIỂM RENDER
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});