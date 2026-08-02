const { Pool } = require('pg');
const { createClient } = require('redis');

let config = {};
try {
  // Ưu tiên load file config.js nếu có
  config = require('../config');
} catch (e) {}

// 🚀 HỢP NHẤT & GHI ĐÈ: Luôn đảm bảo các biến môi trường được nạp và ưu tiên hơn file config.js (nếu trùng)
config = {
  ...config, // Giữ lại các giá trị từ file config.js
  PORT: process.env.PORT || config.PORT || 5000,
  JWT_SECRET: process.env.JWT_SECRET || config.JWT_SECRET,
  DATABASE_URL: process.env.DATABASE_URL || config.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL || config.REDIS_URL,
  
  // 🎬 Cấu hình Nguồn API Phim Động (PhimAPI hoặc OPhim)
  MOVIE_PROVIDER: process.env.MOVIE_PROVIDER || config.MOVIE_PROVIDER || "phimapi",
  OPHIM_BASE_URL: process.env.OPHIM_BASE_URL || config.OPHIM_BASE_URL || "https://ophim1.com",
  PHIMAPI_BASE_URL: process.env.PHIMAPI_BASE_URL || config.PHIMAPI_BASE_URL || "https://phimapi.com",
};

// Auto Switch Domain URL theo Provider đang chọn
config.CURRENT_MOVIE_API_URL = config.MOVIE_PROVIDER === "ophim" 
  ? config.OPHIM_BASE_URL 
  : config.PHIMAPI_BASE_URL;

// Khởi tạo PostgreSQL Pool
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Kết nối Database thất bại! Lỗi:', err.message);
  } else {
    release();
  }
});

// Khởi tạo Redis Client
let redisClient = null;
let pubClient = null;
let subClient = null;

if (config.REDIS_URL) {
  pubClient = createClient({ url: config.REDIS_URL });
  subClient = pubClient.duplicate();
  redisClient = createClient({ url: config.REDIS_URL });

  Promise.all([pubClient.connect(), subClient.connect(), redisClient.connect()])
    .catch((err) => console.error("❌ Thất bại khi kết nối hệ thống Redis:", err.message));
} else {
  console.warn("⚠️ Không tìm thấy REDIS_URL. Chạy phòng tạm bằng RAM Local.");
}

module.exports = { pool, redisClient, pubClient, subClient, config };