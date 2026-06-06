const express = require("express");
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, config } = require('../configs/db');

// 1. API ĐĂNG KÝ TÀI KHOẢN MỚI
router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Vui lòng nhập đầy đủ tài khoản và mật khẩu!" });
  }

  try {
    const userExist = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
    if (userExist.rows.length > 0) {
      return res.status(400).json({ error: "Tài khoản này đã tồn tại rồi Thái ơi!" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      "INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role",
      [username, hashedPassword, 'client']
    );

    res.status(201).json({ message: "Đăng ký thành công!", user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi hệ thống khi tạo tài khoản!" });
  }
});

// 2. API ĐĂNG NHẬP & CẤP HỘ CHIẾU JWT
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Vui lòng nhập đầy đủ thông tin!" });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Tài khoản hoặc mật khẩu không chính xác!" });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Tài khoản hoặc mật khẩu không chính xác!" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Đăng nhập thành công!",
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err) {
    console.error("❌ Lỗi Đăng Nhập:", err.message);
    res.status(500).json({ error: "Lỗi hệ thống khi xử lý đăng nhập!" });
  }
});

module.exports = router;