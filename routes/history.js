const express = require("express");
const router = express.Router();
const { pool } = require('../configs/db');

// 2. API KHỞI TẠO KHUNG TĨNH KHI MỞ MODAL (BẢO TOÀN THỜI GIAN & GÁC CỔNG 15 PHIM)
router.post("/init", async (req, res) => {
  const { userId, movieId, episodeSlug, episodeName, currentTime, movie } = req.body;

  if (!userId || !movieId || !movie) {
    console.warn("⚠️ [DB History /init WARNING] Thiếu dữ liệu khởi tạo:", { userId, movieId, hasMovie: Boolean(movie) });
    return res.status(400).json({ error: "Thiếu dữ liệu khởi tạo!" });
  }

  try {
    const parsedUserId = parseInt(userId, 10);
    const watchId = String(movieId).split('-')[0];
    
    console.log(`📌 [DB History /init] UserId=${parsedUserId} | WatchId=${watchId} | Ep=${episodeSlug} | Title="${movie?.title || movie?.name}"`);

    const upsertQuery = `
      INSERT INTO watch_histories (user_id, watch_id, episode_slug, episode_name, watched_time, movie, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id, watch_id) 
      DO UPDATE SET 
        episode_slug = EXCLUDED.episode_slug,
        episode_name = EXCLUDED.episode_name,
        movie = EXCLUDED.movie,
        updated_at = NOW();
    `;

    const upsertValues = [
      parsedUserId, 
      watchId, 
      episodeSlug ? String(episodeSlug) : "1", 
      episodeName ? String(episodeName) : "Tập 1", 
      0, // Luôn insert 0 cho lúc khởi tạo mới
      typeof movie === "string" ? movie : JSON.stringify(movie)
    ];

    await pool.query(upsertQuery, upsertValues);

    // 2. KHỐI GÁC CỔNG 15 PHIM: Xóa các bản ghi cũ nếu user vượt quá 15 phim
    await pool.query(`
      DELETE FROM watch_histories 
      WHERE user_id = $1
        AND watch_id IN (
          SELECT watch_id FROM watch_histories 
          WHERE user_id = $1 
          ORDER BY updated_at DESC 
          OFFSET 15
        )
    `, [parsedUserId]);

    return res.json({ success: true, message: "Đã khởi tạo khung tĩnh và kiểm soát giới hạn 15 phim!" });
  } catch (err) {
    console.error("❌ [LỖI KHỐI INIT BACKEND]:", err.message);
    return res.status(500).json({ error: "Lỗi hệ thống khi khởi tạo dữ liệu!" });
  }
});

// 3. API ĐỒNG BỘ TIẾN TRÌNH XEM TỪ LOCAL STORAGE HOẶC PLAYER
router.post("/sync", async (req, res) => {
  const { userId, localHistory } = req.body; 

  if (!userId || !localHistory || !Array.isArray(localHistory)) {
    return res.status(400).json({ error: "Dữ liệu đồng bộ không hợp lệ!" });
  }

  if (localHistory.length === 0) {
    return res.json({ success: true, message: "Không có dữ liệu local mới để đồng bộ." });
  }

  try {
    const parsedUserId = parseInt(userId, 10);
    const uniqueHistoryMap = new Map();

    localHistory.forEach((item) => {
      if (!item || !item.watchId) return;
      
      const cleanMovieId = item.watchId.includes("-") ? item.watchId.split('-')[0] : item.watchId;
      
      if (!uniqueHistoryMap.has(cleanMovieId)) {
        uniqueHistoryMap.set(cleanMovieId, item);
      } else {
        const existingItem = uniqueHistoryMap.get(cleanMovieId);
        const existingTime = existingItem.updatedAt ? new Date(existingItem.updatedAt).getTime() : 0;
        const currentItemTime = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;

        if (currentItemTime > existingTime) {
          uniqueHistoryMap.set(cleanMovieId, item);
        }
      }
    });

    for (const item of uniqueHistoryMap.values()) {
      const { watchId, episodeSlug, episodeName, currentTime, movie } = item;
      const parsedTime = Math.round(parseFloat(currentTime || 0));
      const cleanMovieId = watchId && watchId.includes("-") ? watchId.split('-')[0] : watchId;

      console.log(`📌 [DB History /sync] UserId=${parsedUserId} | CleanWatchId=${cleanMovieId} | Time=${parsedTime}s | Ep=${episodeSlug}`);

      await pool.query(`
        INSERT INTO watch_histories (user_id, watch_id, episode_slug, episode_name, watched_time, movie, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id, watch_id) 
        DO UPDATE SET 
          episode_slug = EXCLUDED.episode_slug,
          episode_name = EXCLUDED.episode_name,
          watched_time = EXCLUDED.watched_time,
          movie = EXCLUDED.movie,
          updated_at = NOW();
      `, [
        parsedUserId, 
        cleanMovieId, 
        episodeSlug ? String(episodeSlug) : "1", 
        episodeName ? String(episodeName) : "Tập 1", 
        parsedTime, 
        typeof movie === "string" ? movie : JSON.stringify(movie)
      ]);
    }

    // 🛡️ BẮT BUỘC: Gọt sạch mảng lịch sử về tối đa 15 phim mới nhất
    await pool.query(`
      DELETE FROM watch_histories 
      WHERE id IN (
        SELECT id FROM watch_histories 
        WHERE user_id = $1 
        ORDER BY updated_at DESC 
        OFFSET 15
      )
    `, [parsedUserId]);

    return res.json({ success: true, message: "Đã đồng bộ hóa dữ liệu và dọn dẹp sạch mảng rác vượt ngưỡng 15 bản ghi!" });
  } catch (err) {
    console.error("❌ [LỖI KHỐI SYNC BACKEND]:", err.message);
    return res.status(500).json({ error: "Lỗi hệ thống!" });
  }
});

