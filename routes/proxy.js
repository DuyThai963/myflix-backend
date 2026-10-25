const express = require("express");
const router = express.Router();
const axios = require("axios");
const { config, redisClient } = require("../configs/db");
const { enrichMoviesWithTmdb, getTmdbMedia } = require("../services/tmdbService");

// ⚡ BỘ NHỚ ĐỆM CACHE DUAL-TIER (RAM + REDIS) ĐỂ TĂNG TỐC PHẢN HỒI 5MS
const proxyMemoryCache = new Map();
const DEFAULT_TTL_SEC = 600; // 10 phút

async function getCachedProxy(key) {
  const mem = proxyMemoryCache.get(key);
  if (mem && Date.now() - mem.time < DEFAULT_TTL_SEC * 1000) {
    return mem.data;
  }
  if (redisClient && redisClient.isReady) {
    try {
      const raw = await redisClient.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        proxyMemoryCache.set(key, { data: parsed, time: Date.now() });
        return parsed;
      }
    } catch (e) {}
  }
  return null;
}

async function setCachedProxy(key, data, ttlSec = DEFAULT_TTL_SEC) {
  proxyMemoryCache.set(key, { data, time: Date.now() });
  if (redisClient && redisClient.isReady) {
    try {
      await redisClient.setEx(key, ttlSec, JSON.stringify(data));
    } catch (e) {}
  }
}

// 🛠️ HÀM CHUẨN HÓA DỮ LIỆU ĐẦU RA CHO FRONTEND (PHIMAPI NGUỒN CHÍNH)
function normalizeListResponse(responseData) {
  if (!responseData) return { status: false, data: { items: [], params: {} } };

  let items = [];
  if (Array.isArray(responseData.items)) {
    items = responseData.items;
  } else if (responseData.data && Array.isArray(responseData.data.items)) {
    items = responseData.data.items;
  } else if (Array.isArray(responseData)) {
    items = responseData;
  }

  // Tự động xác định Domain CDN ảnh (Mặc định PhimAPI / PhimImg)
  const cdnDomain = responseData.pathImage || responseData.data?.APP_DOMAIN_CDN_IMAGE || "https://phimimg.com";

  const normalizedItems = items.map((item) => {
    let thumb = item.thumb_url || item.poster_url || "";
    let poster = item.poster_url || item.thumb_url || "";

    // Nếu URL ảnh là tương đối -> Nối thêm cdnDomain
    if (thumb && !thumb.startsWith("http")) {
      thumb = `${cdnDomain.replace(/\/+$/, '')}/${thumb.replace(/^\/+/, '')}`;
    }
    if (poster && !poster.startsWith("http")) {
      poster = `${cdnDomain.replace(/\/+$/, '')}/${poster.replace(/^\/+/, '')}`;
    }

    return {
      ...item,
      _id: item._id || item.id || item.slug,
      name: item.name || item.title || "Phim chưa đặt tên",
      slug: item.slug,
      origin_name: item.origin_name || item.name || "",
      banner: item.banner || thumb,
      poster: poster,
      thumb_url: thumb,
      poster_url: poster,
      year: item.year || 2026,
      time: item.time || "",
      episode_current: item.episode_current || "Full",
      category: item.category || [{ name: "Phim lẻ" }],
      country: item.country || [{ name: "Khác" }]
    };
  });

  return {
    status: true,
    data: {
      items: normalizedItems,
      params: responseData.params || responseData.pagination || responseData.data?.params || {}
    }
  };
}

// 1. API TRANG CHỦ / DANH SÁCH PHIM MỚI
router.get("/home", async (req, res) => {
  try {
    const page = req.query.page || 1;
    const cacheKey = `proxy_home_page_${page}`;

    const cached = await getCachedProxy(cacheKey);
    if (cached) return res.json(cached);

    const baseUrl = config.CURRENT_MOVIE_API_URL;
    const targetUrl = `${baseUrl}/v1/api/home`;

    const response = await axios.get(targetUrl, { timeout: 10000 });
    const normalized = normalizeListResponse(response.data);
    await enrichMoviesWithTmdb(normalized.data.items);

    await setCachedProxy(cacheKey, normalized, 600); // Cache 10 phút
    res.json(normalized);
  } catch (error) {
    console.error("❌ Lỗi API Home Proxy:", error.message);
    res.status(500).json({ error: "Lỗi kết nối Server phim gốc!" });
  }
});

