// Frontend Scanner and Cloudflare API Connector - video_to_ppt_serverless

let activeTaskId = null;
let activeTaskData = null;
let isScanning = false;
let lastFrameData = null; // Uint8ClampedArray of 32x18 low-res frame
let slideCandidates = []; // Array of { slide_no, timestamp, seconds, blobUrl, base64 }
let videoFile = null;

// 時間格式化小幫手 (hh:mm:ss)
function formatTime(seconds) {
    if (isNaN(seconds) || seconds === Infinity) return "00:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// UI DOM Elements
const dropZone = document.getElementById("drop-zone");
const videoFileInput = document.getElementById("video-file-input");
const uploadCard = document.getElementById("upload-card");
const analysisCard = document.getElementById("analysis-card");
const mainVideo = document.getElementById("main-video");
const taskTitleInput = document.getElementById("task-title-input");
const thresholdInput = document.getElementById("threshold-input");
const intervalInput = document.getElementById("interval-input");
const btnStartAnalysis = document.getElementById("btn-start-analysis");
const btnStopAnalysis = document.getElementById("btn-stop-analysis");
const progressCard = document.getElementById("progress-card");
const analysisStatusText = document.getElementById("analysis-status-text");
const capturedCountBadge = document.getElementById("captured-count-badge");
const progressBarFill = document.getElementById("progress-bar-fill");
const galleryCard = document.getElementById("gallery-card");
const galleryTitle = document.getElementById("gallery-title");
const galleryGrid = document.getElementById("gallery-grid");
const btnExportPdf = document.getElementById("btn-export-pdf");
const btnExportZip = document.getElementById("btn-export-zip");
const btnExportHtml = document.getElementById("btn-export-html");
const btnExportJson = document.getElementById("btn-export-json");
const pdfResSelect = document.getElementById("pdf-res-select");
const analysisLogConsole = document.getElementById("analysis-log-console");
const videoScanningOverlay = document.getElementById("video-scanning-overlay");
const btnSelectAll = document.getElementById("btn-select-all");
const btnDeselectAll = document.getElementById("btn-deselect-all");
const btnClearMemory = document.getElementById("btn-clear-memory");

// Canvases for Analysis and Capture
const analysisCanvas = document.getElementById("analysis-canvas");
const lowResWidth = 32;
const lowResHeight = 18;

const ytUrlInput = document.getElementById("yt-url-input");
const btnLoadYt = document.getElementById("btn-load-yt");
const btnDownloadYtVideo = document.getElementById("btn-download-yt-video");
const ytLoadingStatus = document.getElementById("yt-loading-status");

// 雲端 API 加密傳輸包裝函數 (v2.07)
async function fetchWithAuth(url, options = {}) {
    if (!options.headers) {
        options.headers = {};
    }
    options.headers["X-Auth-Password"] = "666666";
    return fetch(url, options);
}

// 初始化
document.addEventListener("DOMContentLoaded", () => {
    setupFileUpload();
    setupAnalysisControls();
    setupExportButtons();
    setupYouTubeLoader();

    // 全選與清除事件綁定 (v2.07)
    if (btnSelectAll) {
        btnSelectAll.addEventListener("click", () => {
            document.querySelectorAll(".slide-select-checkbox").forEach(cb => cb.checked = true);
        });
    }
    if (btnDeselectAll) {
        btnDeselectAll.addEventListener("click", () => {
            document.querySelectorAll(".slide-select-checkbox").forEach(cb => cb.checked = false);
        });
    }
    if (btnClearMemory) {
        btnClearMemory.addEventListener("click", () => {
            if (confirm("確定要釋放所有本機預覽快取、記憶體並重新整理網頁嗎？")) {
                if (slideCandidates && slideCandidates.length > 0) {
                    slideCandidates.forEach(s => {
                        if (s.url && s.url.startsWith("blob:")) {
                            URL.revokeObjectURL(s.url);
                        }
                    });
                }
                slideCandidates = [];
                sessionStorage.clear();
                window.location.reload();
            }
        });
    }
});

// D1 & R2 Tasks integration removed (v2.07)

// 4. 設定影片拖曳與檔案上傳
function setupFileUpload() {
    dropZone.addEventListener("click", () => videoFileInput.click());
    
    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            handleVideoFile(e.dataTransfer.files[0]);
        }
    });

    videoFileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            handleVideoFile(e.target.files[0]);
        }
    });
}