// 4. API LẤY LỊCH SỬ XEM RIÊNG RA TRANG CHỦ
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM watch_histories WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 15",
      [userId]
    );
    
    console.log(`📌 [DB History GET /:userId] User ${userId} -> Retrived ${result.rows.length} history items`);

    const formattedHistory = result.rows.map((row) => ({
      watchId: row.watch_id,
      episodeSlug: row.episode_slug,
      episodeName: row.episode_name,
      currentTime: parseFloat(row.watched_time),
      updatedAt: row.updated_at,
      movie: row.movie 
    }));

    res.json(formattedHistory);
  } catch (err) {
    console.error("❌ Lỗi lấy lịch sử từ DB:", err.message);
    res.status(500).json({ error: "Lỗi hệ thống khi lấy lịch sử xem phim!" });
  }
});

// 5. API XÓA LỊCH SỬ XEM THEO WATCH_ID
router.delete("/delete", async (req, res) => {
  const { userId, watchId } = req.query;

  if (!userId || !watchId) {
    return res.status(400).json({ error: "Thiếu dữ liệu userId hoặc watchId!" });
  }

  try {
    const parsedUserId = parseInt(userId, 10);
    console.log(`📌 [DB History DELETE] User ${parsedUserId} deleting watchId=${watchId}`);
    
    const queryText = `
      DELETE FROM watch_histories 
      WHERE user_id = $1 
        AND (watch_id = $2 OR SPLIT_PART(watch_id, '-', 1) = $2)
    `;
    const queryValues = [parsedUserId, watchId];
    const deleteOp = await pool.query(queryText, queryValues);

    return res.json({ success: true, rowCount: deleteOp.rowCount });
  } catch (err) {
    console.error("❌ [Server API Delete LỖI THỰC THI SQL]:", err.message);
    return res.status(500).json({ error: "Lỗi hệ thống khi tương tác với Database!" });
  }
});

// 6. API CẬP NHẬT NHANH MỐC THỜI GIAN
router.post("/update-time", async (req, res) => {
  const { userId, movieId, currentTime } = req.body;

  if (!userId || !movieId) {
    return res.status(400).json({ error: "Thiếu dữ liệu update-time!" });
  }

  try {
    const parsedUserId = parseInt(userId, 10);
    const parsedTime = Math.round(parseFloat(currentTime || 0));
    const cleanMovieId = movieId && movieId.includes("-") ? movieId.split("-")[0] : movieId;

    console.log(`📌 [DB History /update-time] User ${parsedUserId} | CleanMovieId=${cleanMovieId} | Time=${parsedTime}s`);

    await pool.query(
      `UPDATE watch_histories SET watched_time = $1, updated_at = NOW() WHERE user_id = $2 AND watch_id = $3`,
      [parsedTime, parsedUserId, cleanMovieId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ [LỖI KHỐI UPDATE TIME BACKEND]:", err.message);
    return res.status(500).json({ error: "Lỗi hệ thống!" });
  }
});

module.exports = router;