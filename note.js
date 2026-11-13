// ============================================================
// 筆記模組 (Page 21)
// ============================================================
// 資料存在使用者選定的資料夾（網路磁碟或本機），不經 Gist，也不走 dirty／存檔機制
// 一本筆記本對應一個資料夾，可同時加入多本（共用的放公槽、私人的放自己電腦）
// 相依 app.js 的 isLoggedIn、ecUser、settingsData、Utils、ToastModule，必須在 app.js 之後載入
// 貼文內容存 HTML，用微軟的 roosterjs 編輯（第一次張貼或編輯時才載入）；舊貼文與回覆仍是 Markdown

const NoteModule = (() => {
  // 網址帶 notedemo 時改用瀏覽器私有空間，供測試用
  const DEMO = location.search.includes("notedemo");
  const PAGE_SIZE = 20;
  const CH_EMOJI = "📝";
  const BOOK_EMOJI = "📒";
  const EMOJIS = ["📝", "📌", "📁", "💼", "⚙️", "🧩", "📦", "🔧", "💡", "📊", "📅", "✅", "❗", "🐞", "🧪", "📚", "🏭", "🖥️", "🔌", "🧾", "👥", "⭐", "🚀", "👻"];
  const ANN_ON = "px-4 py-5 text-white rounded-t-lg";
  const ANN_OFF = "px-4 py-3 text-gray-800";
  // 顏色來自貼文檔，只收六碼色碼
  const annColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
  // 預設色與自選色用同一條漸層公式，色調才一致
  const ANN_DEFAULT = "#0078d4";
  const annBg = (c) => `linear-gradient(to right, ${c || ANN_DEFAULT}, color-mix(in srgb, ${c || ANN_DEFAULT} 60%, white))`;
  // CDN 一律鎖版本
  const ROOSTER_URL = "https://cdn.jsdelivr.net/npm/roosterjs@9.62.0/dist/rooster-min.js";
  // 取自 Teams 的調色盤
  const TEXT_COLORS = ["#B6424C", "#CD5937", "#FDC030", "#BDCB4C", "#2B9B62", "#37797B", "#1E53A3", "#A5397A"];
  const MARK_COLORS = ["#DF9299", "#F4A593", "#FDD472", "#E5F18F", "#82CDA8", "#9DD9DB", "#C7D4E8", "#EBD3E1"];
  // 儲存格底色取自 Notion 表格的十色；第一格白色等同清除
  const CELL_COLORS = ["#FFFFFF", "#F1F1EF", "#F3EEEE", "#F8ECDF", "#FAF3DD", "#EEF3ED", "#E9F3F7", "#F6F3F8", "#F9F2F5", "#FAECEC"];
  // 傳給 roosterjs 蓋掉它預設的引用樣式；值要和 index.html 的 .note-md blockquote 一致
  const QUOTE_FORMAT = { backgroundColor: "#f9fafb", borderLeft: "1px solid #e5e7eb", borderTop: "1px solid #e5e7eb", borderRight: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb", paddingLeft: "16px", paddingRight: "16px", paddingTop: "12px", paddingBottom: "12px", marginLeft: "0", marginRight: "0", marginTop: "8px", marginBottom: "8px" };
  // 提醒區塊是帶行內底色的引用；編輯器不保留 class，類型靠底色來認
  // 圖示由 index.html 的樣式依底色補上，底色改了那邊要一起改
  // 類型 → [標題, 圖示, 圖示色, 底色, 框線色, 標題文字色]
  const ALERTS = {
    NOTE: ["備註", "circle-info", "#3b82f6", "#eff6ff", "#bfdbfe", "#1d4ed8"],
    TIP: ["提示", "lightbulb", "#10b981", "#ecfdf5", "#a7f3d0", "#047857"],
    IMPORTANT: ["重要", "circle-exclamation", "#a855f7", "#faf5ff", "#e9d5ff", "#7e22ce"],
    WARNING: ["注意", "triangle-exclamation", "#f59e0b", "#fffbeb", "#fde68a", "#b45309"],
    CAUTION: ["警告", "circle-xmark", "#ef4444", "#fef2f2", "#fecaca", "#b91c1c"],
  };
  // 手打的標記，例如 [!NOTE]
  const ALERT_MARK = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \u00a0]*/i;
  // 比對用：瀏覽器與編輯器存色碼時會改寫成 rgb()，要先換成同一種寫法
  const toRgb = (c) => { const x = document.createElement("i"); x.style.color = c; return x.style.color; };
  const ALERT_BGS = new Set(Object.values(ALERTS).map((a) => toRgb(a[3])));
  const alertStyle = (type) => `background-color:${ALERTS[type][3]};border:1px solid ${ALERTS[type][4]}`;
  const alertTitle = (type) => `<div><b style="color:${ALERTS[type][5]}">${ALERTS[type][0]}</b></div>`;
  // [圖示, 指令, 提示文字]；null 為分隔線，字串為下拉選單
  const TOOLS = [
    ["bold", "bold", "粗體"], ["italic", "italic", "斜體"], ["underline", "underline", "底線"], ["strikethrough", "strike", "刪除線"], null,
    ["list-ul", "ul", "項目符號"], ["list-ol", "ol", "編號清單"], null,
    "mark", "color", "size", null,
    ["quote-left", "quote", "引用"], ["link", "link", "連結"], ["square-code", "codeblock", "程式碼區塊"], "table", null,
    "more",
  ];
  const ICON_BTN ="flex items-center justify-center w-8 h-8 shrink-0 text-gray-500 rounded-md transition-colors hover:text-ms-blue hover:bg-gray-100";

  const S = {
    inited: false,
    books: [], book: null, channel: null,
    names: {}, posts: new Map(), allLoaded: false,
    shown: PAGE_SIZE, query: "", editing: null, openReplies: new Set(),
    // eds：表單代號 → 編輯器；editBase：編輯前的內容，用來判斷有沒有改；attached：附件檔名 → 存放的筆記本
    rooster: null, eds: {}, editBase: null, attached: new Map(), uploading: 0,
  };
  const urlCache = new Map();
  const $ = (id) => document.getElementById(id);
  const esc = Utils.escapeHtml;
  // 資料夾裡的檔案不可信：編號會被放進按鈕的點擊指令，只收英數、底線、連字號
  const SAFE_ID = /^[\w-]+$/;
  // 不收表單元件與 class／id，避免假登入框或撞到頁面既有的元素
  const CLEAN = { FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option", "style"], FORBID_ATTR: ["class", "id", "name"] };
  const clean = (html) => DOMPurify.sanitize(html, CLEAN);
  const md = (src) => clean(marked.parse(src || "", { breaks: true }));
  // 貼文有 format: "html" 的是新格式，沒有的是舊的 Markdown
  const bodyHtml = (p) => (p.format === "html" ? clean(p.body) : md(p.body));
  // 圖片路徑先收進 data-file：留在 src 瀏覽器會先向網站請求而失敗
  // 先填一張透明圖，沒有 src 的圖瀏覽器會畫出深色破圖框
  const BLANK_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const lazy = (html) => html.replace(/(<img\b[^>]*?\s)src="files\//g, `$1src="${BLANK_IMG}" data-file="files/`);
  const plainText = (p) => (p.format === "html" ? new DOMParser().parseFromString(p.body, "text/html").body.textContent : p.body);

  // 內文裡的定位樣式可以蓋住整頁，一律拿掉
  DOMPurify.addHook("afterSanitizeAttributes", (node) => { if (node.style && node.style.position) node.style.position = ""; });

  // ===== 小工具 =====

  /* 檔名用的時間戳，依字串排序即時間順序 */
  function stamp(t = Date.now()) {
    const d = new Date(t), z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  }

  /* 貼文時間：沿用小幫手的日期與時間寫法，一律帶年份 */
  function fmt(t) {
    const d = new Date(t);
    // formatTime 是全站共用的，上午／下午後面的空格只在筆記這裡補
    return DateUtils.format(d) + " " + formatTime(d).replace(/^(上午|下午)/, "$1 ");
  }

  /* 姓名旁細線的顏色：人員設定裡有指定就用指定的，沒有就依工號固定配一色 */
  function barColor(x) {
    const m = (settingsData.maintainers || []).find((y) => y.id && y.id === x.authorId);
    if (m && annColor(m.color)) return m.color;
    const key = String(x.authorId || x.author || "");
    return TEXT_COLORS[[...key].reduce((a, c) => a + c.charCodeAt(0), 0) % TEXT_COLORS.length];
  }

  /* 目前登入者 */
  function me() {
    const m = (settingsData.maintainers || []).find((x) => x.id === ecUser);
    return { id: ecUser, name: (m && m.name) || ecUser };
  }

  const bookOf = (key) => S.books.find((b) => b.key === key);
  const channelOf = (b, id) => ((b && b.channels) || []).find((c) => c.id === id) || { id, name: "（已不存在的頻道）" };
  const namesKey = (b, ch) => b.key + "/" + ch;
  // 不同筆記本可能出現相同的貼文編號，記憶體索引要帶筆記本代號
  const postKey = (p) => p._book + "/" + p.id;

  // ===== 檔案存取 =====

  /* 記住已加入的筆記本資料夾 */
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const open = indexedDB.open("ecnote", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => rej(open.error);
      open.onsuccess = () => {
        const rq = fn(open.result.transaction("kv", mode).objectStore("kv"));
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      };
    });
  }

  async function saveBooks() {
    if (!DEMO) await idb("readwrite", (s) => s.put(S.books.map(({ key, handle }) => ({ key, handle })), "books"));
  }

  async function readJson(dir, name, fallback) {
    try {
      return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
    } catch (e) {
      // 只有檔案不存在才回傳預設值，其他錯誤往外丟，避免把壞掉的檔案當成空的再覆寫
      if (e.name === "NotFoundError") return fallback;
      throw e;
    }
  }

  async function writeFile(dir, name, data) {
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(data);
    await w.close();
  }

  // 垃圾桶當成一個特殊頻道，貼文檔放在筆記本的 trash 資料夾
  const TRASH = "@trash";
  const channelDir = (b, ch) => (ch === TRASH ? b.trashDir : b.postsDir.getDirectoryHandle(ch, { create: true }));

  /* _book、_trash 只是記憶體裡的標記，不寫進檔案 */
  async function savePost(p) {
    await writeFile(await channelDir(bookOf(p._book), p.channel), p.id + ".json", JSON.stringify({ ...p, _book: undefined, _trash: undefined }));
  }

  /* 產生不重複的貼文檔名：日期時間＋工號 */
  async function newPostId(dir) {
    const base = `${stamp()}-${ecUser.replace(/[^\w-]/g, "_")}`;
    for (let i = 1; ; i++) {
      const id = i === 1 ? base : `${base}-${i}`;
      try { await dir.getFileHandle(id + ".json"); } catch { return id; }
    }
  }

  async function fileUrl(b, name) {
    const k = b.key + "/" + name;
    if (!urlCache.has(k)) urlCache.set(k, URL.createObjectURL(await (await b.filesDir.getFileHandle(name)).getFile()));
    return urlCache.get(k);
  }

  /* 連續的圖片排成每列三張的方形縮圖；只在顯示時排，不存進貼文 */
  function groupImages(root) {
    // 所有圖都收成縮圖塊（單張也是），隔著文字的也一樣，否則圖片會全幅撐開
    const imageOnly = (x) => x.nodeType === 1 && !x.textContent.trim() && !!x.querySelector("img") && !x.querySelector("table, pre, a");
    // 空行不算中斷
    const blank = (x) => (x.nodeType === 3 ? !x.data.trim() : x.nodeType === 1 && x.tagName !== "HR" && !x.textContent.trim() && !x.querySelector("img, table, pre, hr, a"));
    let run = [];
    const flush = () => {
      const imgs = run.flatMap((x) => (x.tagName === "IMG" ? [x] : [...x.querySelectorAll("img")]));
      if (imgs.length) {
        // 固定尺寸的方格（約同 Teams 的縮圖大小），貼文寬度不同時縮圖也一樣大
        // 前面緊鄰著另一個縮圖格時直接併進去，不另起一格，位置才不會錯開
        const prev = run[0].previousElementSibling;
        const grid = prev && prev.classList.contains("note-grid") ? prev : document.createElement("div");
        grid.className = "note-grid flex flex-wrap gap-1.5 my-2";
        run[0].before(grid);
        imgs.forEach((img) => {
          // 編輯時拖拉出來的寬高會破壞方形縮圖
          ["style", "width", "height"].forEach((a) => img.removeAttribute(a));
          img.className = "w-44 h-44 object-cover !m-0";
          grid.appendChild(img);
        });
        // 圖片本身已經搬進縮圖格，不能再刪
        run.forEach((x) => { if (x.tagName !== "IMG") x.remove(); });
      }
      run = [];
    };
    for (const x of [...root.childNodes]) {
      if (x.tagName === "IMG" || imageOnly(x)) run.push(x);
      else if (!(run.length && blank(x))) flush();
    }
    flush();
    // 圖片和文字、附件擠在同一個段落裡時上面掃不到，改掃圖片自己的相鄰兄弟
    [...root.querySelectorAll("img")].forEach((img) => {
      if (img.closest("a, pre, table") || img.parentElement.classList.contains("note-grid")) return;
      run = [img];
      for (let n = img.nextSibling; n && (n.tagName === "IMG" || blank(n)); n = n.nextSibling) if (n.tagName === "IMG") run.push(n);
      flush();
    });
  }

  /* 舊寫法的引用換成現在的樣子；顯示前與進編輯器前都要做 */
  function upgradeQuotes(root) {
    root.querySelectorAll("blockquote").forEach((q) => {
      const m = ALERT_MARK.exec(q.textContent);
      if (!m) {
        // 舊貼文存著左邊粗線的行內樣式，拿掉後外觀全交給 index.html
        if (!ALERT_BGS.has(q.style.backgroundColor)) q.removeAttribute("style");
        return;
      }
      // 舊貼文與 Markdown 回覆是用 [!NOTE] 標記寫的
      const type = m[1].toUpperCase();
      // 標記在第一個有字的文字節點裡（Markdown 轉出來的引用開頭會先有一個換行）
      const walker = document.createTreeWalker(q, NodeFilter.SHOW_TEXT);
      let first = walker.nextNode();
      while (first && !first.data.trim()) first = walker.nextNode();
      first.data = first.data.replace(ALERT_MARK, "");
      // 標記獨占一行時，拿掉它之後那一行就空了；Markdown 寫法則是標記後面跟著一個換行
      const line = first.parentElement;
      if (line !== q && !line.textContent.trim() && !line.querySelector("img")) line.remove();
      else if (!first.data && first.nextSibling && first.nextSibling.tagName === "BR") first.nextSibling.remove();
      q.style.cssText = alertStyle(type);
      q.insertAdjacentHTML("afterbegin", alertTitle(type));
    });
  }

  /* 把內文裡的 files/ 連結換成實際檔案，外部連結開新分頁 */
  function hydrate(el) {
    el.querySelectorAll(".note-md:not([contenteditable])").forEach(groupImages);
    // 修掉結尾空行之前存的貼文，顯示時也把結尾空行剪掉
    el.querySelectorAll(".note-md:not([contenteditable])").forEach((box) => {
      while (box.lastElementChild && !box.lastElementChild.textContent.trim() &&
        !box.lastElementChild.querySelector("img, table, hr") && box.lastElementChild.tagName !== "HR") {
        box.lastElementChild.remove();
      }
    });
    // 沒調過的欄寬顯示時拿掉，表格依內容自適應；拉過的欄寬保留（roosterjs 預設值依欄數是 120、100、70px）
    el.querySelectorAll(".note-md:not([contenteditable]) :is(td, th)").forEach((c) => { if (/^(120|100|70)px$/.test(c.style.width)) c.style.width = ""; });
    const nameOf = (node, attr) => { try { return decodeURIComponent(node.getAttribute(attr).slice(6)); } catch { return ""; } };
    el.querySelectorAll("[data-book]").forEach((box) => {
      const b = bookOf(box.dataset.book);
      if (!b) return;
      box.querySelectorAll(".note-md img[data-file]").forEach((img) => {
        // 佔位塊要等圖片真的畫出來才清掉，先清會先閃一下空白
        fileUrl(b, nameOf(img, "data-file")).then((u) => {
          img.onload = () => { img.style.background = "none"; img.style.minHeight = "0"; };
          img.src = u;
        }).catch(() => {});
        img.classList.add("cursor-zoom-in");
        // 還沒從公槽載完的圖 src 是透明佔位圖，先不理會點擊，否則放大視窗是空白的
        img.onclick = () => img.src.startsWith("data:") || zoom(img.src, [...img.closest(".note-md").querySelectorAll("img[data-file]")].map((x) => x.src));
      });
      box.querySelectorAll('.note-md a[href^="files/"]').forEach((a) => {
        const name = nameOf(a, "href");
        // 存檔用的檔名會把 # 等符號換掉，下載時要還原成原本的檔名（記在 title）
        const orig = a.getAttribute("title") || a.textContent.trim() || name.slice(name.indexOf("_") + 1);
        a.onclick = safe(async (e) => {
          e.preventDefault();
          const dl = document.createElement("a");
          dl.href = await fileUrl(b, name);
          dl.download = orig;
          dl.click();
        });
        a.title = orig;
      });
    });
    el.querySelectorAll('.note-md a[href^="http"]').forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
    el.querySelectorAll(".note-md:not([contenteditable])").forEach(upgradeQuotes);
    // 程式碼區塊包上標頭與複製鈕；只在顯示時加，不存進貼文
    // 行號由 index.html 的計數器畫在每一行前面，前提是一行一個區塊
    el.querySelectorAll(".note-md pre").forEach((pre) => {
      if (pre.parentElement.classList.contains("note-code")) return;
      const text = pre.innerText.replace(/\n$/, "");
      const box = document.createElement("div");
      box.className = "my-2 overflow-hidden bg-white border border-gray-200 rounded-md";
      box.innerHTML = `
        <div class="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100">
          <i class="fa-solid fa-code"></i><span class="flex-1"></span>
          <button type="button" aria-label="複製" class="text-sm text-gray-500 transition-colors hover:text-ms-blue"><i class="fa-solid fa-clone"></i></button>
        </div>
        <div class="note-code overflow-auto max-h-96 font-mono text-xs leading-relaxed"></div>`;
      // 擠在同一個區塊裡的多行要拆開（舊 Markdown 的 code、由選取文字轉成的區塊）
      const packed = (x) => !x.children.length || (x.children.length === 1 && x.firstElementChild.tagName === "CODE");
      for (const x of packed(pre) ? [pre] : [...pre.children].filter((c) => !c.children.length && c.textContent.includes("\n"))) {
        const lines = x.textContent.replace(/\n$/, "").split("\n").map((l) => `<div>${esc(l) || "<br>"}</div>`).join("");
        if (x === pre) pre.innerHTML = lines;
        else x.outerHTML = lines;
      }
      pre.replaceWith(box);
      box.lastElementChild.appendChild(pre);
      const btn = box.querySelector("button");
      btn.onclick = safe(async () => {
        await navigator.clipboard.writeText(text);
        btn.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(() => (btn.innerHTML = '<i class="fa-solid fa-clone"></i>'), 1500);
      });
    });
  }

  // ===== 載入 =====

  /* 進入分頁：app.js 的 renderPageUI(21) 呼叫，登入登出時也會再進來一次 */
  async function open() {
    if (!$("noteRoot")) return;
    if (!S.inited) {
      if (DEMO) S.books = [{ key: "demo", handle: await navigator.storage.getDirectory(), ready: true }];
      else {
        if (!window.showDirectoryPicker) {
          $("noteRoot").innerHTML = `<div class="flex items-center justify-center h-full text-gray-500">這個瀏覽器不支援筆記功能，請改用電腦版 Chrome 或 Edge</div>`;
          return;
        }
        S.books = (await idb("readonly", (s) => s.get("books"))) || [];
        for (const b of S.books) b.ready = (await b.handle.queryPermission({ mode: "readwrite" })) === "granted";
      }
      S.inited = true;
    }
    if (!S.books.length) return renderWelcome();
    // 外框只建一次，登入登出重進時草稿才不會被清掉
    if (!$("noteList")) renderShell();
    await reload();
  }

  /* 加入筆記本；瀏覽器規定選資料夾必須由使用者點擊觸發 */
  async function addBook() {
    if (!isLoggedIn) return;
    let h;
    try { h = await showDirectoryPicker({ mode: "readwrite" }); } catch { return; }
    for (const b of S.books) if (await b.handle.isSameEntry(h)) return ToastModule.show("這個資料夾已經加入過了", "warning");
    await addBookHandle(h);
  }

  async function addBookHandle(h) {
    const b = { key: "b" + Date.now().toString(36), handle: h, ready: true };
    S.books.push(b);
    await saveBooks();
    S.book = b.key;
    S.channel = null;
    await open();
    // 資料夾裡還沒有名稱設定代表是全新的筆記本，請使用者取名
    if (isLoggedIn && b.ready && !b.hasMeta) bookDialog(b.key);
  }

  /* 重新取得資料夾權限；必須由使用者點擊觸發 */
  async function grant(key) {
    const b = bookOf(key);
    b.ready = (await b.handle.requestPermission({ mode: "readwrite" })) === "granted";
    if (b.ready) { S.book = key; S.channel = null; }
    await reload();
  }

  /* 上方功能列的重新整理：重讀完要有提示，否則內容沒變時看不出有反應 */
  async function refresh() {
    await reload();
    ToastModule.show("筆記已重新整理", "success");
  }

  /* 從資料夾重新讀取 */
  async function reload() {
    if (!$("noteList")) return open();
    for (const b of S.books.filter((x) => x.ready)) {
      try {
        b.postsDir = await b.handle.getDirectoryHandle("posts", { create: true });
        b.filesDir = await b.handle.getDirectoryHandle("files", { create: true });
        b.trashDir = await b.handle.getDirectoryHandle("trash", { create: true });
        const meta = await readJson(b.handle, "notebook.json", null);
        b.hasMeta = !!meta;
        b.name = (meta && meta.name) || b.handle.name || "示範筆記本";
        b.emoji = (meta && meta.emoji) || BOOK_EMOJI;
        b.channels = (await readJson(b.handle, "channels.json", [])).filter((c) => c && SAFE_ID.test(c.id));
        if (!b.channels.length) {
          b.channels = [{ id: "ch01", name: "一般", emoji: CH_EMOJI }];
          if (isLoggedIn) await writeFile(b.handle, "channels.json", JSON.stringify(b.channels));
        }
      } catch (e) {
        // 一本讀不到（例如網路磁碟斷線）不能拖累其他筆記本
        console.error(e);
        b.ready = false;
        ToastModule.show(`「${esc(b.name || b.handle.name)}」讀取失敗，請確認資料夾是否連得上`, "error", 4000);
      }
    }
    S.names = {};
    S.posts = new Map();
    S.allLoaded = false;
    let cur = bookOf(S.book);
    if (!cur || !cur.ready) cur = S.books.find((b) => b.ready);
    S.book = cur ? cur.key : null;
    if (cur && (S.channel === TRASH ? !isLoggedIn : !cur.channels.some((c) => c.id === S.channel))) S.channel = cur.channels[0].id;
    syncAuth();
    renderSidebar();
    await renderList();
  }

  /* 列出頻道內的貼文檔名（只列檔名不開檔），新的在前 */
  async function listNames(b, ch) {
    const k = namesKey(b, ch);
    if (!S.names[k]) {
      const names = [];
      for await (const h of (await channelDir(b, ch)).values()) if (h.kind === "file" && h.name.endsWith(".json")) names.push(h.name);
      S.names[k] = names.sort().reverse();
    }
    return S.names[k];
  }

  /* 讀進指定範圍內還沒載入的貼文 */
  async function loadPosts(b, ch, names) {
    const dir = await channelDir(b, ch);
    await Promise.all(names.filter((n) => !S.posts.has(b.key + "/" + n.slice(0, -5))).map(async (n) => {
      try {
        const p = await readJson(dir, n);
        // 檔名與內容的編號不一致、或編號不合規的檔案不收
        if (!p || !SAFE_ID.test(p.id) || p.id + ".json" !== n) return;
        Object.assign(p, { _book: b.key, _trash: ch === TRASH || undefined, title: String(p.title ?? ""), body: String(p.body ?? "") });
        p.replies = (Array.isArray(p.replies) ? p.replies : []).filter((r) => r && SAFE_ID.test(r.id));
        S.posts.set(postKey(p), p);
      } catch (e) { console.warn("筆記讀取失敗", n, e); }
    }));
  }

  /* 搜尋要比對內文，第一次搜尋時才把全部貼文讀進來 */
  async function loadAll() {
    if (S.allLoaded) return;
    for (const b of S.books.filter((x) => x.ready)) for (const c of b.channels) await loadPosts(b, c.id, await listNames(b, c.id));
    S.allLoaded = true;
  }

  // ===== 畫面 =====

  function renderWelcome() {
    $("noteRoot").innerHTML = `
    <div class="flex items-center justify-center h-full">
      <div class="w-96 p-8 text-center bg-white border border-gray-200 rounded-xl shadow-md note-fade">
        <div class="text-5xl">${BOOK_EMOJI}</div>
        <div class="mt-3 font-bold text-xl text-gray-800">筆記</div>
        <div class="mt-2 text-sm leading-relaxed text-gray-500">筆記存放在你選的資料夾裡<br>共用的選公槽上的資料夾，私人的選自己電腦上的資料夾</div>
        ${isLoggedIn ? `
        <button onclick="NoteModule.addBook()" class="w-full mt-5 btn-primary">選擇資料夾</button>
        <div class="mt-4 text-xs leading-relaxed text-gray-400">之後瀏覽器詢問權限時選「每次造訪時都允許」<br>就不用再重選</div>` : `
        <div class="mt-5 px-4 py-2 text-sm text-gray-500 bg-gray-100 rounded-md">請先登入才能加入筆記本</div>`}
      </div>
    </div>`;
  }

  /* 固定外框：筆記本與頻道欄、標題列、張貼區 */
  function renderShell() {
    if (!S.menuBound) {
      // 點下拉選單以外的地方時收起選單
      $("noteRoot").addEventListener("click", (e) => $("noteRoot").querySelectorAll("details[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
      S.menuBound = true;
    }
    $("noteRoot").innerHTML = `
    <div class="flex overflow-hidden h-full bg-[#f5f5f5] border border-gray-200 rounded-lg shadow-md">
      <aside class="flex flex-col shrink-0 w-64 bg-[#ebebeb] border-r border-gray-200">
        <div class="px-4 pt-4 pb-2 font-bold text-lg text-gray-800">筆記</div>
        <div id="noteSidebar" class="flex-1 overflow-y-auto px-2 pb-2"></div>
        <button id="noteAddBook" onclick="NoteModule.addBook()" class="flex items-center gap-2 px-4 py-2.5 text-sm text-left text-ms-blue border-t border-gray-300/60 transition-colors hover:bg-white/60">
          <i class="fa-solid fa-plus"></i>加入筆記本
        </button>
      </aside>
      <section class="flex flex-col flex-1 min-w-0">
        <header class="flex items-center gap-3 shrink-0 h-14 px-5 bg-white border-b border-gray-200">
          <span id="noteChEmoji" class="text-2xl leading-none"></span>
          <h3 id="noteChName" class="font-bold text-lg text-gray-800 truncate"></h3>
          <span id="noteBookName" class="text-sm text-gray-400 truncate"></span>
          <span class="flex-1"></span>
          <div class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400"></i>
            <input id="noteSearch" oninput="NoteModule.search(this.value)" placeholder="搜尋所有貼文" aria-label="搜尋所有貼文" autocomplete="off" class="w-64 py-2 pl-9 pr-4 text-sm border border-gray-300 rounded-lg outline-none shadow-sm focus:ring-2 focus:ring-ms-blue">
          </div>        </header>
        <div class="flex-1 overflow-y-auto">
          <div class="max-w-5xl mx-auto px-5 py-5 space-y-4">
            <div id="noteComposer">
              <div id="noteComposeBar" class="bg-white border border-gray-200 rounded-lg shadow-sm">
                <button onclick="NoteModule.compose(false)" class="flex items-center gap-3 w-full px-4 pt-3 pb-2 text-left text-gray-500 transition-colors hover:text-gray-800"><span>在頻道中張貼</span></button>
                <div class="flex gap-2 px-4 pb-3">
                  <button onclick="NoteModule.compose(false)" class="flex items-center gap-2 px-4 py-1.5 text-sm text-gray-700 bg-gray-100 rounded-md transition-colors hover:bg-gray-200"><i class="fa-solid fa-pen-to-square text-ms-blue"></i>張貼</button>
                  <button onclick="NoteModule.compose(true)" class="flex items-center gap-2 px-4 py-1.5 text-sm text-gray-700 rounded-md transition-colors hover:bg-gray-100"><i class="fa-solid fa-megaphone text-ms-blue"></i>公告</button>
                </div>
              </div>
              <div id="noteComposeForm" class="hidden">${formHtml("noteNew", {}, "NoteModule.post()", "NoteModule.cancelCompose()")}</div>
            </div>
            <div id="noteList" class="space-y-4"></div>
          </div>
        </div>
      </section>
    </div>
    <div id="noteDialog"></div>`;
  }

  /* 登入狀態改變時切換可編輯的介面 */
  function syncAuth() {
    $("noteComposer").classList.toggle("hidden", !isLoggedIn || !S.book || S.channel === TRASH);
    $("noteAddBook").classList.toggle("hidden", !isLoggedIn);
  }

  /* 張貼與編輯共用的表單 */
  function formHtml(k, p, onSave, onCancel) {
    return `
    <div ${p._book ? `data-book="${p._book}"` : ""} class="bg-white border border-gray-200 rounded-lg shadow-md note-fade">
      <!-- 主旨與工具列釘在捲動區上緣，貼文很長時不必捲回最上面才能用格式 -->
      <div class="sticky top-0 z-20 bg-white rounded-t-lg">
      <div id="${k}_head" class="${p.announce ? ANN_ON : ANN_OFF}" style="${p.announce ? `background:${annBg(annColor(p.announceColor))}` : ""}">
        <input id="${k}_title" value="${esc(p.title)}" placeholder="新增主旨" aria-label="主旨" class="w-full font-bold text-lg bg-transparent outline-none placeholder:text-current placeholder:opacity-50">
      </div>
      <div class="flex flex-wrap items-center gap-0.5 px-3 py-1 border-y border-gray-100">${toolbarHtml(k)}</div>
      </div>
      <div id="${k}_body" aria-label="內容" ondragover="if(event.dataTransfer.types.includes('Files'))event.preventDefault()" ondrop="NoteModule.drop(event,'${k}')" class="relative note-md overflow-y-auto px-4 py-3 text-sm leading-relaxed text-gray-800 outline-none" style="min-height:6rem;max-height:50vh"></div>
      <div class="flex items-center gap-2 px-3 py-2 bg-gray-50 border-t border-gray-100 rounded-b-lg">
        <button id="${k}_attachBtn" title="附加檔案" aria-label="附加檔案" onclick="NoteModule.attach('${k}')" class="${ICON_BTN} disabled:opacity-50 disabled:cursor-wait"><i class="fa-solid fa-paperclip"></i></button>
        <label class="cursor-pointer">
          <input type="checkbox" id="${k}_ann" class="sr-only peer" ${p.announce ? "checked" : ""} onchange="NoteModule.annStyle('${k}')">
          <span class="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 rounded-md transition-colors hover:bg-gray-200 peer-checked:font-bold peer-checked:text-white peer-checked:bg-ms-blue peer-checked:hover:bg-ms-dark peer-focus-visible:ring-2 peer-focus-visible:ring-ms-blue"><i class="fa-solid fa-megaphone text-xs"></i>公告</span>
        </label>
        <input type="hidden" id="${k}_annColor" value="${annColor(p.announceColor)}">
        <div id="${k}_annColors" class="${p.announce ? "flex" : "hidden"} items-center gap-1" role="group" aria-label="公告標題顏色">
          <button type="button" title="預設藍色" aria-label="預設藍色" onclick="NoteModule.annStyle('${k}','')" class="w-5 h-5 border border-gray-300 rounded transition-transform hover:scale-110" style="background:${annBg("")}"></button>
          ${TEXT_COLORS.map((fill) => `<button type="button" aria-label="公告標題顏色 ${fill}" onclick="NoteModule.annStyle('${k}','${fill}')" class="w-5 h-5 border border-gray-300 rounded transition-transform hover:scale-110" style="background:${annBg(fill)}"></button>`).join("")}
        </div>
        <span id="${k}_busy" role="status" class="hidden items-center gap-1.5 text-xs text-gray-500"></span>
        <span class="flex-1"></span>
        <button onclick="${onCancel}" class="px-3 py-1.5 text-sm text-gray-600 rounded-md transition-colors hover:bg-gray-200">取消</button>
        <button id="${k}_save" onclick="${onSave}" class="text-sm btn-primary disabled:opacity-60 disabled:cursor-wait">${p.id ? "儲存" : "張貼"}</button>
      </div>
    </div>`;
  }

  /* 公告開關與標題顏色；color 有給才換顏色，沒給只依開關更新外觀 */
  function annStyle(k, color) {
    if (color !== undefined) $(k + "_annColor").value = color;
    const on = $(k + "_ann").checked;
    $(k + "_head").className = on ? ANN_ON : ANN_OFF;
    $(k + "_head").style.background = on ? annBg($(k + "_annColor").value) : "";
    $(k + "_annColors").classList.toggle("hidden", !on);
    $(k + "_annColors").classList.toggle("flex", on);
  }

  // ===== 編輯器 (roosterjs) =====

  /* 工具列 */
  function toolbarHtml(k) {
    // mousedown 不讓按鈕搶走焦點，編輯器裡的選取範圍才不會消失
    const hold = `type="button" onmousedown="event.preventDefault()"`;
    const btn = (icon, c, title) => `<button ${hold} title="${title}" aria-label="${title}" onclick="NoteModule.cmd('${k}','${c}')" class="${ICON_BTN}"><i class="fa-solid fa-${icon}"></i></button>`;
    const pick = (c, arg, inner, cls, label) => `<button ${hold} ${label ? `aria-label="${label}"` : ""} onclick="NoteModule.cmd('${k}','${c}','${arg}')" class="${cls}">${inner}</button>`;
    const menu = (icon, title, body, cls) => `
      <details class="relative">
        <summary onmousedown="event.preventDefault()" title="${title}" aria-label="${title}" class="list-none cursor-pointer [&::-webkit-details-marker]:hidden ${ICON_BTN}"><i class="fa-solid fa-${icon}"></i></summary>
        <div class="absolute top-full z-20 bg-white border border-gray-200 rounded-md shadow-lg ${cls}">${body}</div>
      </details>`;
    const palette = (icon, c, title, colors) => menu(icon, title,
      `<div class="grid grid-cols-4 gap-1.5">${colors.map((fill) => `<button ${hold} aria-label="${title} ${fill}" onclick="NoteModule.cmd('${k}','${c}','${fill}')" class="w-4 h-4 border border-gray-300 rounded transition-transform hover:scale-110" style="background:${fill}"></button>`).join("")}</div>`
      + pick(c, "", "自動", "w-full mt-2 py-0.5 text-xs text-gray-500 rounded transition-colors hover:bg-gray-100"),
      "left-0 p-2 w-max");
    const ROW = "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left text-gray-700 rounded whitespace-nowrap transition-colors hover:bg-gray-100";
    const ico = (name) => `<i class="fa-solid fa-${name} w-4 text-center text-gray-500"></i>`;
    const size = menu("text-size", "文字大小", [["14pt", "大"], ["10.5pt", "中"], ["9pt", "小"]].map(([v, t]) => pick("size", v, t, ROW)).join(""), "left-0 p-1");
    // 合併與分割放在表格圖示下方，才不會像「…」選單整片蓋住正在編輯的表格
    const table = menu("table-cells", "表格", [
      ["table", "", "table-cells", "插入表格"],
      ["tableAuto", "", "text-width", "自適應欄寬"],
      ["tableEven", "", "table-columns", "平均分配欄寬"],
      ["tableEdit", "mergeCells", "table-cells-merge", "合併儲存格"],
      ["tableEdit", "splitVertically", "table-cells-split", "分割成上下"],
      ["tableEdit", "splitHorizontally", "table-cells-split", "分割成左右"],
    ].map(([c, v, i, t]) => pick(c, v, ico(i) + t, ROW)).join("")
      + `<div class="my-1 border-t border-gray-100"></div>
      <div class="flex items-center gap-2 px-3 pt-1.5 pb-1 text-sm text-gray-700 whitespace-nowrap">${ico("fill-drip")}儲存格底色</div>
      <div class="grid grid-cols-5 gap-1.5 w-max px-3 pb-1.5">${CELL_COLORS.map((fill) => `<button ${hold} aria-label="儲存格底色 ${fill}" onclick="NoteModule.cmd('${k}','cellShade','${fill === "#FFFFFF" ? "" : fill}')" class="w-4 h-4 border border-gray-300 rounded transition-transform hover:scale-110" style="background:${fill}"></button>`).join("")}</div>`, "left-0 p-1");
    const more = menu("ellipsis", "其他功能", `
      <div class="flex items-center gap-2 px-3 pt-1.5 pb-1 text-sm text-gray-700 whitespace-nowrap">${ico("font")}文字樣式</div>
      <div class="flex gap-1 px-3 pb-1.5">${[["0", "段落"], ["1", "標題 1"], ["2", "標題 2"], ["3", "標題 3"]].map(([v, t]) => pick("heading", v, t, "px-2 py-1 text-xs text-gray-700 bg-gray-100 rounded whitespace-nowrap transition-colors hover:bg-gray-200")).join("")}</div>
      <div class="my-1 border-t border-gray-100"></div>
      ${[["code", "code", "行內程式碼"], ["minus", "hr", "插入水平線"], ["eraser", "clear", "清除格式"], ["rotate-left", "undo", "復原"], ["rotate-right", "redo", "重做"]].map(([i, c, t]) => pick(c, "", ico(i) + t, ROW)).join("")}
      <div class="my-1 border-t border-gray-100"></div>
      <div class="flex items-center gap-2 px-3 pt-1.5 pb-1 text-sm text-gray-700 whitespace-nowrap">${ico("map-pin")}提醒</div>
      <div class="flex gap-1 px-3 pb-1.5">${Object.entries(ALERTS).map(([type, [label, i, color]]) => pick("alert", type, `<i class="fa-solid fa-${i}" style="color:${color}"></i>${label}`, "flex items-center gap-1 px-2 py-1 text-xs text-gray-700 bg-gray-100 rounded whitespace-nowrap transition-colors hover:bg-gray-200")).join("")}</div>`, "right-0 p-1");
    return TOOLS.map((t) =>
      t === null ? `<span class="w-px h-5 mx-1 bg-gray-200"></span>`
      : t === "mark" ? palette("highlighter", "mark", "螢光標示", MARK_COLORS)
      : t === "color" ? palette("palette", "color", "文字顏色", TEXT_COLORS)
      : t === "size" ? size
      : t === "table" ? table
      : t === "more" ? more
      : btn(...t)).join("");
  }

  /* 打字時把標準 Markdown 語法即時轉成格式 */
  function markdownPlugin() {
    // roosterjs 內建的 MarkdownPlugin 用的是單一符號（*粗體*、_斜體_），而且中文輸入法下不會觸發，所以自己做
    // 斜體要排在粗體後面，並排除前面還有一個 * 的情況，否則 **粗體* 打到一半就會被當成斜體
    // 符號前面是英數時不轉換，否則 5*3 and 4*2 這種算式會被當成斜體；中文沒有空白，所以不能要求前面是空白
    // [語法, 套用方式, 後面是否補一個空白, 程式碼區塊裡是否也適用]
    const RULES = [
      [/(?<![A-Za-z0-9*])\*\*([^*\s][^*]*)\*\*$/, (t) => (t.format.fontWeight = "bold")],
      [/(?<![A-Za-z0-9~])~~([^~\s][^~]*)~~$/, (t) => (t.format.strikethrough = true)],
      // Markdown 本身沒有底線語法，採用常見的 __底線__ 寫法
      [/(?<![A-Za-z0-9_])__([^_\s][^_]*)__$/, (t) => (t.format.underline = true)],
      [/(?<![A-Za-z0-9*])\*([^*\s][^*]*)\*$/, (t) => (t.format.italic = true)],
      // 程式碼與連結是包在文字外面的一層，游標會留在裡面；補一個一般空白讓接下來打的字落在外面
      [/`([^`]+)`$/, (t) => { t.code = { format: {} }; delete t.format.backgroundColor; }, true, true],
      [/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/, (t, m) => (t.link = { format: { href: m[2], underline: true }, dataset: {} }), true],
    ];
    let editor = null;
    return {
      getName: () => "NoteMarkdown",
      initialize: (ed) => (editor = ed),
      dispose: () => (editor = null),
      // AutoFormatPlugin 會獨占行首「> 」的輸入並把它變成箭頭項目符號，這裡搶先獨占才輪得到引用
      willHandleEventExclusively(event) {
        if (!editor || event.eventType !== "input") return false;
        const sel = editor.getDOMSelection(), node = sel && sel.type === "range" && sel.range.startContainer;
        return !!node && node.nodeType === 3 && !node.previousSibling && /^>[ \u00a0]$/.test(node.data.slice(0, sel.range.startOffset));
      },
      onPluginEvent(event) {
        if (!editor) return;
        // 游標在儲存格裡按 Ctrl+A 先只選那一格的內容，已整格選取時再按才交給預設的全選
        if (event.eventType === "keyDown") {
          const e = event.rawEvent;
          if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "a") return;
          const sel = editor.getDOMSelection(), node = sel && sel.type === "range" && sel.range.startContainer;
          const cell = node && (node.nodeType === 1 ? node : node.parentElement).closest("td, th");
          if (!cell || (!sel.range.collapsed && sel.range.toString().trim() === cell.textContent.trim())) return;
          e.preventDefault();
          const range = document.createRange();
          range.selectNodeContents(cell);
          editor.setDOMSelection({ type: "range", range, isReverted: false });
          return;
        }
        // 注音選字途中不能動內容，等選字結束（compositionEnd）再處理
        if (event.eventType === "input" ? event.rawEvent.isComposing : event.eventType !== "compositionEnd") return;
        // 行首語法要等內容改完才能套用區塊格式，先記下來
        let after = null;
        roosterjs.formatTextSegmentBeforeSelectionMarker(editor, (model, seg, paragraph, markerFormat, context) => {
          const marker = () => paragraph.segments.find((x) => x.segmentType === "SelectionMarker");
          // 清空的那一行要留一個換行，否則瀏覽器沒有地方放游標，會把游標丟到下一行
          const emptyLine = () => { paragraph.segments = [marker(), roosterjs.createBr()]; };
          // 把這一行包進新的區塊；區塊在最後時補一個空行，游標才出得去
          const wrap = (tag, format, at) => {
            const box = roosterjs.createFormatContainer(tag, format);
            box.blocks.push(paragraph);
            model.blocks.splice(at, 1, box);
            if (at === model.blocks.length - 1) {
              const tail = roosterjs.createParagraph();
              tail.segments.push(roosterjs.createBr());
              model.blocks.push(tail);
            }
            return box;
          };
          const pre = model.blocks.find((x) => x.blockGroupType === "FormatContainer" && x.tagName === "pre" && x.blocks.includes(paragraph));
          // 程式碼區塊裡打三個反引號是結尾：刪掉它並把游標移到區塊下方
          if (pre && seg.text.endsWith("```")) {
            seg.text = seg.text.slice(0, -3);
            const caret = marker(), at = model.blocks.indexOf(pre);
            paragraph.segments.splice(paragraph.segments.indexOf(caret), 1);
            if (!seg.text && pre.blocks.length > 1) pre.blocks.splice(pre.blocks.indexOf(paragraph), 1);
            else if (!seg.text) paragraph.segments = [roosterjs.createBr()];
            let below = model.blocks[at + 1];
            if (!below || below.blockType !== "Paragraph") {
              below = roosterjs.createParagraph();
              below.segments.push(roosterjs.createBr());
              model.blocks.splice(at + 1, 0, below);
            }
            below.segments.unshift(caret);
            return true;
          }
          // 引用的第一行打完 [!NOTE]，或一般段落直接打 >[!NOTE]：變成提醒區塊，游標移到新的第二行
          let quote = model.blocks.find((x) => x.blockGroupType === "FormatContainer" && x.tagName === "blockquote" && x.blocks[0] === paragraph);
          const top = model.blocks.indexOf(paragraph);
          // 不在引用裡時，開頭要有大於符號才算
          const mark = quote ? seg.text : top >= 0 && paragraph.segments[0].text === seg.text && /^>/.test(seg.text) ? seg.text.replace(/^>[ \u00a0]?/, "") : "";
          const alert = ALERT_MARK.exec(mark);
          if (alert && alert[0].trim() === mark.trim()) {
            if (!quote) quote = wrap("blockquote", {}, top);
            const [label, , , bg, line, ink] = ALERTS[alert[1].toUpperCase()], edge = `1px solid ${line}`;
            // 要先告訴編輯器這個引用被改了，否則它會沿用畫好的舊外框，底色不會變
            roosterjs.mutateBlock(quote).format = { backgroundColor: bg, borderTop: edge, borderRight: edge, borderBottom: edge, borderLeft: edge };
            seg.text = label;
            seg.format = { ...seg.format, fontWeight: "bold", textColor: ink };
            const caret = marker(), body = roosterjs.createParagraph();
            paragraph.segments.splice(paragraph.segments.indexOf(caret), 1);
            body.segments.push(caret, roosterjs.createBr());
            quote.blocks.splice(1, 0, body);
            return true;
          }
          // 游標前只有這一段文字才算行首（不能用物件比對，傳進來的 seg 可能是複本）
          const first = paragraph.segments[0], next = paragraph.segments[1];
          if (!pre && first.segmentType === "Text" && first.text === seg.text && next && next.segmentType === "SelectionMarker") {
            // 行首打「> 」是引用、「# 」到「### 」是標題
            const lead = /^(>|#{1,3})[ \u00a0]$/.exec(seg.text);
            // 已經在引用或提醒區塊裡打「> 」是引用中引用：自己再包一層，不能用 toggleBlockQuote（它會把原本的區塊切掉）
            const findQuote = (g) => {
              for (const x of g.blocks || []) {
                if (x.blockGroupType !== "FormatContainer") continue;
                if (x.tagName === "blockquote" && x.blocks.includes(paragraph)) return x;
                const hit = findQuote(x);
                if (hit) return hit;
              }
              return null;
            };
            const outer = lead && lead[1] === ">" ? findQuote(model) : null;
            if (lead && outer) {
              emptyLine();
              const at = outer.blocks.indexOf(paragraph);
              // 內層不帶行內樣式，外觀交給 index.html 的巢狀引用規則
              const box = roosterjs.createFormatContainer("blockquote", {});
              box.blocks.push(paragraph);
              roosterjs.mutateBlock(outer).blocks.splice(at, 1, box);
              // 內層在外層結尾時補一個空行，游標才出得了內層
              if (at === outer.blocks.length - 1) {
                const tail = roosterjs.createParagraph();
                tail.segments.push(roosterjs.createBr());
                roosterjs.mutateBlock(outer).blocks.push(tail);
              }
              return true;
            }
            if (lead) {
              emptyLine();
              after = lead[1] === ">" ? () => roosterjs.toggleBlockQuote(editor, QUOTE_FORMAT) : () => roosterjs.setHeadingLevel(editor, lead[1].length);
              return true;
            }
            // 行首打三個反引號：把這一行變成程式碼區塊
            const at = model.blocks.indexOf(paragraph);
            if (seg.text === "```" && at >= 0) {
              emptyLine();
              // 區塊和裡面那一行都要標成保留空白，否則連續空白會被合併
              paragraph.format.whiteSpace = "pre";
              wrap("pre", { whiteSpace: "pre" }, at);
              return true;
            }
          }
          for (const [re, apply, pad, inBlock] of RULES) {
            // 程式碼區塊裡只轉行內程式碼；**、*、__ 在程式碼裡是內容，不能自動轉掉
            const m = (!pre || inBlock) && re.exec(seg.text);
            if (!m) continue;
            const part = roosterjs.splitTextSegment(seg, paragraph, m.index, seg.text.length);
            part.text = m[1];
            part.format = { ...part.format };
            apply(part, m);
            if (pad) paragraph.segments.splice(paragraph.segments.findIndex((x) => x.segmentType === "SelectionMarker"), 0, roosterjs.createText(" ", markerFormat));
            // 接下來打的字回到原本的格式，不延續剛套用的
            context.newPendingFormat = { ...markerFormat, strikethrough: !!markerFormat.strikethrough, italic: !!markerFormat.italic, fontWeight: markerFormat.fontWeight ? "bold" : undefined };
            context.canUndoByBackspace = true;
            return true;
          }
          return false;
        });
        if (after) after();
      },
    };
  }

  /* 第一次要編輯時才載入 roosterjs，只看不寫的人不必下載 */
  function loadRooster() {
    if (!S.rooster) {
      S.rooster = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = ROOSTER_URL;
        s.onload = res;
        s.onerror = () => { S.rooster = null; s.remove(); rej(new Error("編輯器載入失敗，請確認網路後再試")); };
        document.head.appendChild(s);
      });
    }
    return S.rooster;
  }

  /* 在表單的內容區建立編輯器 */
  async function openEditor(k, html) {
    await loadRooster();
    closeEditor(k);
    const R = roosterjs;
    // 不用 createEditor：它會替每段文字加上 Calibri 字型的行內樣式
    S.eds[k] = new R.Editor($(k + "_body"), {
      plugins: [new R.PastePlugin(), new R.EditPlugin(), new R.TableEditPlugin(),
        // 要排在 AutoFormatPlugin 前面，理由見 willHandleEventExclusively
        markdownPlugin(), new R.AutoFormatPlugin({ autoBullet: true, autoNumbering: true, autoLink: true, autoHorizontalLine: true }), new R.ShortcutPlugin(), new R.HyperlinkPlugin(), new R.WatermarkPlugin("輸入內容")],
      initialModel: html ? R.createModelFromHtml(html) : undefined,
    });
    // 用捕獲階段才搶得到把手的 mousedown，接管的理由見 dragCol
    S.eds[k]._down = (e) => dragCol(k, e);
    document.addEventListener("mousedown", S.eds[k]._down, true);
    // 檔案區塊右側的刪除鈕是 CSS 畫的 ::after，點不到實體元素，用座標判斷
    $(k + "_body").onmousedown = (e) => {
      const a = e.target.closest ? e.target.closest('a[href^="files/"]') : null;
      if (!a || a.getBoundingClientRect().right - e.clientX > 32) return;
      e.preventDefault();
      removeFileLink(k, a.getAttribute("href"));
    };
    fitTables(k);
  }

  function closeEditor(k) {
    if (S.eds[k]) {
      document.removeEventListener("mousedown", S.eds[k]._down, true);
      S.eds[k].dispose();
      delete S.eds[k];
    }
    if ($(k + "_body")) $(k + "_body").innerHTML = "";
    // 取消、張貼、儲存最後都走到這裡：這個表單上傳過、沒被任何已存貼文引用的檔就是孤兒
    // 上傳當下就寫檔，在編輯器刪掉區塊或取消貼文時檔案都還在，不清會越積越多
    const mine = [...S.attached].filter(([, v]) => v.endsWith("|" + k));
    mine.forEach(([n]) => S.attached.delete(n));
    const byBook = {};
    mine.forEach(([n, v]) => (byBook[v.split("|")[0]] ||= []).push(n));
    Object.entries(byBook).forEach(([bk, names]) => { const b = bookOf(bk); if (b) removeUnused(b, names).catch(() => {}); });
  }

  /* 刪掉一個檔案區塊（模型裡是帶 link 的文字段） */
  // shortcut: 同一個檔插了兩個區塊時只刪第一個，正常操作不會這樣插，誤刪時按復原即可
  function removeFileLink(k, href) {
    S.eds[k].formatContentModel((model) => {
      let hit = false;
      const walk = (g) => {
        if (g.blocks) g.blocks.forEach(walk);
        if (g.blockType === "Table") g.rows.forEach((r) => r.cells.forEach(walk));
        if (g.blockType !== "Paragraph") return;
        // 區塊不可編輯後在模型裡是 Entity，舊貼文未加屬性前是帶 link 的文字段，兩種都要認
        const match = (s) => (s.link && s.link.format.href === href) || (s.segmentType === "Entity" && s.wrapper && s.wrapper.getAttribute("href") === href);
        const keep = g.segments.filter((s) => hit || !(match(s) && (hit = true)));
        if (keep.length !== g.segments.length) roosterjs.mutateBlock(g).segments = keep;
      };
      walk(model);
      return hit;
    });
  }

  /* 找出右緣最貼近把手位置的欄 */
  function colAt(k, e) {
    if (!(e.target.nodeType === 1 && getComputedStyle(e.target).cursor === "col-resize")) return null;
    let hit = null;
    [...$(k + "_body").querySelectorAll("table")].forEach((t, ti) => {
      [...t.rows[0].cells].forEach((c, ci) => {
        const r = c.getBoundingClientRect(), d = Math.abs(r.right - e.clientX);
        if (d < 8 && (!hit || d < hit.d)) hit = { t, ti, ci, d, w: r.width };
      });
    });
    return hit;
  }

  /* 對指定表格的指定欄寫回欄寬；w 為 0 代表清掉、依內容自適應 */
  function setColWidth(k, hit, w) {
    S.eds[k].formatContentModel((model) => {
      const list = [];
      const walk = (g) => g.blocks && g.blocks.forEach((b) => (b.blockType === "Table" ? list.push(b) : walk(b)));
      walk(model);
      const t = list[hit.ti];
      if (!t) return false;
      // 欄寬存在每一格的 format.width；寬度為 0 時編輯器不會輸出，等同清掉
      t.rows.forEach((r) => {
        const c = r.cells[hit.ci];
        if (!c) return;
        if (w) roosterjs.mutateBlock(c).format.width = w + "px";
        else delete roosterjs.mutateBlock(c).format.width;
      });
      if (t.widths.length) roosterjs.mutateBlock(t).widths[hit.ci] = w;
      return true;
    });
    fitTables(k);
  }

  let lastDown = { t: 0, x: 0, y: 0 };

  /* 接管欄寬拖拉：只動把手左邊那一欄 */
  // roosterjs 自己的拖拉是左右兩欄互讓；這裡在按下時就攔走，過程只改左欄，表格總寬跟著增減（Notion 的行為）
  // 最窄 35px，與樣式表裡儲存格的最小欄寬一致
  function dragCol(k, e) {
    if (e.button !== 0) return;
    const hit = colAt(k, e);
    if (!hit) return;
    const x0 = e.clientX;
    e.stopPropagation();
    e.preventDefault();
    // 點兩下格線＝清掉左欄的固定寬度改依內容自適應；放開拖拉會重畫把手，瀏覽器的 dblclick 落不到把手上，所以自己數
    if (Date.now() - lastDown.t < 400 && Math.abs(e.clientX - lastDown.x) < 5 && Math.abs(e.clientY - lastDown.y) < 5) {
      lastDown.t = 0;
      setColWidth(k, hit, 0);
      return;
    }
    lastDown = { t: Date.now(), x: e.clientX, y: e.clientY };
    const width = (m) => Math.max(35, Math.round(hit.w + m.clientX - x0));
    const move = (m) => [...hit.t.rows].forEach((r) => r.cells[hit.ci] && (r.cells[hit.ci].style.width = width(m) + "px"));
    const up = (m) => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
      m.stopPropagation();
      // 沒拖動就不寫回，把手才不會被重畫，第二下點擊才接得上
      if (width(m) !== Math.round(hit.w)) setColWidth(k, hit, width(m));
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  }

  /* 依欄寬狀態同步表格本身的寬度 */
  // 瀏覽器會把沒有自身寬度的表格鎖在容器寬以內，欄寬寫死的表格要給 max-content 才拉得出去、出現水平捲軸
  function fitTables(k) {
    if (!$(k + "_body")) return;
    [...$(k + "_body").querySelectorAll("table")].forEach((t) => {
      t.style.width = [...t.querySelectorAll("td, th")].some((c) => c.style.width) ? "max-content" : "";
    });
  }

  /* 在游標處插入一段 HTML */
  function insertHtml(ed, html) {
    ed.formatContentModel((model, context) => {
      roosterjs.mergeModel(model, roosterjs.createModelFromHtml(html), context);
      return true;
    });
  }

  /* 選取範圍是否碰到行內程式碼；緊跟在後面也算，否則接著打的字會帶著螢光貼在旁邊 */
  function touchesCode(ed) {
    const sel = ed.getDOMSelection();
    if (!sel || sel.type !== "range") return false;
    const r = sel.range, el = (n) => (n.nodeType === 1 ? n : n.parentElement);
    if (el(r.startContainer).closest("code") || el(r.endContainer).closest("code") || r.cloneContents().querySelector("code")) return true;
    if (!r.collapsed) return false;
    const n = r.startContainer;
    if (n.nodeType === 3 && n.data.slice(0, r.startOffset).trim()) return false;
    let prev = n.nodeType === 3 ? n.previousSibling : n.childNodes[r.startOffset - 1];
    while (prev && prev.nodeType === 3 && !prev.data.trim()) prev = prev.previousSibling;
    return !!prev && prev.tagName === "CODE";
  }

  /* 套用或清除螢光標示 */
  function setMark(ed, color) {
    setSeg(ed, "backgroundColor", color, () => roosterjs.setBackgroundColor(ed, color || null));
  }

  /* 套用或清除選取文字的某個樣式；roosterjs 內建的設底色會收合選取、清文字顏色常清不掉，自己改才穩 */
  function setSeg(ed, key, color, fallback) {
    const sel = ed.getDOMSelection();
    // 游標沒有選取範圍時交給 roosterjs，讓接著打的字帶上這個樣式
    if (!sel || sel.type !== "range" || sel.range.collapsed) return fallback();
    ed.formatContentModel((model) => {
      for (const x of roosterjs.getSelectedSegments(model, false, true)) {
        if (color) x.format[key] = color;
        else delete x.format[key];
      }
      return true;
    });
  }

  /* 工具列指令 */
  function cmd(k, name, arg) {
    const ed = S.eds[k], R = roosterjs;
    if (!ed) return;
    ed.focus();
    const isCaret = (x) => x.segmentType === "SelectionMarker";
    // 找出游標所在的段落：回傳它所屬的那一層與位置（引用、清單、表格儲存格裡也要找得到）
    const locate = (group) => {
      for (let i = 0; i < group.blocks.length; i++) {
        const b = group.blocks[i];
        if (b.blockType === "Paragraph") { if (b.segments.some(isCaret)) return [group, i]; continue; }
        for (const child of b.blocks ? [b] : b.rows ? b.rows.flatMap((row) => row.cells) : []) {
          const hit = locate(child);
          if (hit) return hit;
        }
      }
      return null;
    };
    // 插入 HTML 後把游標搬進新內容；插入完游標一定緊跟在後面，從那裡往回找才不會認錯
    const insertAndEnter = (html, intoBlock) => ed.formatContentModel((model, context) => {
      R.mergeModel(model, R.createModelFromHtml(html), context);
      const hit = locate(model);
      if (!hit) return true;
      const [group, at] = hit, para = group.blocks[at], i = para.segments.findIndex(isCaret), caret = para.segments[i];
      if (intoBlock) {
        const box = group.blocks[at - 1];
        if (!box || box.blockGroupType !== "FormatContainer") return true;
        const last = box.blocks[box.blocks.length - 1], br = last.segments.findIndex((x) => x.segmentType === "Br");
        para.segments.splice(i, 1);
        // 空區塊的游標要在換行符號前面，有文字就放在最後
        last.segments.splice(br < 0 ? last.segments.length : br, 0, caret);
      } else if (i >= 2 && para.segments[i - 2].code) {
        // 行內程式碼後面補了一個空白，游標往前跳過它就會落在程式碼的尾端
        para.segments.splice(i, 1);
        para.segments.splice(i - 1, 0, caret);
      }
      return true;
    });
    ({
      bold: () => R.toggleBold(ed), italic: () => R.toggleItalic(ed), underline: () => R.toggleUnderline(ed), strike: () => R.toggleStrikethrough(ed),
      ul: () => R.toggleBullet(ed),
      // roosterjs 的編號會跨儲存格延續（上格 1.2.3 下格接 4.）；自成一段的清單要把起始號改回 1
      ol: () => {
        R.toggleNumbering(ed);
        ed.formatContentModel((model) => {
          let item = null, parent = null;
          const picked = (g) => g.blocks.some((b) => b.blockType === "Paragraph" && b.segments.some((s) => s.segmentType === "SelectionMarker" || s.isSelected));
          const walk = (g) => (g.blocks || []).forEach((b) => {
            if (item) return;
            if (b.blockGroupType === "ListItem") { if (b.levels[0] && b.levels[0].listType === "OL" && picked(b)) { item = b; parent = g; } }
            else if (b.blockType === "Table") b.rows.forEach((r) => r.cells.forEach(walk));
            else if (b.blocks) walk(b);
          });
          walk(model);
          if (!item) return false;
          const prev = parent.blocks[parent.blocks.indexOf(item) - 1];
          // 前面緊接著編號清單代表是同一串的延續，不改
          if (prev && prev.blockGroupType === "ListItem" && prev.levels[0] && prev.levels[0].listType === "OL") return false;
          R.mutateBlock(item).levels[0].format.startNumberOverride = 1;
          return true;
        });
      },
      // 行內程式碼本身有底色和外框，再加螢光會很亂
      mark: () => (arg && touchesCode(ed) ? ToastModule.show("行內程式碼不能加螢光標示", "warning") : setMark(ed, arg)),
      color: () => setSeg(ed, "textColor", arg, () => R.setTextColor(ed, arg || null)),
      heading: () => R.setHeadingLevel(ed, +arg), size: () => R.setFontSize(ed, arg),
      quote: () => R.toggleBlockQuote(ed, QUOTE_FORMAT),
      code: () => {
        const sel = ed.getDOMSelection();
        if (sel && sel.type === "range" && !sel.range.collapsed) {
          setMark(ed, "");
          return R.toggleCode(ed);
        }
        // 沒選取文字時放一個空的程式碼框；空元素放不了游標，所以塞一個零寬空白，存檔時清掉
        insertAndEnter("<code>\u200b</code>&nbsp;");
      },
      // 有選取文字就搬進區塊，沒有就放空區塊；後面補空行，游標才出得去
      codeblock: () => {
        const sel = ed.getDOMSelection();
        // 用瀏覽器的選取取文字，跨行時才會保留換行
        const text = sel && sel.type === "range" && !sel.range.collapsed ? getSelection().toString() : "";
        // 只搬得動文字：選取範圍裡的圖片、表格、連結會被整個取代掉，所以不做
        if (text && sel.range.cloneContents().querySelector("img, table, a")) return ToastModule.show("選取範圍含圖片、表格或附件，請只選取文字", "warning");
        insertAndEnter(`<pre>${text ? esc(text) : "<br>"}</pre><div><br></div>`, true);
      },
      hr: () => insertHtml(ed, "<hr><div><br></div>"),
      // 插入提醒區塊：第一行是標題，游標停在第二行
      alert: () => insertAndEnter(`<blockquote style="${alertStyle(arg)}">${alertTitle(arg)}<div><br></div></blockquote><div><br></div>`, true),
      // 插入就平均分配成滿版，打字依欄寬換行，行為才穩定可預期；想縮回內容寬再按自適應欄寬
      table: () => { R.insertTable(ed, 3, 3); cmd(k, "tableEven"); },
      // 拿掉欄寬讓表格在編輯器裡依內容自適應（空欄的最小寬度由 CSS 補）；拖拉過的欄寬之後照樣有效
      tableAuto: () => {
        ed.formatContentModel((model) => {
          const t = R.getFirstSelectedTable(model)[0];
          if (!t) return false;
          R.mutateBlock(t).widths = [];
          t.rows.forEach((r) => r.cells.forEach((c) => delete R.mutateBlock(c).format.width));
          return true;
        });
        fitTables(k);
      },
      // 空字串清掉底色回到白底
      cellShade: () => R.setTableCellShade(ed, arg || null),
      // 合併要先在表格裡拖曳選取多格；游標不在表格裡時 roosterjs 不做事
      // roosterjs 動過結構後會把當下欄寬寫死回每一格，原本是自適應的表格要再清一次才會維持自適應
      tableEdit: () => {
        const sel = ed.getDOMSelection();
        const el = sel && (sel.table || (sel.type === "range" && (sel.range.startContainer.nodeType === 1 ? sel.range.startContainer : sel.range.startContainer.parentElement).closest("table")));
        // 不能用 [style*=width] 選，每一格都有 border-width 會誤判
        const auto = el && ![...el.querySelectorAll("td, th")].some((c) => c.style.width);
        R.editTable(ed, arg);
        if (auto) cmd(k, "tableAuto");
      },
      // 游標所在的表格欄寬平均分配並撐滿編輯區，拉醜了可以一鍵拉回對稱
      tableEven: () => {
        ed.formatContentModel((model) => {
          const t = R.getFirstSelectedTable(model)[0];
          if (!t) return false;
          const cols = Math.max(...t.rows.map((r) => r.cells.length));
          const w = Math.floor(($(k + "_body").clientWidth - 34) / cols);
          if (!(w > 0)) return false;
          R.mutateBlock(t).widths = Array.from({ length: cols }, () => w);
          t.rows.forEach((r) => r.cells.forEach((c) => delete R.mutateBlock(c).format.width));
          return true;
        });
        fitTables(k);
      },
      clear: () => {
        // 不用 roosterjs 的 clearFormat：它會把引用從選取處切成兩半，選整行時文字格式也只是搬到段落上沒有清掉；這裡只清文字格式
        ed.formatContentModel((model) => {
          // 提醒區塊的標題行要保留粗體與顏色，先記下那些段落
          const titles = new Set();
          const findTitles = (group) => group.blocks.forEach((b) => {
            // 選取從引用最前面開始時，編輯器會在標題前多塞一個只有游標的空段落，要跳過它
            const title = b.blockGroupType === "FormatContainer" && b.tagName === "blockquote" && ALERT_BGS.has(toRgb(b.format.backgroundColor))
              && b.blocks.find((p) => p.blockType === "Paragraph" && p.segments.some((s) => s.segmentType !== "SelectionMarker"));
            if (title) titles.add(title);
            if (b.blocks) findTitles(b);
          });
          findTitles(model);
          const hits = R.getSelectedSegmentsAndParagraphs(model, true, false);
          for (const [seg, para] of hits) {
            if (titles.has(para)) continue;
            const p = para && R.mutateBlock(para);
            seg.format = {};
            delete seg.code;
            if (p) p.segmentFormat = undefined;
          }
          return hits.length > 0;
        }, { apiName: "clearFormat" });
      },
      undo: () => R.undo(ed), redo: () => R.redo(ed),
      link: () => {
        const url = (prompt("連結網址", "https://") || "").trim();
        if (url && url !== "https://") R.insertLink(ed, url);
      },
    })[name]();
    $("noteRoot").querySelectorAll("details[open]").forEach((d) => (d.open = false));
  }

  /* 把貼文內容轉成編輯器吃的 HTML：圖片的 files/ 路徑換成可顯示的網址 */
  async function toEditorHtml(p) {
    const t = document.createElement("template");
    t.innerHTML = bodyHtml(p);
    upgradeQuotes(t.content);
    // 和顯示端同一條規則：沒調過的預設欄寬剝掉，編輯時表格也依內容自適應
    t.content.querySelectorAll("td, th").forEach((c) => { if (/^(120|100|70)px$/.test(c.style.width)) c.style.width = ""; });
    const b = bookOf(p._book);
    for (const img of t.content.querySelectorAll('img[src^="files/"]')) {
      try { img.setAttribute("src", await fileUrl(b, decodeURIComponent(img.getAttribute("src").slice(6)))); } catch {}
    }
    // 理由見 attachFiles 的插入
    t.content.querySelectorAll('a[href^="files/"]').forEach((a) => a.setAttribute("contenteditable", "false"));
    return t.innerHTML;
  }

  /* 編輯器內容轉成要存檔的 HTML：圖片一律存成 files/ 底下的檔案，內文只留路徑 */
  async function finalizeHtml(b, html) {
    const t = document.createElement("template");
    t.innerHTML = html;
    // 附件當初存在別本筆記本時（張貼前切換了筆記本），補一份到這本
    const adopt = async (name, fromKey) => {
      if (fromKey && fromKey !== b.key) await writeFile(b.filesDir, name, await (await bookOf(fromKey).filesDir.getFileHandle(name)).getFile());
    };
    for (const img of t.content.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      if (src.startsWith("data:")) {
        // 貼上的截圖在編輯器裡是整張圖的編碼，直接存進貼文檔會非常大
        const blob = await (await fetch(src)).blob();
        const name = `${stamp()}-${Math.random().toString(36).slice(2, 6)}_image.${(blob.type.split("/")[1] || "png").replace(/[^a-z0-9]/g, "")}`;
        await writeFile(b.filesDir, name, blob);
        img.setAttribute("src", "files/" + name);
      } else if (src.startsWith("blob:")) {
        const hit = [...urlCache].find(([, u]) => u === src);
        if (!hit) continue;
        const i = hit[0].indexOf("/"), name = hit[0].slice(i + 1);
        await adopt(name, hit[0].slice(0, i));
        img.setAttribute("src", "files/" + name);
      }
    }
    for (const a of t.content.querySelectorAll('a[href^="files/"]')) {
      const name = decodeURIComponent(a.getAttribute("href").slice(6));
      await adopt(name, (S.attached.get(name) || "").split("|")[0]);
      // 不可編輯只是編輯器內的行為，不存進貼文
      a.removeAttribute("contenteditable");
    }
    // 結尾的空行存檔時拿掉：編輯器要靠它讓游標能離開表格等區塊，但張貼後只是多一截空白
    while (t.content.lastElementChild && !t.content.lastElementChild.textContent.trim() &&
      !t.content.lastElementChild.querySelector("img, table, hr") && t.content.lastElementChild.tagName !== "HR") {
      t.content.lastElementChild.remove();
    }
    // 清掉讓游標停在空程式碼框裡用的零寬空白
    return clean(t.innerHTML).replace(/\u200b/g, "");
  }

  /* 有沒有打到一半還沒送出的貼文；app.js 在離開頁面前用它決定要不要提醒 */
  function hasDraft() {
    return Object.keys(S.eds).some((k) => $(k + "_title").value.trim() || hasContent(roosterjs.exportContent(S.eds[k])));
  }

  /* 內容是否有東西（只有空行不算） */
  function hasContent(html) {
    const t = document.createElement("template");
    t.innerHTML = html;
    return !!(t.content.textContent.trim() || t.content.querySelector("img,table,hr"));
  }

  /* 左側欄：筆記本與其頻道兩層 */
  function renderSidebar() {
    $("noteSidebar").innerHTML = S.books.map((b) => {
      if (!b.ready) return `
      <button onclick="NoteModule.grant('${b.key}')" title="點一下重新連接這本筆記本" class="flex items-center gap-2 w-full mt-2 px-3 py-2 text-sm text-left text-gray-500 rounded-lg transition-colors hover:bg-white/60">
        <i class="fa-solid fa-lock"></i><span class="flex-1 truncate">${esc(b.name || b.handle.name)}</span><span class="text-xs text-ms-blue">重新連接</span>
      </button>`;
      return `
      <div class="group/book flex items-center mt-2 pl-3 pr-1">
        <span class="mr-2 text-base leading-none">${esc(b.emoji)}</span>
        <span class="flex-1 font-bold text-sm text-gray-600 truncate">${esc(b.name)}</span>
        ${isLoggedIn ? `<button title="筆記本設定" aria-label="筆記本設定" onclick="NoteModule.bookDialog('${b.key}')" class="opacity-0 group-hover/book:opacity-100 focus:opacity-100 ${ICON_BTN}"><i class="fa-solid fa-ellipsis"></i></button>` : `<span class="h-8"></span>`}
      </div>
      <div class="space-y-0.5">
        <div class="space-y-0.5" data-channels="${b.key}">${b.channels.map((c) => {
          const on = b.key === S.book && c.id === S.channel;
          return `
        <div data-ch="${c.id}" class="group/ch flex items-center pr-1 rounded-lg transition-colors ${on ? "bg-white shadow-sm" : "hover:bg-white/60"}">
          <button onclick="NoteModule.select('${b.key}','${c.id}')" class="flex items-center gap-3 flex-1 min-w-0 py-2 pl-5 pr-3 text-left">
            <span class="text-xl leading-none">${esc(c.emoji || CH_EMOJI)}</span>
            <span class="truncate text-sm ${on ? "font-semibold text-gray-900" : "text-gray-700"}">${esc(c.name)}</span>
          </button>
          ${isLoggedIn ? `<button title="頻道設定" aria-label="頻道設定" onclick="NoteModule.channelDialog('${b.key}','${c.id}')" class="opacity-0 group-hover/ch:opacity-100 focus:opacity-100 ${ICON_BTN}"><i class="fa-solid fa-ellipsis"></i></button>` : ""}
        </div>`;
        }).join("")}</div>
        ${isLoggedIn ? `<button onclick="NoteModule.channelDialog('${b.key}')" class="flex items-center gap-3 w-full py-1.5 pl-6 pr-3 text-sm text-left text-gray-500 rounded-lg transition-colors hover:text-ms-blue hover:bg-white/60"><i class="fa-solid fa-plus w-5 text-center text-xs"></i>新增頻道</button>
        <button onclick="NoteModule.select('${b.key}','${TRASH}')" class="flex items-center gap-3 w-full py-1.5 pl-6 pr-3 text-sm text-left rounded-lg transition-colors ${b.key === S.book && S.channel === TRASH ? "font-semibold text-gray-900 bg-white shadow-sm" : "text-gray-500 hover:text-ms-blue hover:bg-white/60"}"><i class="fa-solid fa-trash-can w-5 text-center text-xs"></i>垃圾桶</button>` : ""}
      </div>`;
    }).join("");
    // 頻道可拖曳排序：沿用小幫手已載入的 Sortable（表格欄位排序用的同一個套件）
    if (!isLoggedIn || typeof Sortable === "undefined") return;
    $("noteSidebar").querySelectorAll("[data-channels]").forEach((list) => {
      new Sortable(list, { animation: 150, onEnd: safe(() => reorder(list.dataset.channels, [...list.children].map((x) => x.dataset.ch))) });
    });
  }

  /* 拖曳後的頻道順序寫回 channels.json */
  async function reorder(key, ids) {
    if (!isLoggedIn) return;
    const b = bookOf(key);
    // 先重讀再寫；別人剛新增、這邊畫面上還沒有的頻道排到最後，不能被這次存檔弄丟
    const list = (await readJson(b.handle, "channels.json", b.channels)).filter((c) => c && SAFE_ID.test(c.id));
    const sorted = [...ids.map((id) => list.find((c) => c.id === id)).filter(Boolean), ...list.filter((c) => !ids.includes(c.id))];
    if (!sorted.every((c, i) => c === list[i])) await writeFile(b.handle, "channels.json", JSON.stringify(sorted));
    b.channels = sorted;
    renderSidebar();
  }

  let renderSeq = 0;

  async function renderList() {
    // 讀檔期間使用者又點了別的頻道時，先點的這一輪作廢，舊畫面才不會蓋掉新畫面
    const seq = ++renderSeq;
    // 重畫會連編輯中的表單一起重建，先把還沒存的內容留下來
    const draft = S.eds.noteEdit ? { title: $("noteEdit_title").value, ann: $("noteEdit_ann").checked, color: $("noteEdit_annColor").value, html: roosterjs.exportContent(S.eds.noteEdit) } : null;
    closeEditor("noteEdit");
    const q = S.query.trim().toLowerCase();
    const b = bookOf(S.book);
    let list = [], more = false;
    if (q) {
      await loadAll();
      const text = (p) => [p.title, plainText(p), p.author, ...p.replies.map((r) => r.body)].join("\n").toLowerCase();
      // 和其他分頁同一套語法：空格＝都要有、!詞＝排除、|＝其中一個有
      const terms = q.split(/\s+/).filter(Boolean);
      const match = (s, t) => t.split("|").filter(Boolean).some((w) => s.includes(w));
      list = [...S.posts.values()].filter((p) => {
        if (p._trash) return false;
        const s = text(p);
        return terms.every((t) => (t[0] === "!" ? !(t.length > 1 && match(s, t.slice(1))) : match(s, t)));
      }).sort((x, y) => y.time - x.time);
    } else if (b) {
      const names = await listNames(b, S.channel);
      const page = names.slice(0, S.shown);
      await loadPosts(b, S.channel, page);
      list = page.map((n) => S.posts.get(b.key + "/" + n.slice(0, -5))).filter(Boolean);
      more = names.length > S.shown;
    }
    if (seq !== renderSeq) return;
    const c = S.channel === TRASH ? { name: "垃圾桶", emoji: "🗑️" } : channelOf(b, S.channel);
    $("noteChEmoji").textContent = q ? "🔍" : b ? c.emoji || CH_EMOJI : "🔒";
    $("noteChName").textContent = q ? `搜尋結果　${list.length} 篇` : b ? c.name : "尚未連接筆記本";
    $("noteBookName").textContent = q || !b ? "" : b.name;
    const empty = q ? ["🔍", "找不到符合的貼文，換個關鍵字試試"]
      : !b ? ["🔒", "點左側的筆記本重新連接，或加入新的筆記本"]
      : S.channel === TRASH ? ["🗑️", "垃圾桶是空的"]
      : ["🌱", isLoggedIn ? "這個頻道還沒有貼文，寫下第一篇吧" : "這個頻道還沒有貼文"];
    $("noteList").innerHTML = list.map(postCard).join("")
      + (more ? `<button onclick="NoteModule.more()" class="block mx-auto px-5 py-2 text-sm text-ms-blue bg-white border border-gray-200 rounded-full shadow-sm transition-colors hover:bg-gray-50">載入更早的貼文</button>` : "")
      || `<div class="py-16 text-center text-gray-400 note-fade"><div class="text-5xl">${empty[0]}</div><div class="mt-3">${empty[1]}</div></div>`;
    hydrate($("noteList"));
    const editing = S.editing && S.posts.get(S.editing);
    if (editing && $("noteEdit_body")) {
      await openEditor("noteEdit", draft ? draft.html : await toEditorHtml(editing));
      if (draft) {
        $("noteEdit_title").value = draft.title;
        $("noteEdit_ann").checked = draft.ann;
        annStyle("noteEdit", draft.color);
      } else {
        // 編輯器會微調 HTML 的寫法，要拿「進編輯器後」的版本當比較基準，才不會沒改也被當成有改
        S.editBase = await finalizeHtml(bookOf(editing._book), roosterjs.exportContent(S.eds.noteEdit));
      }
    } else S.editing = null;
  }

  /* 單篇貼文 */
  function postCard(p) {
    const k = postKey(p);
    if (S.editing === k) return formHtml("noteEdit", p, `NoteModule.saveEdit('${k}')`, "NoteModule.cancelEdit()");
    const long = plainText(p).length > 400 || /<img|<table|\]\(files\//.test(p.body);
    const n = p.replies.length, open = S.openReplies.has(k);
    const b = bookOf(p._book);
    const can = isLoggedIn && !p._trash;
    const actions = !isLoggedIn ? "" : p._trash ? `
          <div class="flex gap-2 shrink-0 whitespace-nowrap">
            <button onclick="NoteModule.restore('${k}')" class="px-3 py-1 text-sm text-ms-blue border border-gray-200 rounded-md transition-colors hover:bg-gray-50">還原</button>
            <button onclick="NoteModule.purge('${k}')" class="px-3 py-1 text-sm text-red-600 border border-gray-200 rounded-md transition-colors hover:bg-red-50">永久刪除</button>
          </div>` : `
          <div class="flex gap-1 opacity-0 transition-opacity group-hover/post:opacity-100 focus-within:opacity-100">
            <button title="編輯" aria-label="編輯" onclick="NoteModule.edit('${k}')" class="${ICON_BTN}"><i class="fa-solid fa-pen"></i></button>
            <button title="刪除" aria-label="刪除" onclick="NoteModule.remove('${k}')" class="${ICON_BTN} hover:!text-red-600"><i class="fa-solid fa-trash-can"></i></button>
          </div>`;
    return `
    <article data-book="${p._book}" class="group/post bg-white border border-gray-200 rounded-lg shadow-sm transition-shadow hover:shadow-md note-fade">
      ${p.announce ? `<div class="flex items-center gap-3 px-4 py-4 text-white rounded-t-lg" style="background:${annBg(annColor(p.announceColor))}"><i class="fa-solid fa-megaphone"></i><h2 class="font-bold text-lg">${esc(p.title) || "公告"}</h2></div>` : ""}
      <div class="px-4 pt-4 pb-3">
        <div class="flex items-center gap-3">
          <span class="shrink-0 w-1 h-8 rounded-full" style="background:${barColor(p)}"></span>
          <div class="min-w-0">
            <div class="font-semibold text-sm text-gray-800">${esc(p.author)}</div>
            <div class="text-xs text-gray-500">${fmt(p.time)}${p.edited ? `　已編輯${p.editedAt ? " " + fmt(p.editedAt) : ""}` : ""}${p._trash ? `　${esc(p.deletedBy || "")} 於 ${fmt(p.deletedAt)} 刪除` : ""}${S.query.trim() ? `　${esc(b.name + " › " + channelOf(b, p.channel).name)}` : ""}</div>
          </div>
          <span class="flex-1"></span>
          ${actions}
        </div>
        ${!p.announce && p.title ? `<h2 class="mt-3 font-bold text-lg text-gray-900">${esc(p.title)}</h2>` : ""}
        <div class="note-md mt-2 text-sm leading-relaxed text-gray-800 ${long ? "max-h-72 overflow-hidden" : ""}">${lazy(bodyHtml(p))}</div>
        ${long ? `<button class="mt-2 text-sm text-ms-blue hover:underline" onclick="NoteModule.toggleMore(this)">查看更多</button>` : ""}
      </div>
      ${n || can ? `
      <div class="border-t border-gray-100">
        ${n ? `<button onclick="NoteModule.toggleReplies('${k}')" class="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-left text-gray-600 transition-colors hover:bg-gray-50"><i class="fa-solid fa-comment text-gray-400"></i>${open ? "收合交談" : `檢視交談　${n} 則回覆`}</button>` : ""}
        ${open ? p.replies.map((r) => `
        <div class="group/reply flex gap-3 px-4 py-2 bg-gray-50">
          <span class="shrink-0 w-0.5 self-stretch rounded-full" style="background:${barColor(r)}"></span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 text-xs text-gray-500"><span class="font-semibold text-gray-800">${esc(r.author)}</span><span>${fmt(r.time)}</span>
              ${can ? `<button onclick="NoteModule.removeReply('${k}','${r.id}')" class="opacity-0 text-gray-400 transition-opacity group-hover/reply:opacity-100 focus:opacity-100 hover:text-red-600" title="刪除回覆" aria-label="刪除回覆"><i class="fa-solid fa-trash-can"></i></button>` : ""}</div>
            <div class="note-md text-sm leading-relaxed text-gray-800">${lazy(md(r.body))}</div>
          </div>
        </div>`).join("") : ""}
        ${can ? `
        <div class="flex items-start gap-3 px-4 py-2.5 ${n ? "border-t border-gray-100" : ""}">
          <textarea id="noteReply_${k}" rows="1" onpaste="NoteModule.paste(event)" placeholder="回覆" aria-label="回覆" class="flex-1 px-3 py-1 text-sm bg-gray-100 border border-transparent rounded-md outline-none resize-none transition-colors focus:bg-white focus:border-ms-blue" style="field-sizing:content"></textarea>
          <button onclick="NoteModule.reply('${k}')" title="送出回覆" aria-label="送出回覆" class="${ICON_BTN}"><i class="fa-solid fa-paper-plane"></i></button>
        </div>` : ""}
      </div>` : ""}
    </article>`;
  }

  function toggleMore(btn) {
    const c = btn.previousElementSibling.classList;
    c.toggle("max-h-72"); c.toggle("overflow-hidden");
    btn.textContent = c.contains("max-h-72") ? "查看更多" : "查看較少";
  }

  async function toggleReplies(id) {
    S.openReplies.has(id) ? S.openReplies.delete(id) : S.openReplies.add(id);
    await renderList();
  }

  // ===== 筆記本與頻道 =====

  async function select(key, ch) {
    S.book = key;
    S.channel = ch;
    S.shown = PAGE_SIZE;
    S.editing = null;
    $("noteSearch").value = S.query = "";
    syncAuth();
    renderSidebar();
    // 第一次進這個頻道要去公槽讀檔，先把標題換掉並顯示載入中，點了才有反應
    const b = bookOf(key), c = ch === TRASH ? { name: "垃圾桶", emoji: "🗑️" } : channelOf(b, ch);
    $("noteChEmoji").textContent = c.emoji || CH_EMOJI;
    $("noteChName").textContent = c.name;
    $("noteBookName").textContent = b.name;
    $("noteList").innerHTML = `<div class="py-16 text-center text-gray-400"><i class="fa-solid fa-spinner fa-spin text-3xl"></i><div class="mt-3">載入中…</div></div>`;
    await renderList();
  }

  const searchLater = Utils.debounce(() => safe(renderList)(), 250);
  function search(v) {
    S.query = v;
    searchLater();
  }

  async function more() {
    S.shown += PAGE_SIZE;
    await renderList();
  }

  /* 筆記本與頻道共用的「圖示＋名稱」設定視窗 */
  // 用原生 dialog：Esc、點外面關閉、焦點圈禁、關閉後焦點回到原按鈕都由瀏覽器提供
  function dialog(o) {
    $("noteDialog").innerHTML = `
    <dialog closedby="any" onclose="NoteModule.closeDialog()" aria-label="${o.title}" class="w-[26rem] p-5 bg-white border-0 rounded-xl shadow-2xl note-fade backdrop:bg-black/30">
      <div>
        <div class="mb-4 font-bold text-lg text-gray-800">${o.title}</div>
        ${o.editable ? `
        <div class="flex gap-2">
          <input id="noteDlgEmoji" value="${esc(o.emoji)}" maxlength="8" aria-label="圖示" class="w-14 text-2xl text-center bg-gray-100 rounded-md outline-none focus:ring-2 focus:ring-ms-blue">
          <input id="noteDlgName" value="${esc(o.name)}" placeholder="${o.placeholder}" aria-label="名稱" onkeydown="if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){${o.onSave}}" class="flex-1 px-3 py-2 bg-gray-100 rounded-md outline-none focus:ring-2 focus:ring-ms-blue">
        </div>
        <div class="flex flex-wrap gap-1 mt-3">
          ${EMOJIS.map((e) => `<button onclick="document.getElementById('noteDlgEmoji').value='${e}'" class="w-9 h-9 text-xl rounded-md transition-colors hover:bg-gray-100">${e}</button>`).join("")}
        </div>
        <div class="mt-2 text-xs text-gray-400">想用其他圖示：點左上角的圖示欄位，按 Win + . 挑選</div>` : ""}
        ${o.note ? `<div class="mt-3 text-xs leading-relaxed text-gray-500">${o.note}</div>` : ""}
        <div class="flex items-center gap-2 mt-5">
          ${o.danger ? `<button onclick="${o.danger[1]}" class="px-3 py-1.5 text-sm text-red-600 rounded-md transition-colors hover:bg-red-50">${o.danger[0]}</button>` : ""}
          <span class="flex-1"></span>
          <button onclick="NoteModule.closeDialog()" class="px-4 py-1.5 text-sm text-gray-600 rounded-md transition-colors hover:bg-gray-100">${o.editable ? "取消" : "關閉"}</button>
          ${o.editable ? `<button onclick="${o.onSave}" class="text-sm btn-primary">${o.saveText}</button>` : ""}
        </div>
      </div>
    </dialog>`;
    $("noteDialog").firstElementChild.showModal();
    if (o.editable) $("noteDlgName").focus();
  }

  let zoomList = [];

  /* 圖片放大檢視：點圖片切換大小、滾輪縮放、放大後可拖曳；點圖片以外或按 Esc 關閉 */
  // 圖片用 m-auto 置中而不是 items-center：後者在圖片比視窗大時，上緣和左緣會捲不到
  // list 是同一則內容裡的所有圖片；兩張以上時下方出現縮圖列，可點縮圖或按左右鍵換圖
  function zoom(src, list = zoomList) {
    zoomList = list;
    const many = list.length > 1;
    $("noteDialog").innerHTML = `
    <dialog closedby="any" onclose="NoteModule.closeDialog()" aria-label="圖片放大檢視" tabindex="-1" class="fixed inset-0 m-0 p-0 w-full h-full max-w-none max-h-none overflow-auto bg-black/70 border-0 outline-none ${$("noteDialog").firstElementChild ? "" : "note-fade"}" onclick="if(event.target.tagName!=='IMG')NoteModule.closeDialog()">
      <div class="flex w-max min-w-full min-h-full p-6 ${many ? "pb-24" : ""}">
        <img src="${esc(src)}" alt="" draggable="false" class="m-auto bg-white rounded shadow-2xl cursor-zoom-in" onpointerdown="NoteModule.zoomDrag(event)" onclick="if(this.dataset.dragged){this.dataset.dragged='';return}NoteModule.zoomTo(this, this.style.width ? 0 : Math.max(this.naturalWidth, this.getBoundingClientRect().width * 2))" onwheel="event.preventDefault();NoteModule.zoomTo(this, this.getBoundingClientRect().width * (event.deltaY < 0 ? 1.25 : 0.8))">
      </div>
      ${many ? `<div data-thumbs class="fixed bottom-4 left-1/2 flex gap-2 max-w-[90vw] p-2 overflow-x-auto bg-black/60 rounded-lg -translate-x-1/2" onclick="event.stopPropagation()">
        ${list.map((u) => `<img src="${esc(u)}" alt="" onclick="NoteModule.zoom(this.src)" class="shrink-0 w-14 h-14 object-cover bg-white rounded cursor-pointer border-2 ${u === src ? "border-ms-blue" : "border-transparent opacity-60 hover:opacity-100"}">`).join("")}
      </div>` : ""}
    </dialog>`;
    const box = $("noteDialog").firstElementChild;
    // 換圖是整個重建 dialog，要重新 showModal 才會回到最上層
    box.showModal();
    box.onkeydown = (e) => {
      const next = list[list.indexOf(src) + ({ ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0)];
      if (next && next !== src) zoom(next);
    };
    zoomTo(box.querySelector("img"), 0);
    box.focus();
  }

  /* 設定放大檢視的圖片寬度；0 代表符合視窗 */
  function zoomTo(img, width) {
    img.style.maxWidth = width ? "none" : "calc(100vw - 3rem)";
    // 有縮圖列時多留下方空間，圖片才不會被縮圖蓋住
    img.style.maxHeight = width ? "none" : `calc(100vh - ${img.closest("dialog").querySelector("[data-thumbs]") ? 7.5 : 3}rem)`;
    img.style.width = width ? Math.max(50, Math.round(width)) + "px" : "";
    img.classList.toggle("cursor-zoom-in", !width);
    img.classList.toggle("cursor-grab", !!width);
  }

  /* 放大後按住拖曳移動畫面；有拖動就記下來，放開時的點擊才不會把圖縮回去 */
  function zoomDrag(e) {
    const img = e.currentTarget, box = img.closest("dialog");
    let moved = 0;
    e.preventDefault();
    // 抓住指標，拖到圖片外面也繼續跟；抓不到（指標已放開）就只在圖片範圍內有效
    try { img.setPointerCapture(e.pointerId); } catch {}
    img.onpointermove = (m) => {
      moved += Math.abs(m.movementX) + Math.abs(m.movementY);
      box.scrollLeft -= m.movementX;
      box.scrollTop -= m.movementY;
    };
    img.onpointerup = () => {
      img.onpointermove = img.onpointerup = null;
      img.dataset.dragged = moved > 4 ? "1" : "";
    };
  }

  function closeDialog() {
    $("noteDialog").innerHTML = "";
  }

  /* 筆記本設定；移除只是從這台電腦的清單拿掉，不刪資料夾 */
  function bookDialog(key) {
    if (!isLoggedIn) return;
    const b = bookOf(key);
    dialog({
      title: "筆記本設定", editable: true, emoji: b.emoji, name: b.name, placeholder: "為筆記本命名",
      onSave: `NoteModule.saveBook('${key}')`, saveText: "儲存",
      note: `資料夾：${esc(b.handle.name || "示範資料")}<br>名稱與圖示存在資料夾裡，一起使用的人會看到相同的設定`,
      danger: ["從清單移除", `NoteModule.removeBook('${key}')`],
    });
  }

  async function saveBook(key) {
    if (!isLoggedIn) return;
    const b = bookOf(key);
    const name = $("noteDlgName").value.trim(), emoji = $("noteDlgEmoji").value.trim() || BOOK_EMOJI;
    if (!name) return ToastModule.show("請輸入筆記本名稱", "warning");
    if (b.hasMeta && b.name === name && b.emoji === emoji) return closeDialog();
    await writeFile(b.handle, "notebook.json", JSON.stringify({ name, emoji }));
    Object.assign(b, { name, emoji, hasMeta: true });
    closeDialog();
    renderSidebar();
    await renderList();
  }

  async function removeBook(key) {
    if (!isLoggedIn) return;
    const b = bookOf(key);
    if (!confirm(`從清單移除「${b.name || b.handle.name}」？\n資料夾裡的筆記不會被刪除，之後可以再加入`)) return;
    S.books = S.books.filter((x) => x.key !== key);
    await saveBooks();
    closeDialog();
    if (!S.books.length) return renderWelcome();
    await reload();
  }

  /* 新增或設定頻道；不帶 id 為新增 */
  function channelDialog(key, id) {
    if (!isLoggedIn) return;
    const c = id ? channelOf(bookOf(key), id) : null;
    dialog({
      title: c ? "頻道設定" : "新增頻道", editable: true, emoji: c ? c.emoji || CH_EMOJI : CH_EMOJI, name: c ? c.name : "", placeholder: "為頻道命名",
      onSave: `NoteModule.saveChannel('${key}','${id || ""}')`, saveText: c ? "儲存" : "新增",
      danger: c ? ["刪除頻道", `NoteModule.deleteChannel('${key}','${id}')`] : null,
    });
  }

  async function saveChannel(key, id) {
    if (!isLoggedIn) return;
    const b = bookOf(key);
    const name = $("noteDlgName").value.trim(), emoji = $("noteDlgEmoji").value.trim() || CH_EMOJI;
    if (!name) return ToastModule.show("請輸入頻道名稱", "warning");
    // 先重讀再寫，避免蓋掉另一個人剛改的頻道
    const list = await readJson(b.handle, "channels.json", b.channels);
    if (id) {
      const c = list.find((x) => x.id === id);
      if (!c) return ToastModule.show("這個頻道已經被刪除", "warning");
      if (c.name === name && (c.emoji || CH_EMOJI) === emoji) return closeDialog();
      Object.assign(c, { name, emoji });
    } else {
      // 資料夾代號固定不變，頻道改名不必搬資料夾
      const max = Math.max(0, ...list.map((x) => +(/^ch(\d+)$/.exec(x.id) || [])[1] || 0));
      id = "ch" + String(max + 1).padStart(2, "0");
      list.push({ id, name, emoji });
    }
    await writeFile(b.handle, "channels.json", JSON.stringify(list));
    b.channels = list;
    closeDialog();
    await select(key, id);
  }

  async function deleteChannel(key, id) {
    if (!isLoggedIn) return;
    const b = bookOf(key);
    if (b.channels.length < 2) return ToastModule.show("至少要保留一個頻道", "warning");
    // 不連同貼文一起刪，避免誤刪整個頻道的內容
    S.names[namesKey(b, id)] = null;
    if ((await listNames(b, id)).length) return ToastModule.show("頻道裡還有貼文，請先刪除貼文再刪頻道", "warning");
    if (!confirm(`確定刪除頻道「${channelOf(b, id).name}」？`)) return;
    // 不用「連內容一起刪」：確認視窗開著的期間別人貼了文，資料夾就不是空的，這裡會失敗而不是把貼文刪掉
    try { await b.postsDir.removeEntry(id); } catch (e) {
      if (e.name === "NotFoundError") { /* 資料夾本來就不在，繼續更新頻道清單 */ } else return ToastModule.show("頻道裡有新的貼文，沒有刪除", "warning");
    }
    const list = (await readJson(b.handle, "channels.json", b.channels)).filter((c) => c.id !== id);
    await writeFile(b.handle, "channels.json", JSON.stringify(list));
    b.channels = list;
    closeDialog();
    await select(key, list[0].id);
  }

  // ===== 貼文 =====

  async function compose(announce) {
    $("noteComposeBar").classList.add("hidden");
    $("noteComposeForm").classList.remove("hidden");
    $("noteNew_ann").checked = announce;
    // 已經開著的表單保留原本選的顏色
    annStyle("noteNew", S.eds.noteNew ? undefined : "");
    // 已經開著就沿用，避免清掉打到一半的內容
    if (!S.eds.noteNew) await openEditor("noteNew");
    $("noteNew_title").focus();
  }

  function cancelCompose() {
    closeEditor("noteNew");
    $("noteNew_title").value = "";
    $("noteComposeForm").classList.add("hidden");
    $("noteComposeBar").classList.remove("hidden");
  }

  /* 送出按鈕的忙碌提示；存圖片到網路磁碟要幾秒，沒有提示會被當成沒反應 */
  async function busy(btn, label, fn) {
    if (btn.disabled) return;
    const text = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = text; }
  }

  async function post() {
    const b = bookOf(S.book);
    if (!isLoggedIn || !b || !S.eds.noteNew) return;
    if (S.uploading) return ToastModule.show("檔案還在上傳，請稍候", "warning");
    await busy($("noteNew_save"), "張貼中…", async () => {
      const title = $("noteNew_title").value.trim(), body = await finalizeHtml(b, roosterjs.exportContent(S.eds.noteNew));
      if (!title && !hasContent(body)) return ToastModule.show("請輸入主旨或內容", "warning");
      const u = me();
      const p = { id: await newPostId(await channelDir(b, S.channel)), channel: S.channel, title, body, format: "html", author: u.name, authorId: u.id, time: Date.now(), announce: $("noteNew_ann").checked, announceColor: $("noteNew_annColor").value, replies: [], _book: b.key };
      await savePost(p);
      S.posts.set(postKey(p), p);
      (await listNames(b, S.channel)).unshift(p.id + ".json");
      cancelCompose();
      await renderList();
    });
  }

  /* 修改貼文：先重讀檔案再套用變更，避免蓋掉另一個人剛存的內容 */
  async function updatePost(k, fn, beforeRender) {
    const old = S.posts.get(k), b = bookOf(old._book);
    const p = await readJson(await channelDir(b, old.channel), old.id + ".json");
    if (!p) {
      S.posts.delete(k);
      S.names[namesKey(b, old.channel)] = null;
      ToastModule.show("這篇貼文已經被刪除", "warning");
    } else {
      p._book = b.key;
      fn(p);
      await savePost(p);
      S.posts.set(k, p);
    }
    if (beforeRender) beforeRender();
    await renderList();
  }

  async function edit(id) {
    // 先關掉上一篇的編輯器，否則它的草稿會被帶進這一篇
    closeEditor("noteEdit");
    S.editing = id;
    await renderList();
  }

  async function cancelEdit() {
    closeEditor("noteEdit");
    S.editing = null;
    await renderList();
  }

  async function saveEdit(id) {
    if (!isLoggedIn || !S.eds.noteEdit) return;
    if (S.uploading) return ToastModule.show("檔案還在上傳，請稍候", "warning");
    await busy($("noteEdit_save"), "儲存中…", async () => {
      const old = S.posts.get(id);
      const title = $("noteEdit_title").value.trim(), announce = $("noteEdit_ann").checked, announceColor = $("noteEdit_annColor").value;
      const body = await finalizeHtml(bookOf(old._book), roosterjs.exportContent(S.eds.noteEdit));
      // 寫檔成功後才關編輯器；先關的話寫檔失敗（例如公槽斷線）時剛改的內容就沒了
      const close = () => { closeEditor("noteEdit"); S.editing = null; };
      if (old.title === title && body === S.editBase && !!old.announce === announce && annColor(old.announceColor) === announceColor) { close(); return renderList(); }
      const before = filesIn(old);
      await updatePost(id, (p) => Object.assign(p, { title, body, format: "html", announce, announceColor, edited: true, editedAt: Date.now() }), close);
      // 編輯時拿掉的圖片、附件順手清掉；清不掉只是多留一個檔，不影響已存好的貼文
      const now = S.posts.get(id), gone = now ? before.filter((n) => !filesIn(now).includes(n)) : [];
      if (gone.length) await removeUnused(bookOf(old._book), gone).catch(() => {});
    });
  }

  /* 刪除貼文：先移到垃圾桶，在垃圾桶裡永久刪除才真的消失 */
  async function remove(id) {
    if (!isLoggedIn || !confirm("把這篇貼文移到垃圾桶？")) return;
    const p = S.posts.get(id), b = bookOf(p._book);
    // 先寫進垃圾桶再刪原檔，中途失敗頂多兩邊都有，不會兩邊都沒有
    await writeFile(b.trashDir, p.id + ".json", JSON.stringify({ ...p, _book: undefined, deletedAt: Date.now(), deletedBy: me().name }));
    await (await channelDir(b, p.channel)).removeEntry(p.id + ".json");
    S.posts.delete(id);
    S.names[namesKey(b, p.channel)] = S.names[namesKey(b, TRASH)] = null;
    await renderList();
  }

  async function restore(id) {
    if (!isLoggedIn) return;
    const p = S.posts.get(id), b = bookOf(p._book);
    // 原本的頻道已經被刪掉時，放回第一個頻道
    const channel = b.channels.some((c) => c.id === p.channel) ? p.channel : b.channels[0].id;
    await writeFile(await channelDir(b, channel), p.id + ".json", JSON.stringify({ ...p, channel, _book: undefined, _trash: undefined, deletedAt: undefined, deletedBy: undefined }));
    await b.trashDir.removeEntry(p.id + ".json");
    S.posts.delete(id);
    S.names[namesKey(b, channel)] = S.names[namesKey(b, TRASH)] = null;
    ToastModule.show(`已還原到「${esc(channelOf(b, channel).name)}」`, "success");
    await renderList();
  }

  /* 貼文與回覆用到的圖片、附件檔名 */
  function filesIn(p) {
    const t = document.createElement("template");
    t.innerHTML = bodyHtml(p) + p.replies.map((r) => md(r.body)).join("");
    return [...t.content.querySelectorAll('[src^="files/"], [href^="files/"]')].map((x) => decodeURIComponent((x.getAttribute("src") || x.getAttribute("href")).slice(6)));
  }

  /* 刪掉沒有任何貼文在用的檔案；skip 是即將刪除、不算在內的那一篇 */
  async function removeUnused(b, names, skip) {
    // 在編輯器裡複製圖片貼到別篇時兩篇會共用同一個檔，別篇（含垃圾桶）還在用的不能刪
    await loadAll();
    await loadPosts(b, TRASH, await listNames(b, TRASH));
    // 不能用字串比對貼文內容：檔名含 & 之類的字元時，存檔的 HTML 會序列化成 &amp;
    const used = new Set();
    [...S.posts.values()].filter((x) => x !== skip && x._book === b.key).forEach((x) => filesIn(x).forEach((n) => used.add(n)));
    for (const name of new Set(names)) {
      if (used.has(name)) continue;
      try { await b.filesDir.removeEntry(name); } catch (e) { if (e.name !== "NotFoundError") throw e; }
    }
  }

  /* 永久刪除：連同貼文與回覆用到的圖片、附件檔一起刪 */
  async function purge(id) {
    if (!isLoggedIn || !confirm("永久刪除這篇貼文和它的圖片、附件？\n刪除後無法復原")) return;
    const p = S.posts.get(id), b = bookOf(p._book);
    await removeUnused(b, filesIn(p), p);
    await b.trashDir.removeEntry(p.id + ".json");
    S.posts.delete(id);
    S.names[namesKey(b, TRASH)] = null;
    await renderList();
  }

  async function reply(id) {
    if (!isLoggedIn) return;
    const body = $("noteReply_" + id).value.trim();
    if (!body) return;
    const u = me();
    S.openReplies.add(id);
    await updatePost(id, (p) => p.replies.push({ id: `${stamp()}-${u.id.replace(/[^\w-]/g, "_")}-${Math.random().toString(36).slice(2, 6)}`, author: u.name, authorId: u.id, time: Date.now(), body }));
  }

  async function removeReply(id, rid) {
    if (!isLoggedIn || !confirm("確定刪除這則回覆？")) return;
    await updatePost(id, (p) => (p.replies = p.replies.filter((r) => r.id !== rid)));
  }

  // ===== 附件 =====

  /* 附件存檔用的檔名；檔名裡的空白與括號會讓連結斷掉 */
  const fileName = (f) => `${stamp()}-${Math.random().toString(36).slice(2, 6)}_${f.name.replace(/[\\/:*?"<>|\s()\[\]#%]/g, "_")}`;

  /* 張貼與編輯表單的附件：先存檔，再插進編輯器 */
  async function attachFiles(k, files) {
    const ed = S.eds[k], b = bookOf(k === "noteEdit" ? S.posts.get(S.editing)._book : S.book);
    if (!ed || !b || !files.length) return;
    // 編輯表單在上傳途中可能被重畫，元素要先抓好，之後只動這兩個
    const status = $(k + "_busy"), btn = $(k + "_attachBtn");
    S.uploading++;
    btn.disabled = true;
    status.classList.replace("hidden", "flex");
    try {
      ed.focus();
      let done = 0;
      for (const f of files) {
        status.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>上傳中… ${++done}/${files.length}`;
        const name = fileName(f);
        await writeFile(b.filesDir, name, f);
        S.attached.set(name, b.key + "|" + k);
        // 表單已經關掉或換了一個編輯器就不再插入，檔案留在資料夾裡
        if (S.eds[k] !== ed) break;
        // 檔案區塊整塊不可編輯：名稱不能改字，Backspace 一次刪整塊
        insertHtml(ed, f.type.startsWith("image/") ? `<img src="${await fileUrl(b, name)}">` : `<a href="files/${name}" title="${esc(f.name)}" contenteditable="false">${esc(f.name)}</a>&nbsp;`);
      }
    } finally {
      S.uploading--;
      btn.disabled = false;
      status.classList.replace("flex", "hidden");
    }
  }

  /* 把檔案拖進編輯區；不攔下來的話瀏覽器會直接開啟那個檔案而離開頁面 */
  function drop(e, k) {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    safe(attachFiles)(k, [...e.dataTransfer.files]);
  }

  /* 回覆框的附件：存檔並在游標處插入 Markdown 連結（回覆仍是 Markdown） */
  async function addFiles(files, ta) {
    const box = ta.closest("[data-book]");
    const b = bookOf(box ? box.dataset.book : S.book);
    for (const f of files) {
      const name = fileName(f);
      await writeFile(b.filesDir, name, f);
      const link = `${f.type.startsWith("image/") ? "!" : ""}[${f.name.replace(/[\[\]]/g, "")}](files/${name})\n`;
      ta.setRangeText(link, ta.selectionStart, ta.selectionEnd, "end");
    }
  }

  function paste(e) {
    if (!e.clipboardData.files.length) return;
    e.preventDefault();
    safe(addFiles)(e.clipboardData.files, e.target);
  }

  function attach(k) {
    const i = document.createElement("input");
    i.type = "file";
    i.multiple = true;
    i.onchange = () => safe(attachFiles)(k, [...i.files]);
    i.click();
  }

  // ===== 對外介面 =====

  /* 讀寫失敗（例如網路磁碟斷線）必須讓使用者知道 */
  function safe(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        console.error(e);
        ToastModule.show("筆記存取失敗：" + esc((e && e.message) || e), "error", 4000);
      }
    };
  }

  const api = { open, reload, refresh, addBook, addBookHandle, grant, saveBook, removeBook, select, more, saveChannel, deleteChannel, reorder,compose, post, edit, cancelEdit, saveEdit, remove, restore, purge, reply, removeReply, toggleReplies, addFiles, attachFiles };
  return {
    ...Object.fromEntries(Object.entries(api).map(([k, fn]) => [k, safe(fn)])),
    search, hasDraft, cancelCompose, annStyle, cmd, zoom, zoomTo, zoomDrag, drop, toggleMore, bookDialog, channelDialog, closeDialog, paste, attach,
  };
})();