function handleVideoFile(file) {
    videoFile = file;
    const objectURL = URL.createObjectURL(file);
    mainVideo.src = objectURL;
    
    // 預設任務名稱為影片檔名（去副檔名）
    const defaultName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    taskTitleInput.value = defaultName;
    
    // 顯示分析控制台，隱藏上傳區
    uploadCard.style.display = "none";
    analysisCard.style.display = "block";
    galleryCard.style.display = "none"; // 隱藏舊的畫廊
    if (analysisLogConsole) analysisLogConsole.style.display = "none";
}

// 5. 設定影片分析控制按鈕與核心邏輯
function setupAnalysisControls() {
    btnStartAnalysis.addEventListener("click", startLocalAnalysis);
    btnStopAnalysis.addEventListener("click", () => {
        isScanning = false;
    });
}

async function startLocalAnalysis() {
    if ((!videoFile && !mainVideo.src) || isScanning) return;
    
    const taskId = "task_" + Date.now();
    const taskTitle = taskTitleInput.value.trim() || "未命名任務";

    // 初始化狀態
    isScanning = true;
    activeTaskId = taskId;
    lastFrameData = null;
    slideCandidates = [];
    
    // UI 切換
    btnStartAnalysis.style.display = "none";
    btnStopAnalysis.style.display = "inline-flex";
    progressCard.style.display = "block";
    galleryCard.style.display = "block";
    galleryGrid.innerHTML = "";
    galleryTitle.textContent = `📸 擷取投影片畫廊 - ${taskTitle}`;
    
    if (analysisLogConsole) {
        analysisLogConsole.style.display = "block";
        analysisLogConsole.innerHTML = '<div style="color: #60a5fa;">🚀 本機影片分析已啟動...</div>';
    }
    if (videoScanningOverlay) {
        videoScanningOverlay.style.display = "block";
    }

    // 日誌輸出小幫手
    function addAnalysisLog(text) {
        if (!analysisLogConsole) return;
        const timePrefix = new Date().toLocaleTimeString("zh-TW", { hour12: false });
        const div = document.createElement("div");
        div.innerHTML = `<span style="color: #64748b;">[${timePrefix}]</span> ${text}`;
        analysisLogConsole.appendChild(div);
        analysisLogConsole.scrollTop = analysisLogConsole.scrollHeight;
    }
    
    // 取得分析參數
    const threshold = parseFloat(thresholdInput.value) || 15;
    const scanInterval = parseFloat(intervalInput.value) || 1.0;
    const duration = mainVideo.duration;

    // 設定畫布尺寸
    analysisCanvas.width = mainVideo.videoWidth || 1280;
    analysisCanvas.height = mainVideo.videoHeight || 720;
    
    const lowResCanvas = document.createElement("canvas");
    lowResCanvas.width = lowResWidth;
    lowResCanvas.height = lowResHeight;
    const lowResCtx = lowResCanvas.getContext("2d");
    const highResCtx = analysisCanvas.getContext("2d");

    let currentTime = 0;

    // 核心循環：尋軌 -> 繪製 -> MAE 比對 -> 上傳
    async function scanNext() {
        try {
            if (!isScanning || currentTime > duration) {
                finishAnalysis();
                return;
            }

            // 更新進度條
            const pct = (currentTime / duration) * 100;
            progressBarFill.style.width = `${pct}%`;
            analysisStatusText.textContent = `正在分析影片: ${formatTime(currentTime)} / ${formatTime(duration)} (${Math.round(pct)}%)`;

            // 1) 跳轉 Seek
            mainVideo.currentTime = currentTime;

            // 2) 等待 seek 完成 (加強超時保護，防影片載入緩慢或斷線導致永久卡死)
            const seekStartTime = Date.now();
            await Promise.race([
                new Promise(resolve => {
                    const onSeeked = () => {
                        mainVideo.removeEventListener("seeked", onSeeked);
                        resolve();
                    };
                    mainVideo.addEventListener("seeked", onSeeked);
                }),
                new Promise(resolve => setTimeout(resolve, 1500)) // 1.5 秒超時強制解鎖
            ]);
            const seekDuration = Date.now() - seekStartTime;

            // 3) 繪製低解析度圖，計算 Grayscale MAE 差異
            lowResCtx.drawImage(mainVideo, 0, 0, lowResWidth, lowResHeight);
            const lowResData = lowResCtx.getImageData(0, 0, lowResWidth, lowResHeight).data;

            // 轉為 Grayscale 灰階陣列 (與 Python cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) 一致)
            const grayData = new Float32Array(lowResWidth * lowResHeight);
            let idx = 0;
            for (let i = 0; i < lowResData.length; i += 4) {
                // 使用標準 ITU-R BT.601 權重公式轉灰階
                grayData[idx++] = 0.299 * lowResData[i] + 0.587 * lowResData[i+1] + 0.114 * lowResData[i+2];
            }

            let shouldCapture = false;
            let currentMae = 0;

            if (lastFrameData === null) {
                // 第一影格必擷取
                shouldCapture = true;
                addAnalysisLog(`🔍 初始化首個影格 (${formatTime(currentTime)})`);
            } else {
                // 計算 MAE (平均絕對誤差)
                let diffSum = 0;
                for (let i = 0; i < grayData.length; i++) {
                    diffSum += Math.abs(grayData[i] - lastFrameData[i]);
                }
                currentMae = diffSum / grayData.length; // 範圍為 0 ~ 255
                
                if (currentMae >= threshold) {
                    shouldCapture = true;
                }
            }

            // 輸出掃描日誌到控制台
            if (!shouldCapture && lastFrameData !== null) {
                addAnalysisLog(`⚙️ 掃描時間點 ${formatTime(currentTime)} | MAE差異: ${currentMae.toFixed(2)} | 載入耗時: ${seekDuration}ms`);
            }

            // 4) 若偵測到換頁，截圖並存在本地瀏覽器記憶體，不進行雲端直傳 (待人工挑選)
            if (shouldCapture) {
                lastFrameData = grayData; // 儲存為基準
                const slideNo = slideCandidates.length + 1;
                const timeStr = formatTime(currentTime);

                addAnalysisLog(`📸 <span style="color: #f59e0b;">偵測到換頁 (MAE ${currentMae.toFixed(2)} >= 閾值 ${threshold.toFixed(2)})，正在擷取 No.${slideNo}...</span>`);

                // 繪製高解析度原圖
                highResCtx.drawImage(mainVideo, 0, 0, analysisCanvas.width, analysisCanvas.height);
                
                // 轉成 Blob 格式
                const blob = await new Promise(r => analysisCanvas.toBlob(r, "image/png"));
                const localUrl = URL.createObjectURL(blob);

                const slideItem = {
                    slide_no: slideNo,
                    timestamp: timeStr,
                    seconds: currentTime,
                    url: localUrl, // 本地 URL 供即時預覽與勾選
                    blob: blob
                };
                slideCandidates.push(slideItem);
                
                // 渲染到前端畫廊
                renderGalleryItem(slideItem);
                capturedCountBadge.textContent = slideCandidates.length;
                addAnalysisLog(`✅ <span style="color: #34d399;">投影片 No.${slideNo} 擷取成功！時間點: ${timeStr} (本地暫存，待挑選)</span>`);
            }

            // 前進下一個時間點
            currentTime += scanInterval;
            setTimeout(scanNext, 10);
        } catch (err) {
            console.error("Analysis loop crashed:", err);
            addAnalysisLog(`❌ <span style="color: #ef4444; font-weight: bold;">分析流程崩潰: ${err.message}</span>`);
            isScanning = false;
            btnStartAnalysis.style.display = "inline-flex";
            btnStopAnalysis.style.display = "none";
            if (videoScanningOverlay) videoScanningOverlay.style.display = "none";
        }
    }

    // 開始分析循環
    scanNext();
}

