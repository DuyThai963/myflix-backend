const express = require("express");
const router = express.Router();
const axios = require("axios");

router.get("/home", async (req, res) => {
  try {
    const response = await axios.get("https://ophim1.com/v1/api/home");
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: "Failed to fetch movies" }); }
});

router.get("/movie/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const response = await axios.get(`https://ophim1.com/phim/${slug}`);
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: "Failed to fetch movie detail" }); }
});

router.get("/search", async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) return res.status(400).json({ error: "Keyword is required" });
    const response = await axios.get(`https://ophim1.com/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}`);
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: "Failed to search movies" }); }
});

router.get("/category/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const { page } = req.query;
    const pageParam = page ? `?page=${page}` : '';
    const response = await axios.get(`https://ophim1.com/v1/api/the-loai/${slug}${pageParam}`);
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: "Failed to fetch category movies" }); }
});

router.get('/danh-sach/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1 } = req.query;
    const response = await axios.get(`https://ophim1.com/v1/api/danh-sach/${slug}?page=${page}`);
    res.json(response.data);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;