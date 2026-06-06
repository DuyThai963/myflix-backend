const express = require("express");
const router = express.Router();
const { pool } = require('../configs/db');

// 3. API ĐỒNG BỘ TIẾN TRÌNH XEM TỪ LOCAL STORAGE (ÉP SỐ NGUYÊN NÉ LỖI 500)
router.post("/sync", async (req, res) => {
  const { userId, localHistory } = req.body; 

  if (!userId || !localHistory || !Array.isArray(localHistory)) {
    return res.status(400).json({ error: "Dữ liệu đồng bộ không hợp lệ!" });
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

      if (parsedTime === 0) {
        await pool.query(
          "DELETE FROM watch_histories WHERE user_id = $1 AND watch_id = $2",
          [parsedUserId, cleanMovieId]
        );
        continue;
      }

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

    return res.json({ success: true, message: "Đã đồng bộ hóa dữ liệu sạch bóng rác!" });
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
      "SELECT * FROM watch_histories WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId]
    );
    
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

// 5. API XÓA LỊCH SỬ XEM THEO WATCH_ID (HÀM TÁCH CHUỖI SIÊU TỐC)
router.delete("/delete", async (req, res) => {
  const { userId, watchId } = req.query;

  if (!userId || !watchId) {
    return res.status(400).json({ error: "Thiếu dữ liệu userId hoặc watchId!" });
  }

  try {
    const parsedUserId = parseInt(userId, 10);
    
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

module.exports = router;