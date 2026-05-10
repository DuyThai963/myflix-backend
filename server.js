const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());

app.get("/api/home", async (req, res) => {
  try {
    const response = await axios.get(
      "https://ophim1.com/v1/api/home"
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch movies",
    });
  }
});

app.get("/api/movie/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const response = await axios.get(
      `https://ophim1.com/phim/${slug}`
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch movie detail",
    });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.status(400).json({ error: "Keyword is required" });
    }

    const response = await axios.get(
      `https://ophim1.com/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}`
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: "Failed to search movies",
    });
  }
});

app.get("/api/category/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const { page } = req.query; // Thêm page để phân trang nếu cần

    // Mặc định gọi trang 1 nếu không truyền
    const pageParam = page ? `?page=${page}` : '';

    const response = await axios.get(
      `https://ophim1.com/v1/api/the-loai/${slug}${pageParam}`
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch category movies",
    });
  }
});

app.get('/api/danh-sach/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1 } = req.query;
    // Gọi đến đúng endpoint danh-sach của OPhim
    const response = await axios.get(`https://ophim1.com/v1/api/danh-sach/${slug}?page=${page}`);
    res.json(response.data);
  } catch (error) {
    console.error(`Lỗi khi gọi danh-sach ${slug}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(5000, () => {
  console.log(
    "Server running on http://localhost:5000"
  );
});