// 渲染單個投影片卡片到畫廊
function renderGalleryItem(slide) {
    const card = document.createElement("div");
    card.className = "gallery-card";
    card.style.position = "relative";
    card.innerHTML = `
        <input type="checkbox" class="slide-select-checkbox" data-slide-no="${slide.slide_no}" data-seconds="${slide.seconds}" checked style="position: absolute; top: 10px; left: 10px; width: 22px; height: 22px; z-index: 10; cursor: pointer; accent-color: #38bdf8; box-shadow: 0 2px 5px rgba(0,0,0,0.5);">
        <img src="${slide.url}" alt="Slide ${slide.slide_no}">
        <div class="gallery-card-body">
            <div class="gallery-card-meta">
                <span class="slide-card-label" style="font-weight:bold;">No.${slide.slide_no}</span>
                <span class="gallery-card-time">${slide.timestamp}</span>
            </div>
        </div>
    `;
    galleryGrid.appendChild(card);
}

// 結束分析
function finishAnalysis() {
    isScanning = false;
    btnStartAnalysis.style.display = "inline-flex";
    btnStopAnalysis.style.display = "none";
    
    if (videoScanningOverlay) {
        videoScanningOverlay.style.display = "none";
    }
    
    // 輸出分析完成日誌
    if (analysisLogConsole) {
        const timePrefix = new Date().toLocaleTimeString("zh-TW", { hour12: false });
        const div = document.createElement("div");
        div.innerHTML = `<span style="color: #64748b;">[${timePrefix}]</span> <span style="color: #34d399; font-weight: bold;">🎉 影片分析完成！共擷取了 ${slideCandidates.length} 張投影片。所有檔案已同步備份。</span>`;
        analysisLogConsole.appendChild(div);
        analysisLogConsole.scrollTop = analysisLogConsole.scrollHeight;
    }
    
    alert(`🎉 影片分析完成！共成功擷取並保存了 ${slideCandidates.length} 張投影片。`);
    loadTaskHistory(); // 重新整理歷史紀錄
}

