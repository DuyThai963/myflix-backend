const { Pool } = require('pg');
const { createClient } = require('redis');

// 🚀 BỌC GIÁP ĐA MÔI TRƯỜNG: Bypass triệt để vụ file config.js bị cho vào .gitignore
let config = {};
try {
  config = require('../config');
} catch (e) {
  config = {
    PORT: process.env.PORT || 5000,
    JWT_SECRET: process.env.JWT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL
  };
}

// Khởi tạo PostgreSQL Pool
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Kết nối Database thất bại rồi Thái ơi! Lỗi:', err.message);
  } else {
    console.log('🚀 Node.js đã thông mạch tới Database Neon Singapore thành công!');
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
  console.log("⚠️ Không tìm thấy REDIS_URL trong file config. Chạy phòng tạm bằng RAM Local.");
}

module.exports = { pool, redisClient, pubClient, subClient, config };