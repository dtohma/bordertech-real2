/* ───────── manage.js ───────── */
import fs from "fs/promises";
import { createReadStream } from "fs";
import readline from "readline";
import path from "path";
import multer from "multer";
import basicAuth from "express-basic-auth";
import { nanoid } from "nanoid";

console.log("manage.js LOADED");

export default function addManageRoutes(app) {

/* ────────────────────────────────────────────
  1. Basic 認証
───────────────────────────────────────────── */
  app.use(
    "/manage",
    basicAuth({ users: { admin: "secret123" }, challenge: true })
  );

/* ────────────────────────────────────────────
  2. 管理画面
───────────────────────────────────────────── */
  app.get("/manage", async (req, res) => {
    try {
      let html = await fs.readFile(
        path.join(process.cwd(), "public", "manage.html"),
        "utf8"
      );

      /* ---------- 編集モード ---------- */
      let logoPath = "", opPath = "", csvPath = "";
      if (req.query.slug) {
        try {
          const cfg = JSON.parse(
            await fs.readFile(`configs/${req.query.slug}.json`, "utf8")
          );
          logoPath = cfg.logo     ?? "";
          opPath   = cfg.operator ?? "";
          csvPath  = cfg.csv      ?? "";

          html = html
            .replace('<input name="slug">', `<input name="slug" value="${cfg.slug}">`)
            .replace('<input name="titleTag">', `<input name="titleTag" value="${cfg.titleTag}">`)
            .replace('<input name="heading">', `<input name="heading" value="${cfg.heading}">`)
            .replace(/name="contact"[^>]+>/, `name="contact" value="${cfg.contact}">`)
            // ▼ 自動ジャンプ秒数を反映
            .replace('<input name="autoJumpSec" type="number" min="1" value="180">', 
                     `<input name="autoJumpSec" type="number" min="1" value="${cfg.autoJumpSec || 180}">`)
            .replace(/<textarea name="prompt"[\s\S]*?<\/textarea>/,
                     `<textarea name="prompt" rows="4" cols="40">${cfg.prompt}</textarea>`)
            .replace(/ selected/g, "")
            .replace(new RegExp(`(<option\\s+value="${cfg.voice}")`), "$1 selected")
            .replace(new RegExp(`(<option\\s+value="${cfg.model}")`), "$1 selected")
            /* ▼ 既存 CSV プレビューと hidden フィールドを追加 */
            .replace(
              '<span id="csvPrevView" class="note"></span>',
              csvPath
                ? `<span id="csvPrevView" class="note">登録済: <a href="${csvPath}" target="_blank">${csvPath.split("/").pop()}</a></span>`
                : ""
            )
            .replace(
              '<input type="hidden" name="csvPrev" id="csvPrevVal">',
              `<input type="hidden" name="csvPrev" id="csvPrevVal" value="${csvPath}">`
            );
        } catch (e) {
          console.warn("edit load error", e);
        }
      }

      /* ---------- 一覧テーブル ---------- */
      await fs.mkdir("configs", { recursive: true });
      const rows = await Promise.all(
        (await fs.readdir("configs"))
          .filter(f => f.endsWith(".json"))
          .map(async f => {
            const j = JSON.parse(await fs.readFile(`configs/${f}`, "utf8"));
            return `<tr>
                      <td><a href="/${j.slug}" target="_blank">/${j.slug}</a></td>
                      <td>${j.heading  || ""}</td>
                      <td>${j.titleTag || ""}</td>
                      <td>${j.model    || ""}</td>
                      <td>
                        <a href="/manage?slug=${j.slug}">編集</a> /
                        <a href="javascript:void(0)" data-del="${j.slug}">削除</a>
                      </td>
                    </tr>`;
          })
      );

      const table = rows.length
        ? `<table style="margin-top:20px;border-collapse:collapse;font-size:14px;width:100%">
             <tr>
               <th style="padding:4px 8px;border:1px solid #ccc">URL</th>
               <th style="padding:4px 8px;border:1px solid #ccc">見出し</th>
               <th style="padding:4px 8px;border:1px solid #ccc">タイトルタグ</th>
               <th style="padding:4px 8px;border:1px solid #ccc">モデル</th>
               <th style="padding:4px 8px;border:1px solid #ccc">操作</th>
             </tr>${rows.join("")}
           </table>`
        : "<p>まだ作成されたページはありません</p>";

      /* ---------- 日次利用分数集計 ---------- */
      const daily = {};  // {slug:{yyyy-mm-dd:min}}
      try{
        const rl = readline.createInterface({
          input: createReadStream("conversation_logs.txt"),
          crlfDelay: Infinity
        });
        for await (const line of rl){
          const [ts,page,,duration] = line.split("\t");
          if(!ts || !duration) continue;
          const slug = page.replace(/^\//,"").trim();
          const date = ts.slice(0,10);
          const min  = Math.round(+duration / 60000);
          (daily[slug] ??= {})[date] =
            (daily[slug]?.[date] ?? 0) + min;
        }
      }catch{/* ファイル無しは無視 */}

      const statHtml = Object.keys(daily).length
        ? `<h3 style="margin-top:40px">日次利用分数</h3>`+
          Object.entries(daily).map(([slug,days])=>{
            const rows = Object.entries(days)
              .sort(([a],[b])=>b.localeCompare(a))
              .map(([d,m])=>`<tr><td>${d}</td><td>${m}</td></tr>`).join("");
            return `<h4>/${slug}</h4>
                    <table style="border-collapse:collapse;margin-bottom:12px">
                      <tr><th>日付</th><th>分</th></tr>${rows}
                    </table>`;
          }).join("")
        : "";

      html = html.replace("</form>", "</form>" + table + statHtml);

      /* ---------- 画像プレビュー JS ---------- */
      html = html.replace(
        "</body>",
        `<script>
           document.addEventListener('DOMContentLoaded',()=>{
             const lp='${logoPath}', op='${opPath}';
             if(lp){
               const i=document.getElementById('logoPrev');
               const h=document.getElementById('logoPrevVal');
               if(i){i.src=lp; i.style.display='block';}
               if(h){h.value=lp;}
             }
             if(op){
               const i=document.getElementById('opPrev');
               const h=document.getElementById('opPrevVal');
               if(i){i.src=op; i.style.display='block';}
               if(h){h.value=op;}
             }
           });
         </script></body>`
      );

      res.type("html").send(html);
    } catch (e) {
      console.error("manage route error:", e);
      res.status(500).send("fail");
    }
  });

/* ────────────────────────────────────────────
  3. アップロード設定
───────────────────────────────────────────── */
  const upload = multer({
    dest: "public/uploads",
    limits: { fileSize: 20 * 1024 * 1024 }
  });

/* ────────────────────────────────────────────
  4. 保存エンドポイント
───────────────────────────────────────────── */
  app.post(
    "/manage/save",
    upload.fields([
      { name:"logo",     maxCount:1 },
      { name:"operator", maxCount:1 },
      { name:"placeCsv", maxCount:1 }
    ]),
    async (req,res)=>{
      try{
        const slug = req.body.slug || "demo-"+nanoid(6);
        const cfg = {
          slug,
          titleTag:(req.body.titleTag||"").trim(),
          heading :(req.body.heading ||"").trim(),
          contact :(req.body.contact ||"").trim(),
          prompt  :(req.body.prompt  ||"").trim(),
          voice   :(req.body.voice   ||"sage").trim(),
          model   :(req.body.model   ||"gpt-4o-realtime-preview-2024-12-17").trim(),
          logo    : req.files?.logo
                      ? req.files.logo[0].path.replace("public","")
                      : req.body.logoPrev || "",
          operator: req.files?.operator
                      ? req.files.operator[0].path.replace("public","")
                      : req.body.opPrev   || "",
          csv     : req.files?.placeCsv
                      ? req.files.placeCsv[0].path.replace("public","")
                      : (req.body.csvPrev || ""),         // ★ 既存パス保持
          autoJumpSec: req.body.autoJumpSec || "180"      // ←★追加
        };
        await fs.mkdir("configs",{recursive:true});
        await fs.writeFile(`configs/${slug}.json`, JSON.stringify(cfg,null,2));
        res.redirect("/manage?ok="+slug);
      }catch(e){
        console.error("save error",e);
        res.status(500).send("Save failed");
      }
    }
  );

/* ────────────────────────────────────────────
  5. 削除エンドポイント
───────────────────────────────────────────── */
  app.get("/manage/delete", async (req,res)=>{
    try{
      const slug = req.query.slug;
      if(!slug) return res.status(400).send("no slug");
      await fs.unlink(`configs/${slug}.json`);
      res.sendStatus(200);
    }catch(e){
      console.error("delete error",e);
      res.status(500).send("fail");
    }
  });

/* ────────────────────────────────────────────
  6. ログダウンロード
───────────────────────────────────────────── */
  app.get("/manage/logs", async (req,res)=>{
    try{
      const fpath = path.join(process.cwd(), "conversation_transcripts.jsonl");
      await fs.access(fpath);
      res.download(fpath, "conversation_transcripts.jsonl", err => {
        if(err) {
          console.error("log download error", err);
          res.status(500).send("fail");
        }
      });
    }catch(e){
      console.warn("log file missing", e);
      res.status(404).send("not found");
    }
  });

/* ────────────────────────────────────────────
  7. カスタムページ表示
───────────────────────────────────────────── */
  app.get("/:slug", async (req,res,next)=>{
    try{
      const cfg = JSON.parse(
        await fs.readFile(`configs/${req.params.slug}.json`, "utf8")
      );
      let html = await fs.readFile("public/index.html", "utf8");
      html = html
        .replace(/<title>.*?<\/title>/, `<title>${cfg.titleTag}</title>`)
        .replace(/<h2>.*?<\/h2>/, `<h2>${cfg.heading}</h2>`)
        .replace(/src="[^"]*logo[^"]*"/, `src="${cfg.logo}"`)
        // ② オペレーター画像 ― class="operator-img" の <img> タグを丸ごと置換
        .replace(/<img[^>]+class="operator-img"[^>]*>/,
                 `<img src="${cfg.operator}" class="operator-img" alt="オペレーター">`)
        .replace(/href="[^"]*inquiry[^"]*"/, `href="${cfg.contact}"`)
        .replace(
          /<textarea[^>]*id="prompt"[\s\S]*?<\/textarea>/,
          `<textarea id="prompt">${cfg.prompt}</textarea>`
        )
        .replace(/ selected/g,"")
        .replace(
          new RegExp(`(<option\\s+value="${cfg.voice}")`),
          "$1 selected"
        )
        .replace('fetch("/session")',
                 `fetch("/session?model=${cfg.model}")`)
        .replace(/const\s+MODEL_NAME\s*=\s*".*?";/,
                 `const MODEL_NAME = "${cfg.model}";`)
        .replace(/const\s+CSV_URL\s*=\s*".*?";/,
                 `const CSV_URL    = "${cfg.csv}";`);
      // ▼ 自動ジャンプ秒数とジャンプ先URLをwindow変数として注入
      html = html.replace(
        '</head>',
        `<script>
          window.AUTO_JUMP_SEC = ${cfg.autoJumpSec || 180};
          window.CONTACT_URL = "${cfg.contact}";
        </script>\n</head>`
      );
      res.send(html);
    }catch{
      next();  // 404
    }
  });

}
