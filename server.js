import express from "express";
import fetch   from "node-fetch";
import dotenv  from "dotenv";
import path    from "path";
import fs      from "fs";
import manage  from "./manage.js";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 6200;

/* ---------- ルータ ---------- */
manage(app);                                  // static より前
app.use(express.text({ type:'text/plain' })); // ★ Beacon 用
app.use(express.static(path.join(process.cwd(),"public")));
app.use(express.json());

/* ---------- 1. Ephemeral キー取得 ---------- */
app.get("/session", async (req, res) => {
  const model = req.query.model || "gpt-4o-realtime-preview-2025-06-03";
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions",{
      method :"POST",
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body   :JSON.stringify({ model, voice:"echo" })
    });
    if(!r.ok){ return res.status(502).send("OpenAI error"); }
    res.json(await r.json());
  } catch(e){
    console.error("session error:",e);
    res.status(500).send("session fetch failed");
  }
});

/* ---------- 2. 利用ログ (+duration) ---------- */
app.post("/log",(req,res)=>{
  /* ----- Beacon(文字列) と JSON の両対応 ----- */
  let body = req.body;
  if (typeof body === "string") {          // text/plain なら JSON へ
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const instruction = (body.instruction || "なし").replace(/\r?\n/g, " ");
  const duration    = body.duration    || 0;              // ★追加（ms）
  const userIP      = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const page        = body.page || req.get("referer") || "-";
  const timestamp   = new Date().toISOString();
  const conversation= Array.isArray(body.conversation) ? body.conversation : [];

  const logEntry = `${timestamp}\t${page}\t${userIP}\t${duration}\t${instruction}\n`;
  fs.appendFile("conversation_logs.txt",logEntry,err=>{
    if(err){
      console.error("ログ書き込みエラー:",err);
      return res.status(500).send("Error logging data");
    }
    const jsonLine = JSON.stringify({timestamp,page,duration,conversation})+"\n";
    fs.appendFile("conversation_transcripts.jsonl",jsonLine,err2=>{
      if(err2) console.error("transcript write error",err2);
      res.sendStatus(200);
    });
  });
});

/* ---------- 3. 起動 ---------- */
app.listen(PORT,()=>console.log(`サーバがポート ${PORT} で起動しました`));