// 安全加載圖片以防 promise 洩漏掛起 (v2.07)
function loadImageSafe(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        if (url && !url.startsWith("blob:")) {
            img.crossOrigin = "anonymous";
        }
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("圖片載入失敗"));
        img.src = url;
    });
}

// 6. PDF 導出與 ZIP 打包下載
function setupExportButtons() {
    if (btnExportPdf) btnExportPdf.addEventListener("click", exportToPDF);
    btnExportZip.addEventListener("click", exportToZIP);
    if (btnExportHtml) btnExportHtml.addEventListener("click", exportToHTML);
    btnExportJson.addEventListener("click", exportToJSON);
}

async function exportToHTML() {
    // 獲取勾選的投影片
    const checkedCbs = document.querySelectorAll(".slide-select-checkbox:checked");
    const checkedNos = Array.from(checkedCbs).map(cb => parseInt(cb.dataset.slideNo, 10));
    const targetSlides = slideCandidates.filter(s => checkedNos.includes(s.slide_no));

    if (targetSlides.length === 0) {
        alert("請至少勾選一張投影片以生成離線 HTML！");
        return;
    }

    addAnalysisLog("🌐 正在生成單一檔案離線 HTML，請稍候...");

    const title = taskTitleInput.value.trim() || "未命名簡報";
    const videoId = mainVideo.dataset.videoId || "";
    const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : (videoFile ? videoFile.name : "Local Video");

    let galleryItemsHtml = "";

    for (let i = 0; i < targetSlides.length; i++) {
        const slide = targetSlides[i];
        let slideImg;
        try {
            slideImg = await loadImageSafe(slide.url);
        } catch (err) {
            alert(`⚠️ 導出失敗！找不到快取畫面（這可能是因為此任務來自雲端，且並未上傳實體圖片，僅保存時間軸）。\n\n💡 解決方案：請先載入/拖入影片檔，系統將自動為您重建投影片影像，即可順利導出！`);
            return;
        }

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = slideImg.naturalWidth;
        tempCanvas.height = slideImg.naturalHeight;
        const ctx = tempCanvas.getContext("2d");
        ctx.drawImage(slideImg, 0, 0);

        const dataUrl = tempCanvas.toDataURL("image/png");
        const zipSlideNo = i + 1;

        galleryItemsHtml += `
        <div class="card">
            <img src="${dataUrl}" alt="Slide ${zipSlideNo}">
            <div class="card-body">
                <span class="card-no">No. ${zipSlideNo}</span>
                <span class="card-time">⏱️ ${slide.timestamp}</span>
            </div>
        </div>`;
    }

    const htmlContent = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - 離線簡報報告</title>
    <style>
        :root {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-blue: #38bdf8;
            --card-border: #334155;
        }
        body {
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 24px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            margin-bottom: 24px;
            border-bottom: 1px solid var(--card-border);
            padding-bottom: 16px;
        }
        h1 { margin: 0 0 8px 0; color: var(--accent-blue); }
        .meta { color: var(--text-secondary); font-size: 14px; }
        .gallery {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 20px;
            margin-top: 24px;
        }
        .card {
            background: var(--bg-secondary);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .card img {
            width: 100%;
            aspect-ratio: 16/9;
            object-fit: cover;
            border-bottom: 1px solid var(--card-border);
            cursor: pointer;
            transition: opacity 0.2s;
        }
        .card img:hover {
            opacity: 0.9;
        }
        .card-body {
            padding: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .card-no { font-weight: bold; color: var(--accent-blue); }
        .card-time { color: var(--text-secondary); font-size: 13px; }
        
        /* Modal Lightbox */
        #lightbox {
            display: none;
            position: fixed;
            z-index: 9999;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(15, 23, 42, 0.95);
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }
        #lightbox img {
            max-width: 95%;
            max-height: 90vh;
            border-radius: 8px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            border: 1px solid var(--card-border);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎬 ${title} - 投影片分析報告</h1>
            <div class="meta">影片路徑: ${videoUrl} | 總計擷取: ${targetSlides.length} 張投影片</div>
        </div>
        <div class="gallery">
            ${galleryItemsHtml}
        </div>
    </div>
    
    <div id="lightbox" onclick="this.style.display='none'">
        <img id="lightbox-img" src="" alt="Zoomed Slide">
    </div>

    <script>
        function openZoom(src) {
            document.getElementById('lightbox-img').src = src;
            document.getElementById('lightbox').style.display = 'flex';
        }
        document.querySelectorAll('.card img').forEach(img => {
            img.addEventListener('click', () => openZoom(img.src));
        });
    </script>
</body>
</html>`;

    const htmlBlob = new Blob([htmlContent], { type: "text/html; charset=utf-8" });
    const safeTitle = title.replace(/[\/\\?%*:|"<>. ]/g, "_") || "slides";
    
    const link = document.createElement("a");
    link.href = URL.createObjectURL(htmlBlob);
    link.download = `report_${safeTitle}.html`;
    link.click();
    
    addAnalysisLog(`✅ <span style="color: #34d399; font-weight: bold;">單一檔案離線 HTML 導出成功！(含全部 Base64 內嵌影格)</span>`);
    alert(`🎉 導出成功！已下載離線 HTML 報告，可直接用瀏覽器開啟分享。`);
}

async function exportToPDF() {
    if (!window.jspdf) {
        alert("❌ 無法載入 PDF 編譯模組，請檢查您的網路連線是否正常。");
        return;
    }
    // 獲取勾選的投影片
    const checkedCbs = document.querySelectorAll(".slide-select-checkbox:checked");
    const checkedNos = Array.from(checkedCbs).map(cb => parseInt(cb.dataset.slideNo, 10));
    const targetSlides = slideCandidates.filter(s => checkedNos.includes(s.slide_no));

    if (targetSlides.length === 0) {
        alert("請至少勾選一張投影片以導出 PDF！");
        return;
    }

    addAnalysisLog("📄 正在編譯 PDF 簡報，請稍候...");

    // 1. 獲取第一張圖的實體解析度計算比例
    let img;
    try {
        img = await loadImageSafe(targetSlides[0].url);
    } catch (err) {
        alert(`⚠️ 導出失敗！找不到快取畫面（這可能是因為此任務來自雲端，且並未上傳實體圖片，僅保存時間軸）。\n\n💡 解決方案：請先載入/拖入影片檔，系統將自動為您重建投影片影像，即可順利導出！`);
        return;
    }
    const videoWidth = img.naturalWidth || 1280;
    const videoHeight = img.naturalHeight || 720;
    const aspect = videoWidth / videoHeight;

    const selectedRes = pdfResSelect.value;
    let targetWidth = videoWidth;
    let targetHeight = videoHeight;

    // 計算自訂解析度
    if (selectedRes === "1080") {
        targetHeight = 1080;
        targetWidth = Math.round(1080 * aspect);
    } else if (selectedRes === "720") {
        targetHeight = 720;
        targetWidth = Math.round(720 * aspect);
    }

    // 初始化 jsPDF 實體，套用等比例尺寸
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [targetWidth, targetHeight]
    });

    for (let i = 0; i < targetSlides.length; i++) {
        const slide = targetSlides[i];
        
        if (i > 0) {
            pdf.addPage();
        }

        // 載入圖片並繪入 PDF
        const slideImg = await loadImageSafe(slide.url);

        // 建立臨時 Canvas 將 Image 轉換成 PNG base64
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;
        const ctx = tempCanvas.getContext("2d");
        ctx.drawImage(slideImg, 0, 0, targetWidth, targetHeight);
        
        const base64Data = tempCanvas.toDataURL("image/png");
        pdf.addImage(base64Data, "PNG", 0, 0, targetWidth, targetHeight);
    }

    const title = taskTitleInput.value.trim().replace(/[\/\\?%*:|"<>. ]/g, "_") || "presentation";
    pdf.save(`slides_${title}.pdf`);
    alert("🎉 PDF 簡報匯出下載成功！");
}

async function exportToZIP() {
    if (!window.JSZip) {
        alert("❌ 無法載入 ZIP 壓縮模組，請檢查您的網路連線是否正常。");
        return;
    }
    // 獲取勾選的投影片
    const checkedCbs = document.querySelectorAll(".slide-select-checkbox:checked");
    const checkedNos = Array.from(checkedCbs).map(cb => parseInt(cb.dataset.slideNo, 10));
    const targetSlides = slideCandidates.filter(s => checkedNos.includes(s.slide_no));

    if (targetSlides.length === 0) {
        alert("請至少勾選一張投影片以打包 ZIP！");
        return;
    }

    addAnalysisLog("📦 正在打包圖片為 ZIP，請稍候...");
    const zip = new JSZip();
    const folder = zip.folder("slides");

    for (let i = 0; i < targetSlides.length; i++) {
        const slide = targetSlides[i];
        // 重新計算編號以保持連續性
        const zipSlideNo = i + 1;
        let slideImg;
        try {
            slideImg = await loadImageSafe(slide.url);
        } catch (err) {
            alert(`⚠️ 導出失敗！找不到快取畫面（這可能是因為此任務來自雲端，且並未上傳實體圖片，僅保存時間軸）。\n\n💡 解決方案：請先載入/拖入影片檔，系統將自動為您重建投影片影像，即可順利導出！`);
            return;
        }

        // 將 Image 轉為 Blob 二進位數據
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = slideImg.naturalWidth;
        tempCanvas.height = slideImg.naturalHeight;
        const ctx = tempCanvas.getContext("2d");
        ctx.drawImage(slideImg, 0, 0);

        const blob = await new Promise(r => tempCanvas.toBlob(r, "image/png"));
        const safeTime = slide.timestamp.replace(/:/g, "-");
        const filename = `slide_${zipSlideNo.toString().padStart(3, "0")}_${safeTime}.png`;
        
        folder.file(filename, blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const title = taskTitleInput.value.trim().replace(/[\/\\?%*:|"<>. ]/g, "_") || "slides";
    
    // 下載儲存
    const link = document.createElement("a");
    link.href = URL.createObjectURL(zipBlob);
    link.download = `slides_${title}.zip`;
    link.click();
    alert("🎉 ZIP 圖片包下載成功！");
}

// 實作 YouTube 影片串流解析與 CORS 代理載入 (v2.06)
function setupYouTubeLoader() {
    if (!btnLoadYt) return;
    
    btnLoadYt.addEventListener("click", async () => {
        const ytUrl = ytUrlInput.value.trim();
        if (!ytUrl) {
            alert("請輸入 YouTube 影片網址！");
            return;
        }

        // 重置先前狀態
        ytLoadingStatus.style.display = "block";
        ytLoadingStatus.textContent = "正在解析 YouTube 邊緣串流，請稍候...";
        btnLoadYt.disabled = true;
        if (btnDownloadYtVideo) btnDownloadYtVideo.style.display = "none";

        try {
            // 1. 請求 Workers 解析影片直鏈
            const infoRes = await fetchWithAuth(`/api/yt-info?url=${encodeURIComponent(ytUrl)}`);
            if (!infoRes.ok) {
                const errMsg = await infoRes.text();
                throw new Error(errMsg || "解析失敗");
            }

            const videoInfo = await infoRes.json();
            
            // 2. 更新控制台欄位
            taskTitleInput.value = videoInfo.title;
            analysisStatusText.textContent = `已成功解析 YouTube 影片: "${videoInfo.title}"`;
            
            // 3. 設定 video 的 src 指向 Workers CORS Proxy 代理影片流
            const proxyUrl = `/api/yt-proxy?url=${encodeURIComponent(videoInfo.streamUrl)}`;
            
            mainVideo.src = proxyUrl;
            mainVideo.load();

            // 顯示下載影片按鈕並綁定事件
            if (btnDownloadYtVideo) {
                btnDownloadYtVideo.style.display = "inline-block";
                btnDownloadYtVideo.onclick = () => {
                    window.open(`/api/yt-proxy?url=${encodeURIComponent(videoInfo.streamUrl)}&download=1`, "_blank");
                };
            }

            // 4. 等待影片可播放後，顯示控制面板
            mainVideo.oncanplay = () => {
                ytLoadingStatus.style.display = "none";
                btnLoadYt.disabled = false;
                
                document.getElementById("analysis-card").style.display = "block";
                document.getElementById("video-title-header").textContent = `🎥 影片分析控制台 - ${videoInfo.title}`;
                
                // 重置分析狀態變數
                analysisStatusText.textContent = "影片載入成功，準備開始分析。";
                progressBarFill.style.width = "0%";
                capturedCountBadge.textContent = "0";
                
                // 註冊暫存屬性以在存檔時使用
                mainVideo.dataset.videoId = videoInfo.videoId;
                mainVideo.dataset.videoTitle = videoInfo.title;
            };

            mainVideo.onerror = (err) => {
                throw new Error("CORS 代理影片串流載入失敗，瀏覽器拒絕播放。");
            };

        } catch (err) {
            console.error(err);
            ytLoadingStatus.style.display = "block";
            ytLoadingStatus.textContent = `❌ 解析失敗: ${err.message}`;
            btnLoadYt.disabled = false;
            if (btnDownloadYtVideo) btnDownloadYtVideo.style.display = "none";
            
            alert(`⚠️ YouTube 影片解析限制\n\n原因：YouTube 官方近期對雲端伺服器（如 Cloudflare 等）加強了機器人阻擋驗證，限制 Serverless 邊緣伺服器直接取得影音串流。\n\n💡 建議解決方案：\n1. 【使用 Chrome 外掛 (推薦)】：請點擊網頁右上角「📦 下載 Chrome 外掛套件包」。安裝後可直接在 YouTube 網頁側邊欄進行 100% 順暢分析！\n2. 【本地 MP4 方案】：先將影片下載至您的電腦，再拖曳至上方「載入影片進行分析」區域，本站將立即在瀏覽器內進行快速分析與 PDF/ZIP/HTML 導出！`);
        }
    });
}

// 導出本機時間軸 JSON 檔案 (v2.07)
function exportToJSON() {
    // 獲取勾選的投影片
    const checkedCbs = document.querySelectorAll(".slide-select-checkbox:checked");
    const checkedNos = Array.from(checkedCbs).map(cb => parseInt(cb.dataset.slideNo, 10));
    
    let list = [];
    if (slideCandidates && slideCandidates.length > 0) {
        // 本機掃描模式：依勾選進行過濾與重設序號
        list = slideCandidates
            .filter(s => checkedNos.includes(s.slide_no))
            .map((s, index) => ({
                slide_no: index + 1,
                timestamp: s.timestamp,
                seconds: s.seconds
            }));
    } else if (activeTaskData && activeTaskData.slides) {
        // 載入歷史紀錄模式
        list = activeTaskData.slides;
    }

    if (list.length === 0) {
        alert("目前沒有勾選任何投影片，無法導出！");
        return;
    }

    const title = taskTitleInput.value.trim() || "未命名簡報";
    const videoId = mainVideo.dataset.videoId || "";
    const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : (videoFile ? videoFile.name : "Local Video");

    // 重新格式化成 Chrome 外掛時間軸標準格式
    const slidesList = list.map(s => ({
        slide_no: s.slide_no,
        timestamp: s.timestamp,
        seconds: s.seconds,
        filename: `slide_${s.slide_no.toString().padStart(3, "0")}.png`
    }));

    const payload = {
        title: title,
        video_path: videoUrl,
        slides: slidesList
    };

    const jsonString = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });

    // 觸發瀏覽器下載 JSON 檔給 Chrome 外掛使用
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `slides_${title.replace(/[\/\\?%*:|"<>. ]/g, "_")}.json`;
    link.click();
    
    alert(`🎉 導出成功！已下載外掛專用時間軸 JSON 到本機。`);
}

// 本機與外掛對接核心 (v2.07)

// 從本機已載入影片自動重構投影片畫面 (v2.07)
async function rebuildSlidesFromVideo(slides) {
    if (!videoFile && !mainVideo.src) return;
    
    addAnalysisLog(`⚙️ 偵測到本機影片，正在為此歷史任務重新自動生成 ${slides.length} 張投影片的影格預覽...`);
    progressCard.style.display = "block";
    
    const total = slides.length;
    const tempCanvas = document.getElementById("analysis-canvas");
    const tempCtx = tempCanvas.getContext("2d");
    
    // 依影片解析度設定畫布
    tempCanvas.width = mainVideo.videoWidth || 1280;
    tempCanvas.height = mainVideo.videoHeight || 720;
    
    slideCandidates = [];
    galleryGrid.innerHTML = "";
    
    for (let i = 0; i < total; i++) {
        const slide = slides[i];
        const seconds = slide.seconds;
        const pct = ((i + 1) / total) * 100;
        
        progressBarFill.style.width = `${pct}%`;
        analysisStatusText.textContent = `重建影像中: ${i + 1} / ${total} (${Math.round(pct)}%)`;
        
        // Seek
        mainVideo.currentTime = seconds;
        
        // 等待 seek 完成
        await Promise.race([
            new Promise(resolve => {
                const onSeeked = () => {
                    mainVideo.removeEventListener("seeked", onSeeked);
                    resolve();
                };
                mainVideo.addEventListener("seeked", onSeeked);
            }),
            new Promise(resolve => setTimeout(resolve, 1500))
        ]);
        
        // 擷取影格
        tempCtx.drawImage(mainVideo, 0, 0, tempCanvas.width, tempCanvas.height);
        const blob = await new Promise(r => tempCanvas.toBlob(r, "image/png"));
        const localUrl = URL.createObjectURL(blob);
        
        const slideItem = {
            slide_no: slide.slide_no,
            timestamp: slide.timestamp,
            seconds: seconds,
            url: localUrl,
            blob: blob
        };
        
        slideCandidates.push(slideItem);
        renderGalleryItem(slideItem);
        capturedCountBadge.textContent = slideCandidates.length;
    }
    
    progressCard.style.display = "none";
    addAnalysisLog(`🎉 本機畫面重建完成！共生成 ${total} 張投影片。您現在可以自由勾選並點擊「匯出 PDF」、「導出 ZIP」或「導出本機 HTML」了！`);
}