// 2. API CHI TIẾT PHIM
router.get("/movie/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const cacheKey = `proxy_movie_${slug}`;

    const cached = await getCachedProxy(cacheKey);
    if (cached) return res.json(cached);

    const baseUrl = config.CURRENT_MOVIE_API_URL;
    const targetUrl = `${baseUrl}/phim/${slug}`;

    const response = await axios.get(targetUrl, { timeout: 10000 });
    
    const data = response.data;
    if (data && data.movie) {
      const cdnDomain = "https://phimimg.com";
      if (data.movie.thumb_url && !data.movie.thumb_url.startsWith("http")) {
        data.movie.thumb_url = `${cdnDomain}/${data.movie.thumb_url.replace(/^\/+/, '')}`;
      }
      if (data.movie.poster_url && !data.movie.poster_url.startsWith("http")) {
        data.movie.poster_url = `${cdnDomain}/${data.movie.poster_url.replace(/^\/+/, '')}`;
      }

      // Làm giàu thông tin ảnh chất lượng cao từ TMDB
      try {
        const tmdb = await getTmdbMedia(data.movie.name, data.movie.origin_name, data.movie.year);
        if (tmdb) {
          if (tmdb.banner) {
            data.movie.banner = tmdb.banner;
            data.movie.tmdb_backdrop = tmdb.banner;
          }
          if (tmdb.poster) {
            data.movie.tmdb_poster = tmdb.poster;
          }
        }
      } catch (err) {}

      data.movie.banner = data.movie.banner || data.movie.thumb_url || data.movie.poster_url;
      data.movie.poster = data.movie.poster_url || data.movie.thumb_url;
    }
    
    await setCachedProxy(cacheKey, data, 900); // Cache 15 phút
    res.json(data);
  } catch (error) {
    console.error(`❌ Lỗi API Detail (${req.params.slug}):`, error.message);
    res.status(500).json({ error: "Lỗi fetch thông tin phim!" });
  }
});

// 3. API TÌM KIẾM PHIM
router.get("/search", async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) return res.status(400).json({ error: "Vui lòng nhập từ khóa tìm kiếm!" });

    const cacheKey = `proxy_search_${encodeURIComponent(keyword.trim().toLowerCase())}`;
    const cached = await getCachedProxy(cacheKey);
    if (cached) return res.json(cached);

    const baseUrl = config.CURRENT_MOVIE_API_URL;
    const targetUrl = `${baseUrl}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}`;

    const response = await axios.get(targetUrl, { timeout: 10000 });
    const normalized = normalizeListResponse(response.data);
    await enrichMoviesWithTmdb(normalized.data.items);

    await setCachedProxy(cacheKey, normalized, 300); // Cache 5 phút
    res.json(normalized);
  } catch (error) {
    console.error("❌ Lỗi API Search Proxy:", error.message);
    res.status(500).json({ error: "Lỗi tìm kiếm phim!" });
  }
});

// 4. API THỂ LOẠI PHIM
router.get("/category/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const page = req.query.page || 1;
    const cacheKey = `proxy_category_${slug}_page_${page}`;

    const cached = await getCachedProxy(cacheKey);
    if (cached) return res.json(cached);

    const baseUrl = config.CURRENT_MOVIE_API_URL;
    const targetUrl = `${baseUrl}/v1/api/the-loai/${slug}?page=${page}`;
    const response = await axios.get(targetUrl, { timeout: 10000 });
    const normalized = normalizeListResponse(response.data);
    await enrichMoviesWithTmdb(normalized.data.items);

    await setCachedProxy(cacheKey, normalized, 600); // Cache 10 phút
    res.json(normalized);
  } catch (error) {
    console.error(`❌ Lỗi API Category (${req.params.slug}):`, error.message);
    res.status(500).json({ error: "Lỗi fetch danh mục phim!" });
  }
});

// 5. API DANH SÁCH PHIM
router.get("/danh-sach/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const page = req.query.page || 1;
    const cacheKey = `proxy_danhsach_${slug}_page_${page}`;

    const cached = await getCachedProxy(cacheKey);
    if (cached) return res.json(cached);

    const baseUrl = config.CURRENT_MOVIE_API_URL;
    const targetUrl = slug === "phim-moi-cap-nhat"
      ? `${baseUrl}/danh-sach/phim-moi-cap-nhat?page=${page}`
      : `${baseUrl}/v1/api/danh-sach/${slug}?page=${page}`;

    const response = await axios.get(targetUrl, { timeout: 10000 });
    const normalized = normalizeListResponse(response.data);
    await enrichMoviesWithTmdb(normalized.data.items);

    await setCachedProxy(cacheKey, normalized, 600); // Cache 10 phút
    res.json(normalized);
  } catch (error) {
    console.error(`❌ Lỗi API Danh Sách (${req.params.slug}):`, error.message);
    res.status(500).json({ error: "Lỗi fetch danh sách phim!" });
  }
});

module.exports = router;