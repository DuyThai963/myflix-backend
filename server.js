const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");

// Nạp kết nối Tầng dữ liệu & Cấu hình bảo hiểm đa môi trường
const { pubClient, subClient, config } = require('./configs/db');

const app = express();
const server = http.createServer(app);

// 🔓 1. CẤU HÌNH CORS TRƠN CHU ĐA MÔI TRƯỜNG
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
app.use(cors({
  origin: (origin, callback) => callback(null, !origin ? frontendUrl : origin),
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🌐 2. CẤU HÌNH HẠ TẦNG SOCKET.IO
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || "http://localhost:3000", methods: ["GET", "POST"], credentials: true },
  transports: ["websocket", "polling"],
  pingTimeout: 60000, pingInterval: 25000
});

// Nếu đầu dây Redis Adapter thông suốt, ráp nối luồng Cluster Production ngay tại chỗ
if (pubClient && subClient) {
  io.adapter(createAdapter(pubClient, subClient));
}

// 🔌 Kích hoạt kiến trúc điều phối phòng Realtime
require('./sockets/watchParty')(io);

// 🔗 3. ĐĂNG KÝ HỆ THỐNG ROUTER ĐÃ CHIA MODULAR SẠCH SẼ
app.use("/api/auth", require("./routes/auth"));
app.use("/api/history", require("./routes/history"));
app.use("/", require("./routes/proxy")); // Giữ nguyên đít endpoint proxy gốc cho FE gọi

const PORT = config.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 [Server Production Engine] Running smoothly on port ${PORT}`);
});