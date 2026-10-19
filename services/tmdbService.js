const axios = require("axios");
const { redisClient, config } = require("../configs/db");

// Bộ nhớ đệm RAM cục bộ để phản hồi 0ms
const memoryCache = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

function cleanTitle(str) {
  if (!str) return "";
  return str
    .replace(/\((Phần|Season|Tập|Năm)\s*\d+[^)]*\)/gi, "")
    .replace(/\b(Phần|Season)\s*\d+\b/gi, "")
    .replace(/\(\d{4}\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tra cứu thông tin ảnh TMDB (Backdrop ngang và Poster dọc)
 */
async function getTmdbMedia(name, originName, year) {
  const apiKey = config.TMDB_API_KEY;
  if (!apiKey) return null;

  const query = cleanTitle(originName) || cleanTitle(name);
  if (!query) return null;

  const cacheKey = `tmdb_media:${query.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  // 1. Kiểm tra RAM cache
  const memCached = memoryCache.get(cacheKey);
  if (memCached && Date.now() - memCached.time < CACHE_TTL_MS) {
    return memCached.data;
  }

  // 2. Kiểm tra Redis cache
  if (redisClient && redisClient.isReady) {
    try {
      const redisCached = await redisClient.get(cacheKey);
      if (redisCached) {
        const parsed = JSON.parse(redisCached);
        memoryCache.set(cacheKey, { data: parsed, time: Date.now() });
        return parsed;
      }
    } catch (e) {
      // Bỏ qua lỗi Redis
    }
  }

  // 3. Gọi TMDB Search API (Dùng domain api.tmdb.org để không bị chặn tại VN)
  try {
    const url = `https://api.tmdb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}&include_adult=false`;
    const response = await axios.get(url, { timeout: 3500 });
    const results = response.data?.results || [];

    // Ưu tiên kết quả có backdrop_path
    let matched = results.find((r) => r.backdrop_path && (r.media_type === "movie" || r.media_type === "tv"));
    if (!matched && results.length > 0) {
      matched = results[0];
    }

    if (matched) {
      const mediaData = {
        banner: matched.backdrop_path ? `https://image.tmdb.org/t/p/original${matched.backdrop_path}` : null,
        poster: matched.poster_path ? `https://image.tmdb.org/t/p/w500${matched.poster_path}` : null,
        title: matched.title || matched.name || query
      };

      // Lưu RAM cache
      memoryCache.set(cacheKey, { data: mediaData, time: Date.now() });

      // Lưu Redis (7 ngày)
      if (redisClient && redisClient.isReady) {
        try {
          await redisClient.setEx(cacheKey, 7 * 86400, JSON.stringify(mediaData));
        } catch (e) {}
      }

      return mediaData;
    }
  } catch (error) {
    // Không làm sập ứng dụng nếu TMDB lỗi
    // console.warn("Lỗi tra cứu TMDB:", error.message);
  }

  return null;
}

/**
 * Làm giàu dữ liệu danh sách phim: gán banner 16:9 ngang cho Hero, giữ poster dọc cho Card
 */
async function enrichMoviesWithTmdb(items) {
  if (!Array.isArray(items) || items.length === 0) return items;

  // Thực hiện song song toàn bộ phim với Promise.allSettled
  const promises = items.map(async (item) => {
    try {
      const tmdb = await getTmdbMedia(item.name, item.origin_name, item.year);
      if (tmdb) {
        // Banner to: Ưu tiên ảnh ngang 16:9 sắc nét của TMDB
        if (tmdb.banner) {
          item.banner = tmdb.banner;
          item.tmdb_backdrop = tmdb.banner;
        }
        // Card dọc: Giữ nguyên poster_url của OPhim/PhimAPI (hoặc fallback TMDB poster nếu thiếu)
        if (!item.poster_url && tmdb.poster) {
          item.poster_url = tmdb.poster;
        }
        if (tmdb.poster) {
          item.tmdb_poster = tmdb.poster;
        }
      }
    } catch (e) {}
    
    // Đảm bảo item.banner luôn có giá trị hợp lệ
    item.banner = item.banner || item.thumb_url || item.poster_url;
    item.poster = item.poster_url || item.thumb_url;
    return item;
  });

  await Promise.allSettled(promises);
  return items;
}

module.exports = {
  getTmdbMedia,
  enrichMoviesWithTmdb,
  cleanTitle
};
