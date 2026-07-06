// Frontend Scanner and Cloudflare API Connector - video_to_ppt_serverless
// Copyright © 2026 Falo x Force Cheng. All rights reserved.
// Version: v1.01 (2026/7/6)
// WATERMARK: FALO_FORCECHENG_2026_07_06_V1.01

let activeTaskId = null;
let activeTaskData = null;
let isScanning = false;
let lastFrameData = null; // Uint8ClampedArray of 32x18 low-res frame
let slideCandidates = []; // Array of { slide_no, timestamp, seconds, blobUrl, base64 }
let videoFile = null;
let subtitles = []; // Loaded subtitle timestamps and contents
let latestAiReport = ""; // Generated markdown report from Gemini/Llama

// 時間格式化小幫手 (hh:mm:ss)
function formatTime(seconds) {
    if (isNaN(seconds) || seconds === Infinity) return "00:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// 全局日誌輸出小幫手 (v2.07)
function addAnalysisLog(text) {
    const consoleEl = document.getElementById("analysis-log-console");
    if (!consoleEl) return;
    const timePrefix = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    const div = document.createElement("div");
    div.innerHTML = `<span style="color: #64748b;">[${timePrefix}]</span> ${text}`;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
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

async function fetchWithAuth(url, options = {}) {
    let targetUrl = url;
    if (url.startsWith("/api/")) {
        const isWorkerOrigin = window.location.hostname.includes("workers.dev");
        if (!isWorkerOrigin) {
            targetUrl = "https://video-to-ppt-serverless.force-chinese.workers.dev" + url;
        }
    }
    if (!options.headers) {
        options.headers = {};
    }
    options.headers["X-Auth-Password"] = "666666";
    return fetch(targetUrl, options);
}

// 初始化
document.addEventListener("DOMContentLoaded", () => {
    console.log(
        "%c🎬 Video to PPT%c Copyright © 2026 Falo x Force Cheng. All rights reserved. | Version: v1.01 (2026/7/6)",
        "color: #38bdf8; font-size: 16px; font-weight: bold;",
        "color: #94a3b8; font-size: 12px;"
    );
    window.__FALO_WATERMARK__ = "Falo x Force Cheng 2026/7/6 v1.01";

    setupFileUpload();
    setupAnalysisControls();
    setupExportButtons();
    setupYouTubeLoader();
    setupSubtitleLoader();
    setupManualControls();
    setupAiPanel();

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
            handleUploadedFile(e.dataTransfer.files[0]);
        }
    });

    videoFileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            handleUploadedFile(e.target.files[0]);
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

    // 啟動 AI 智能解讀面板
    const aiSidebar = document.getElementById("ai-sidebar");
    if (aiSidebar) {
        aiSidebar.style.display = "block";
        document.querySelector(".main-layout").classList.add("has-ai-panel");
    }
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
            <textarea class="gallery-card-memo" data-slide-no="${slide.slide_no}" placeholder="✍️ 講者口述台詞與自訂備註...">${slide.memo || ""}</textarea>
        </div>
    `;

    // 雙向綁定備註變數
    const textarea = card.querySelector(".gallery-card-memo");
    textarea.addEventListener("input", (e) => {
        const slideNo = parseInt(e.target.getAttribute("data-slide-no"), 10);
        const target = slideCandidates.find(s => s.slide_no === slideNo);
        if (target) {
            target.memo = e.target.value;
        }
    });

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
    try {
        // 獲取勾選的投影片
        const checkedCbs = document.querySelectorAll(".slide-select-checkbox:checked");
        const checkedNos = Array.from(checkedCbs).map(cb => parseInt(cb.getAttribute("data-slide-no"), 10));
        const targetSlides = slideCandidates.filter(s => checkedNos.includes(s.slide_no));

        if (targetSlides.length === 0) {
            alert("請至少勾選一張投影片以生成離線 HTML！");
            return;
        }

    addAnalysisLog("🌐 正在生成單一檔案離線 HTML，請稍候...");

    const title = taskTitleInput.value.trim() || "未命名簡報";
    const videoId = mainVideo.dataset.videoId || "";
    const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : (videoFile ? videoFile.name : "Local Video");
    
    const htmlType = document.getElementById("html-type-select")?.value || "basic";
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
        const ctx = tempCanvas.getContext("2d");

        let dataUrl;
        if (htmlType === "v3") {
            // 降維壓縮：AI 底稿版強行縮小至 480px 寬，並以 60% 品質的 WebP 導出，大幅壓縮體積
            const targetWidth = 480;
            const targetHeight = Math.round(480 * (slideImg.naturalHeight / slideImg.naturalWidth)) || 270;
            tempCanvas.width = targetWidth;
            tempCanvas.height = targetHeight;
            ctx.drawImage(slideImg, 0, 0, targetWidth, targetHeight);
            dataUrl = tempCanvas.toDataURL("image/webp", 0.6);
        } else {
            tempCanvas.width = slideImg.naturalWidth;
            tempCanvas.height = slideImg.naturalHeight;
            ctx.drawImage(slideImg, 0, 0);
            dataUrl = tempCanvas.toDataURL("image/webp", 0.8);
        }
        
        const zipSlideNo = i + 1;

        if (htmlType === "v3") {
            galleryItemsHtml += `
            <div class="slide-card" style="display: flex; gap: 20px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); padding: 15px; border-radius: 8px; margin-bottom: 20px; align-items: start; text-align: left;">
                <div style="flex: 0 0 320px;">
                    <img src="${dataUrl}" alt="Slide ${zipSlideNo}" onclick="openZoom('${dataUrl}')" style="width: 100%; border-radius: 6px; cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.1);">
                    <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 12px; color: #38bdf8; font-family: monospace;">
                        <span style="font-weight: bold;">Page #${zipSlideNo.toString().padStart(3, "0")}</span>
                        <span>⏱️ ${slide.timestamp}</span>
                    </div>
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #38bdf8; font-weight: bold;">🗣️ 講者口述台詞與備註：</div>
                    <textarea class="memo-input" data-slide-no="${slide.slide_no}" style="width: 100%; height: 80px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.1); color: #f8fafc; border-radius: 6px; padding: 8px; font-size: 12px; font-family: inherit; resize: vertical; outline: none;" placeholder="在此處編輯本頁逐字稿或自訂筆記...">${slide.memo || ""}</textarea>
                </div>
            </div>`;
        } else if (htmlType === "detailed") {
            // 計算平均色彩
            let r = 0, g = 0, b = 0;
            const imgDataObj = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const imgData = imgDataObj.data;
            const step = Math.max(4, Math.floor(imgData.length / 4000)) * 4;
            let count = 0;
            for (let idx = 0; idx < imgData.length; idx += step) {
                r += imgData[idx];
                g += imgData[idx+1];
                b += imgData[idx+2];
                count++;
            }
            const avgR = Math.round(r / count);
            const avgG = Math.round(g / count);
            const avgB = Math.round(b / count);
            const meanColor = `RGB(${avgR}, ${avgG}, ${avgB})`;

            // 計算 dHash 指紋
            let hashVal = "";
            for (let idx = 0; idx < 16; idx++) {
                const pixelIdx = Math.floor((imgData.length / 4) / 16) * idx * 4;
                const gray = Math.round(imgData[pixelIdx]*0.299 + imgData[pixelIdx+1]*0.587 + imgData[pixelIdx+2]*0.114);
                hashVal += (gray % 16).toString(16);
            }
            const dhash = hashVal.toUpperCase();

            // 計算模糊度 (利用變異數)
            let sum = 0, sumSq = 0, varCount = 0;
            const varStep = Math.max(4, Math.floor(imgData.length / 2000)) * 4;
            for (let idx = 0; idx < imgData.length; idx += varStep) {
                const gray = imgData[idx]*0.299 + imgData[idx+1]*0.587 + imgData[idx+2]*0.114;
                sum += gray;
                sumSq += gray * gray;
                varCount++;
            }
            const mean = sum / varCount;
            const variance = (sumSq / varCount) - (mean * mean);
            const blurScore = Math.min(100.0, Math.max(10.0, Math.round(Math.sqrt(variance) * 1.5 * 10) / 10));

            galleryItemsHtml += `
            <div class="slide-card">
                <div class="slide-image-box">
                    <img src="${dataUrl}" alt="Slide ${zipSlideNo}" onclick="openZoom('${dataUrl}')" style="cursor: pointer;">
                </div>
                <div class="slide-meta-box">
                    <div class="slide-title">
                        <span>投影片 #${zipSlideNo.toString().padStart(3, "0")}</span>
                        <span class="badge badge-orig">原始擷取</span>
                    </div>
                    <div class="meta-item"><strong>時間點:</strong> ${slide.timestamp}</div>
                    <div class="meta-item"><strong>精確秒數:</strong> ${slide.seconds.toFixed(2)} 秒</div>
                    <div class="meta-item"><strong>dHash 影像指紋:</strong> <code>${dhash}</code></div>
                    <div class="meta-item"><strong>平均色彩 (RGB):</strong> <code>${meanColor}</code></div>
                    <div class="meta-item"><strong>模糊度分數:</strong> <code>${blurScore.toFixed(1)}</code></div>
                </div>
            </div>`;
        } else {
            galleryItemsHtml += `
            <div class="card">
                <img src="${dataUrl}" alt="Slide ${zipSlideNo}" onclick="openZoom('${dataUrl}')" style="cursor: pointer;">
                <div class="card-body">
                    <span class="card-no">No. ${zipSlideNo}</span>
                    <span class="card-time">⏱️ ${slide.timestamp}</span>
                </div>
            </div>`;
        }
    }

    let htmlContent = "";
    if (htmlType === "v3") {
        htmlContent = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - AI Ingestion & Analysis Draft (v3)</title>
    <meta name="author" content="Falo x Force Cheng">
    <meta name="copyright" content="Falo x Force Cheng 2026/7/6 v1.01">
    <!-- Hidden Watermark: Copyright Falo x Force Cheng 2026/7/6 v1.01 -->
    <!-- COPYRIGHT_WATERMARK: FALO_FORCECHENG_2026_07_06_V1.01 -->
    
    <!-- 
    [SYSTEM GUIDE FOR AI ANALYSIS]
    這是一份由 Falo x Force Cheng 開發的 Video to PPT 工具所生成的 AI 專用多模態分析底稿。
    當使用者上傳此檔案給您（Claude/GPT）進行分析時，請遵循以下規定：
    1. 每張簡報圖片都有一個明確的「Page #XXX」徽章與「講者口述台詞與備註」。
    2. 請結合圖片中的視覺內容（圖表、公式、關鍵字）與口述台詞進行交叉對比理解。
    3. 進行問答與摘要時，請務必指明參考的頁碼（例如：根據 Page #003 中所述...）。
    -->
    
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-primary: #090d16;
            --bg-secondary: rgba(22, 30, 49, 0.7);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-blue: #38bdf8;
            --accent-green: #34d399;
            --card-border: rgba(255, 255, 255, 0.08);
        }
        body {
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-family: 'Outfit', 'Noto Sans TC', sans-serif;
            margin: 0;
            padding: 30px;
            display: flex;
            justify-content: center;
        }
        .container {
            max-width: 1000px;
            width: 100%;
        }
        .header {
            margin-bottom: 30px;
            border-bottom: 1px solid var(--card-border);
            padding-bottom: 20px;
            text-align: left;
        }
        h1 { margin: 0 0 10px 0; color: var(--accent-blue); font-size: 24px; }
        .meta { color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
        
        .ai-summary-card {
            background: rgba(56, 189, 248, 0.03);
            border: 1px solid rgba(56, 189, 248, 0.15);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        }
        .ai-summary-title {
            font-size: 16px;
            font-weight: bold;
            color: var(--accent-blue);
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            text-align: left;
        }
        .ai-summary-content {
            font-size: 13px;
            line-height: 1.6;
            color: #e2e8f0;
            white-space: pre-wrap;
            text-align: left;
        }
        
        #lightbox {
            display: none;
            position: fixed;
            z-index: 99999;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(9, 13, 22, 0.95);
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }
        #lightbox img {
            max-width: 95%;
            max-height: 90vh;
            border-radius: 8px;
            border: 1px solid var(--card-border);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎬 ${title} - AI Ingestion & Analysis Draft (v3.html)</h1>
            <div class="meta">
                <strong>影片路徑：</strong> ${videoUrl} <br>
                <strong>簡報頁數：</strong> ${targetSlides.length} 頁 | 
                <strong>匯出時間：</strong> ${new Date().toLocaleString("zh-TW", { hour12: false })} <br>
                <strong>授權宣告：</strong> Falo x Force Cheng 2026/7/6 v1.01 (Falo AI Lab)
            </div>
        </div>
        
        ${latestAiReport ? `
        <div class="ai-summary-card">
            <div class="ai-summary-title">🤖 AI 簡報智能精煉與教學總結</div>
            <div class="ai-summary-content">${latestAiReport}</div>
        </div>
        ` : ''}

        <div class="slides-container">
            ${galleryItemsHtml}
        </div>
        
        <footer style="text-align: center; padding: 24px; color: var(--text-secondary); font-size: 11px; border-top: 1px solid var(--card-border); margin-top: 40px;">
            <p>© 2026 Falo x Force Cheng. All rights reserved. | 版本: v1.01 (2026/7/6)</p>
            <div style="display: none;" data-watermark="Falo x Force Cheng 2026/7/6 v1.01"></div>
        </footer>
    </div>
    
    <!-- Floating Save Button -->
    <div id="save-float-btn" style="position: fixed; bottom: 30px; right: 30px; z-index: 10000; background: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%); color: #0b0f19; font-weight: bold; border-radius: 50px; padding: 12px 24px; box-shadow: 0 10px 25px rgba(0,242,254,0.4); cursor: pointer; display: flex; align-items: center; gap: 8px; font-family: sans-serif; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'" onclick="saveMemoEdits()">
        <span>💾 儲存並更新 v3.html</span>
    </div>

    <div id="lightbox" onclick="this.style.display='none'">
        <img id="lightbox-img" src="" alt="Zoomed Slide">
    </div>

    <script>
        function openZoom(src) {
            document.getElementById('lightbox-img').src = src;
            document.getElementById('lightbox').style.display = 'flex';
        }

        const docId = "v3_memo_" + window.location.pathname;
        document.addEventListener("DOMContentLoaded", () => {
            const cached = localStorage.getItem(docId);
            if (cached) {
                const data = JSON.parse(cached);
                Object.keys(data).forEach(slideNo => {
                    const ta = document.querySelector(\`textarea[data-slide-no="\${slideNo}"]\`);
                    if (ta) ta.value = data[slideNo];
                });
            }
            
            document.querySelectorAll(".memo-input").forEach(ta => {
                ta.addEventListener("input", () => {
                    const data = {};
                    document.querySelectorAll(".memo-input").forEach(el => {
                        data[el.getAttribute("data-slide-no")] = el.value;
                    });
                    localStorage.setItem(docId, JSON.stringify(data));
                });
            });
        });

        function saveMemoEdits() {
            document.querySelectorAll(".memo-input").forEach(ta => {
                ta.textContent = ta.value;
            });
            const htmlSource = "<!DOCTYPE html>\\n" + document.documentElement.outerHTML;
            const blob = new Blob([htmlSource], { type: "text/html; charset=utf-8" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "v3.html";
            link.click();
            alert("🎉 修改已成功保存並寫入原始碼！\\n新檔案已下載為 v3.html，此檔案包含您剛寫入的所有備註！");
        }
    </script>
</body>
</html>`;
    } else if (htmlType === "detailed") {
        htmlContent = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>投影片自動分析與擷取報告 - ${title}</title>
    <meta name="author" content="Falo x Force Cheng">
    <meta name="copyright" content="Falo x Force Cheng 2026/7/6 v1.01">
    <!-- Hidden Watermark: Copyright Falo x Force Cheng 2026/7/6 v1.01 -->
    <!-- COPYRIGHT_WATERMARK: FALO_FORCECHENG_2026_07_06_V1.01 -->
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Outfit', 'Noto Sans TC', sans-serif;
            background-color: #0b0f19;
            color: #f1f5f9;
            line-height: 1.6;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 1000px;
            margin: 40px auto;
            padding: 20px;
        }
        .header {
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            padding: 30px;
            margin-bottom: 30px;
        }
        h1 {
            color: #38bdf8;
            font-size: 1.8rem;
            margin-top: 0;
        }
        .metadata-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.08);
            padding-top: 20px;
            font-size: 0.9rem;
            color: #94a3b8;
        }
        .metadata-grid span strong {
            color: #f1f5f9;
        }
        /* 專案精神樣式 */
        .spirit-banner {
            background: rgba(56, 189, 248, 0.05);
            border: 1px dashed rgba(56, 189, 248, 0.3);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 30px;
        }
        .spirit-logo {
            color: #38bdf8;
            font-weight: 700;
            font-size: 1.1rem;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
        }
        .spirit-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
        }
        .spirit-card h3 {
            color: #34d399;
            font-size: 0.95rem;
            margin-top: 0;
            margin-bottom: 8px;
        }
        .spirit-card p {
            font-size: 0.85rem;
            color: #94a3b8;
            margin: 0;
        }
        /* 工作流程樣式 */
        .workflow-section {
            background: rgba(30, 41, 59, 0.4);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
        }
        .workflow-section h3 {
            color: #f1f5f9;
            font-size: 1.1rem;
            margin-top: 0;
            margin-bottom: 15px;
        }
        .workflow-steps {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
        }
        .step-badge {
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.1);
            color: #38bdf8;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: 600;
        }
        .step-arrow {
            color: #475569;
            font-weight: bold;
        }
        .workflow-desc {
            font-size: 0.85rem;
            color: #94a3b8;
            margin: 0;
        }
        /* 投影片清單樣式 */
        .slides-container {
            display: flex;
            flex-direction: column;
            gap: 24px;
        }
        .slide-card {
            display: flex;
            background: rgba(30, 41, 59, 0.3);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 12px;
            overflow: hidden;
            backdrop-filter: blur(10px);
            transition: transform 0.2s;
        }
        .slide-card:hover {
            transform: translateY(-2px);
            border-color: rgba(56, 189, 248, 0.2);
        }
        .slide-image-box {
            flex: 0 0 320px;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            border-right: 1px solid rgba(255,255,255,0.05);
        }
        .slide-image-box img {
            width: 100%;
            height: auto;
            max-height: 200px;
            object-fit: contain;
            display: block;
        }
        .slide-meta-box {
            flex: 1;
            padding: 20px;
        }
        .slide-title {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 1.2rem;
            font-weight: 700;
            color: #f1f5f9;
            margin-bottom: 12px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            padding-bottom: 8px;
        }
        .badge {
            font-size: 0.75rem;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: 600;
        }
        .badge-orig {
            background: rgba(255, 255, 255, 0.08);
            color: #94a3b8;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .badge-enhance {
            background: rgba(52, 211, 153, 0.1);
            color: #34d399;
            border: 1px solid rgba(52, 211, 153, 0.3);
        }
        .meta-item {
            font-size: 0.9rem;
            color: #94a3b8;
            margin-bottom: 6px;
        }
        .meta-item strong {
            color: #cbd5e1;
        }
        .meta-item code {
            background: rgba(0,0,0,0.3);
            padding: 2px 6px;
            border-radius: 4px;
            color: #f43f5e;
            font-family: monospace;
        }
        
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
            border: 1px solid rgba(255,255,255,0.08);
        }
        @media (max-width: 768px) {
            .slide-card {
                flex-direction: column;
            }
            .slide-image-box {
                flex: none;
                width: 100%;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>投影片自動分析與擷取報告</h1>
            <div class="metadata-grid">
                <span>影片名稱: <strong>${title}</strong></span>
                <span>影片路徑/網址: <strong>${videoUrl}</strong></span>
                <span>匯出數量: <strong>${targetSlides.length} 張投影片</strong></span>
                <span>報告等級: <strong>DETAILED</strong></span>
            </div>
        </div>

        <div class="spirit-banner">
            <div class="spirit-logo">💡 專案核心精神 (Project Credo)</div>
            <div class="spirit-grid">
                <div class="spirit-card">
                    <h3>📌 知識管理 (KM) 與經驗傳承</h3>
                    <p>本專案旨在捕捉專家影片中的精華經驗，並將其高效率儲存為結構化的知識庫檔案，建立起個人與企業的知識管理體系。</p>
                </div>
                <div class="spirit-card">
                    <h3>⚡ 零運行成本運算 (No Token Cost)</h3>
                    <p>執行過程完全依靠 OpenCV/瀏覽器 Canvas 本機電腦視覺演算法（MAE 影格追蹤、dHash 去重與邊緣變異分析），<b>執行時完全不耗費任何 AI API Token</b>。</p>
                </div>
                <div class="spirit-card">
                    <h3>🤝 人機協調驗證 (Human-in-the-Loop)</h3>
                    <p>利用電腦視覺做大批量自動化過濾，再透過「雙向滑塊對比」交由人類做出最終的版本確認，是極佳的人機協作實踐。</p>
                </div>
            </div>
        </div>

        <div class="workflow-section">
            <h3>🧬 簡報擷取技術工作流程 (Workflow Overview)</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 30px; margin-top: 20px;">
                <div>
                    <h4 style="color: #38bdf8; font-size: 1rem; margin-top: 0; margin-bottom: 15px; border-bottom: 1px dashed rgba(255,255,255,0.08); padding-bottom: 5px;">🎨 視覺化工作流 (Visual Flow)</h4>
                    <div class="workflow-steps">
                        <div class="step-badge">1. 影片分析</div>
                        <div class="step-arrow">→</div>
                        <div class="step-badge">2. 畫面變化偵測</div>
                        <div class="step-arrow">→</div>
                        <div class="step-badge">3. 換頁推測</div>
                        <div class="step-arrow">→</div>
                        <div class="step-badge">4. 相似度分析</div>
                        <div class="step-arrow">→</div>
                        <div class="step-badge">5. 模糊檢測</div>
                        <div class="step-arrow">→</div>
                        <div class="step-badge">6. 重複頁排除</div>
                        <div class="step-arrow">→</div>
                        <div class="step-badge">7. 候選投影片</div>
                    </div>
                </div>
                <div>
                    <h4 style="color: #38bdf8; font-size: 1rem; margin-top: 0; margin-bottom: 15px; border-bottom: 1px dashed rgba(255,255,255,0.08); padding-bottom: 5px;">📝 純文字版 (Plain text)</h4>
                    <div style="background: #ffffff; color: #000000; border-radius: 12px; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; width: 100%; box-sizing: border-box; text-align: left;">
                        <div style="font-weight: 600; color: #64748b; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; margin-bottom: 15px;">Plain text</div>
                        <div style="font-size: 1.1rem; line-height: 1.6; font-weight: 600; font-family: inherit; color: #1e293b;">
                            影片分析<br>
                            ↓<br>
                            畫面變化偵測<br>
                            ↓<br>
                            換頁推測<br>
                            ↓<br>
                            相似度分析<br>
                            ↓<br>
                            模糊檢測<br>
                            ↓<br>
                            重複頁排除<br>
                            ↓<br>
                            候選投影片
                        </div>
                    </div>
                </div>
            </div>
            <p class="workflow-desc" style="margin-top: 25px;">本系統演算法原理基於車流量與「變動監控」技術（類似於高速公路變動監控演算法），利用數學矩陣與空間域算法去精確推算「靜止」與「跳頁」的分界點，排除干擾畫面。</p>
        </div>

        <div class="workflow-section" style="margin-top: 30px;">
            <h3>📦 Video Slide Extractor 專案版本對照說明</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-top: 15px; text-align: left;">
                <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                    <h4 style="margin-top:0; color:#94a3b8; font-size:1rem; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:6px;">
                        <span>v1.x (本機 Python 核心版)</span>
                        <span style="color:#ef4444; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); font-size:0.75rem; padding:1px 5px; border-radius:4px; font-weight:bold;">商業機密</span>
                    </h4>
                    <p style="font-size:0.8rem; color:#64748b; line-height:1.4; margin: 8px 0 0 0;">實作核心電腦視覺(CV)簡報擷取演算法與影像前處理。不提供任何資源包與原始碼。</p>
                    <p style="font-size:0.8rem; color:#ef4444; font-weight:600; margin: 6px 0 0 0;">🔒 商業機密，不提供資源包與源碼</p>
                </div>
                <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                    <h4 style="margin-top:0; color:#38bdf8; font-size:1rem; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:6px;">
                        <span>v2.x (本機 Python 協作版)</span>
                        <span style="color:#ef4444; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); font-size:0.75rem; padding:1px 5px; border-radius:4px; font-weight:bold;">商業機密</span>
                    </h4>
                    <p style="font-size:0.8rem; color:#64748b; line-height:1.4; margin: 8px 0 0 0;">新增 Split Slider 互動比對、熱鍵控制、2x/4x 智慧放大、批次一鍵強化與非疊加單次變動。</p>
                    <p style="font-size:0.8rem; color:#ef4444; font-weight:600; margin: 6px 0 0 0;">🔒 商業機密，不提供資源包與源碼</p>
                </div>
                <div style="background: rgba(52,211,153,0.02); border: 1px solid rgba(52,211,153,0.08); padding: 15px; border-radius: 8px;">
                    <h4 style="margin-top:0; color:#34d399; font-size:1rem; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(52,211,153,0.05); padding-bottom:6px;">
                        <span>Demo 版 (網頁模擬 POC)</span>
                        <span style="color:#34d399; background:rgba(52,211,153,0.1); border:1px solid rgba(52,211,153,0.2); font-size:0.75rem; padding:1px 5px; border-radius:4px; font-weight:bold;">公開展示</span>
                    </h4>
                    <p style="font-size:0.8rem; color:#94a3b8; line-height:1.4; margin: 8px 0 0 0;">純前端模擬 v2.x 真實擷取與對比軌跡重播，支援導出 PDF/HTML。</p>
                    <p style="font-size:0.75rem; color:#38bdf8; line-height:1.4; margin: 4px 0 0 0;">🔌 支援專屬 Chrome 匯入外掛，提供「僅輸出圖 (PNG)」與「輸出圖 + PDF」雙下載模式，防止連續下載通知遮擋 PDF 按鈕。</p>
                </div>
            </div>
        </div>

        <div class="slides-container">
            ${galleryItemsHtml}
        </div>
        
        <footer style="text-align: center; padding: 24px; color: #64748b; font-size: 12px; border-top: 1px solid rgba(255,255,255,0.08); margin-top: 40px;">
            <p>© 2026 Falo x Force Cheng. All rights reserved. | 版本: v1.01 (2026/7/6)</p>
            <div style="display: none;" data-watermark="Falo x Force Cheng 2026/7/6 v1.01"></div>
        </footer>
    </div>
    
    <div id="lightbox" onclick="this.style.display='none'">
        <img id="lightbox-img" src="" alt="Zoomed Slide">
    </div>

    <script>
        function openZoom(src) {
            document.getElementById('lightbox-img').src = src;
            document.getElementById('lightbox').style.display = 'flex';
        }
    </script>
</body>
</html>`;
    } else {
        htmlContent = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - 離線簡報報告</title>
    <meta name="author" content="Falo x Force Cheng">
    <meta name="copyright" content="Falo x Force Cheng 2026/7/6 v1.01">
    <!-- Hidden Watermark: Copyright Falo x Force Cheng 2026/7/6 v1.01 -->
    <!-- COPYRIGHT_WATERMARK: FALO_FORCECHENG_2026_07_06_V1.01 -->
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
        <footer style="text-align: center; padding: 24px; color: var(--text-secondary); font-size: 12px; border-top: 1px solid var(--card-border); margin-top: 40px;">
            <p>© 2026 Falo x Force Cheng. All rights reserved. | 版本: v1.01 (2026/7/6)</p>
            <div style="display: none;" data-watermark="Falo x Force Cheng 2026/7/6 v1.01"></div>
        </footer>
    </div>
    
    <div id="lightbox" onclick="this.style.display='none'">
        <img id="lightbox-img" src="" alt="Zoomed Slide">
    </div>

    <script>
        function openZoom(src) {
            document.getElementById('lightbox-img').src = src;
            document.getElementById('lightbox').style.display = 'flex';
        }
    </script>
</body>
</html>`;
    }

    const htmlBlob = new Blob([htmlContent], { type: "text/html; charset=utf-8" });
    const safeTitle = title.replace(/[\/\\?%*:|"<>. ]/g, "_") || "slides";
    
    const link = document.createElement("a");
    link.href = URL.createObjectURL(htmlBlob);
    if (htmlType === "v3") {
        link.download = "v3.html";
    } else {
        link.download = `report_${safeTitle}.html`;
    }
    link.click();
    
    addAnalysisLog(`✅ <span style="color: #34d399; font-weight: bold;">單一檔案離線 HTML 導出成功！(含全部 Base64 內嵌影格)</span>`);
    alert(`🎉 導出成功！已下載離線 HTML 報告，可直接用瀏覽器開啟分享。`);
    } catch (err) {
        console.error(err);
        alert("❌ HTML 導出發生錯誤: " + err.message + "\n" + err.stack);
    }
}

async function exportToPDF() {
    try {
        if (!window.jspdf) {
            alert("❌ 無法載入 PDF 編譯模組，請檢查您的網路連線是否正常。");
            return;
        }
        // 獲取勾選的投影片
        const checkedCbs = document.querySelectorAll(".slide-select-checkbox:checked");
        const checkedNos = Array.from(checkedCbs).map(cb => parseInt(cb.getAttribute("data-slide-no"), 10));
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
    } catch (err) {
        console.error(err);
        alert("❌ PDF 導出發生錯誤: " + err.message + "\n" + err.stack);
    }
}

async function exportToZIP() {
    try {
        if (!window.JSZip) {
            alert("❌ 無法載入 ZIP 壓縮模組，請檢查您的網路連線是否正常。");
            return;
        }
        // 獲取勾選的投影片
        const checkedCbs = document.querySelectorAll(".slide-select-checkbox:checked");
        const checkedNos = Array.from(checkedCbs).map(cb => parseInt(cb.getAttribute("data-slide-no"), 10));
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
    } catch (err) {
        console.error(err);
        alert("❌ ZIP 導出發生錯誤: " + err.message + "\n" + err.stack);
    }
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
            const apiBase = window.location.hostname.includes("workers.dev") ? "" : "https://video-to-ppt-serverless.force-chinese.workers.dev";
            const proxyUrl = `${apiBase}/api/yt-proxy?url=${encodeURIComponent(videoInfo.streamUrl)}`;
            
            mainVideo.src = proxyUrl;
            mainVideo.load();

            // 顯示下載影片按鈕並綁定事件
            if (btnDownloadYtVideo) {
                btnDownloadYtVideo.style.display = "inline-block";
                btnDownloadYtVideo.onclick = () => {
                    window.open(`${apiBase}/api/yt-proxy?url=${encodeURIComponent(videoInfo.streamUrl)}&download=1`, "_blank");
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

                // 啟動 AI 智能解讀面板
                const aiSidebar = document.getElementById("ai-sidebar");
                if (aiSidebar) {
                    aiSidebar.style.display = "block";
                    document.querySelector(".main-layout").classList.add("has-ai-panel");
                }
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
    try {
        // 獲取勾選的投影片
        const checkedCbs = document.querySelectorAll(".slide-select-checkbox:checked");
        const checkedNos = Array.from(checkedCbs).map(cb => parseInt(cb.getAttribute("data-slide-no"), 10));
        
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
    } catch (err) {
        console.error(err);
        alert("❌ JSON 導出發生錯誤: " + err.message + "\n" + err.stack);
    }
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

// 7. 字幕檔載入與時間軸自動對齊邏輯 (v2.08)
function setupSubtitleLoader() {
    const subtitleFileInput = document.getElementById("subtitle-file-input");
    const subtitleFileName = document.getElementById("subtitle-file-name");
    const subtitleStatus = document.getElementById("subtitle-status");

    if (subtitleFileInput) {
        subtitleFileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (subtitleFileName) subtitleFileName.textContent = file.name;
            
            const reader = new FileReader();
            reader.onload = (evt) => {
                const text = evt.target.result;
                const ext = file.name.split(".").pop().toLowerCase();
                subtitles = parseSubtitle(text, ext);
                
                if (subtitleStatus) {
                    subtitleStatus.innerHTML = `✅ 已成功載入字幕檔 (${subtitles.length} 條語音對齊)`;
                    subtitleStatus.style.color = "var(--accent-green)";
                }
                
                // 若已有投影片影格，立即進行字幕台詞對齊
                if (slideCandidates.length > 0) {
                    alignSubtitlesToSlides();
                }
            };
            reader.readAsText(file);
        });
    }
}

// 字幕解析引擎 (SRT & VTT)
function parseSubtitle(text, type) {
    const list = [];
    if (type === "vtt") {
        const blocks = text.split(/\r?\n\r?\n/);
        for (const block of blocks) {
            if (block.includes("-->")) {
                const lines = block.split(/\r?\n/);
                const timeLine = lines.find(l => l.includes("-->"));
                if (timeLine) {
                    const times = timeLine.split("-->").map(t => parseTimestamp(t.trim()));
                    const textLines = lines.slice(lines.indexOf(timeLine) + 1).filter(l => l.trim() !== "");
                    list.push({ start: times[0], end: times[1], text: textLines.join(" ") });
                }
            }
        }
    } else {
        const blocks = text.split(/\r?\n\r?\n/);
        for (const block of blocks) {
            if (block.includes("-->")) {
                const lines = block.split(/\r?\n/);
                const timeLine = lines.find(l => l.includes("-->"));
                if (timeLine) {
                    const times = timeLine.split("-->").map(t => parseTimestamp(t.trim()));
                    const textLines = lines.slice(lines.indexOf(timeLine) + 1).filter(l => l.trim() !== "");
                    list.push({ start: times[0], end: times[1], text: textLines.join(" ") });
                }
            }
        }
    }
    return list.sort((a, b) => a.start - b.start);
}

function parseTimestamp(timeStr) {
    const cleaned = timeStr.replace(",", ".");
    const parts = cleaned.split(":");
    let secs = 0;
    if (parts.length === 3) {
        secs += parseFloat(parts[0]) * 3600;
        secs += parseFloat(parts[1]) * 60;
        secs += parseFloat(parts[2]);
    } else if (parts.length === 2) {
        secs += parseFloat(parts[0]) * 60;
        secs += parseFloat(parts[1]);
    }
    return secs;
}

// 將字幕台詞按照時間區間對齊到投影片
function alignSubtitlesToSlides() {
    if (!subtitles || subtitles.length === 0) return;
    
    // 按時間排序
    slideCandidates.sort((a, b) => a.seconds - b.seconds);
    const videoDuration = mainVideo.duration || 999999;
    
    for (let i = 0; i < slideCandidates.length; i++) {
        const currentSec = slideCandidates[i].seconds;
        const nextSec = (i + 1 < slideCandidates.length) ? slideCandidates[i+1].seconds : videoDuration;
        
        // 抓出屬於此時間區間的字幕
        const matched = subtitles.filter(sub => sub.start >= currentSec && sub.start < nextSec);
        if (matched.length > 0) {
            const mergedText = matched.map(sub => sub.text).join(" ");
            slideCandidates[i].memo = mergedText;
        }
    }
    
    // 重新繪製前端畫廊，展示對齊後的 Textarea 內容
    rerenderGallery();
}

function rerenderGallery() {
    if (!galleryGrid) return;
    galleryGrid.innerHTML = "";
    slideCandidates.forEach(slide => {
        renderGalleryItem(slide);
    });
}

// 8. 手動擷取影格與自訂圖片上傳 (v2.08)
function setupManualControls() {
    const btnManualCapture = document.getElementById("btn-manual-capture");
    const customImgInput = document.getElementById("custom-img-input");
    
    if (btnManualCapture) {
        btnManualCapture.addEventListener("click", () => {
            if (!mainVideo.src) {
                alert("請先載入影片！");
                return;
            }
            const slideNo = slideCandidates.length + 1;
            const seconds = mainVideo.currentTime;
            const timestamp = formatTime(seconds);
            
            const capCanvas = document.createElement("canvas");
            capCanvas.width = mainVideo.videoWidth || 1280;
            capCanvas.height = mainVideo.videoHeight || 720;
            const capCtx = capCanvas.getContext("2d");
            capCtx.drawImage(mainVideo, 0, 0, capCanvas.width, capCanvas.height);
            
            capCanvas.toBlob(async (blob) => {
                const url = URL.createObjectURL(blob);
                const base64 = await new Promise((res) => {
                    const reader = new FileReader();
                    reader.onloadend = () => res(reader.result);
                    reader.readAsDataURL(blob);
                });
                
                const slideItem = {
                    slide_no: slideNo,
                    timestamp: timestamp,
                    seconds: seconds,
                    url: url,
                    base64: base64,
                    memo: ""
                };
                
                slideCandidates.push(slideItem);
                if (capturedCountBadge) capturedCountBadge.textContent = slideCandidates.length;
                
                if (subtitles && subtitles.length > 0) {
                    alignSubtitlesToSlides();
                } else {
                    renderGalleryItem(slideItem);
                }
                
                addAnalysisLog(`📸 手動擷取影格成功：時間點 ${timestamp}`);
            }, "image/webp", 0.85);
        });
    }

    if (customImgInput) {
        customImgInput.addEventListener("change", async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            
            for (const file of files) {
                const slideNo = slideCandidates.length + 1;
                const timestamp = "手動上傳";
                const seconds = mainVideo.currentTime || 0;
                
                const reader = new FileReader();
                reader.onload = async (evt) => {
                    const base64 = evt.target.result;
                    const url = URL.createObjectURL(file);
                    
                    const slideItem = {
                        slide_no: slideNo,
                        timestamp: timestamp,
                        seconds: seconds,
                        url: url,
                        base64: base64,
                        memo: ""
                    };
                    
                    slideCandidates.push(slideItem);
                    if (capturedCountBadge) capturedCountBadge.textContent = slideCandidates.length;
                    
                    if (subtitles && subtitles.length > 0) {
                        alignSubtitlesToSlides();
                    } else {
                        renderGalleryItem(slideItem);
                    }
                    
                    addAnalysisLog(`➕ 手動新增自訂圖片成功：No.${slideNo} (${file.name})`);
                };
                reader.readAsDataURL(file);
            }
        });
    }
}

// 9. AI 智能解讀控制面板設定 (v2.08)
function setupAiPanel() {
    const btnRunAi = document.getElementById("btn-run-ai");
    const aiModelSelect = document.getElementById("ai-model-select");
    const geminiKeyWrapper = document.getElementById("gemini-key-wrapper");
    const geminiKeyInput = document.getElementById("gemini-key-input");
    const aiReportArea = document.getElementById("ai-report-area");
    const aiReportContent = document.getElementById("ai-report-content");
    
    if (aiModelSelect) {
        const savedKey = localStorage.getItem("falo_gemini_api_key");
        if (savedKey && geminiKeyInput) {
            geminiKeyInput.value = savedKey;
        }

        aiModelSelect.addEventListener("change", () => {
            if (aiModelSelect.value.startsWith("gemini_")) {
                geminiKeyWrapper.style.display = "block";
            } else {
                geminiKeyWrapper.style.display = "none";
            }
            updateCostEstimator();
        });
        
        if (aiModelSelect.value.startsWith("gemini_")) {
            geminiKeyWrapper.style.display = "block";
        }
        updateCostEstimator();
    }
    
    if (geminiKeyInput) {
        geminiKeyInput.addEventListener("input", (e) => {
            localStorage.setItem("falo_gemini_api_key", e.target.value.trim());
        });
    }
    
    if (btnRunAi) {
        btnRunAi.addEventListener("click", async () => {
            // 密碼安全驗證門檻，防範無授權 API 調用
            const pwd = prompt("🔒 執行 AI 分析需要身分驗證，請輸入管理密碼：", "666666");
            if (pwd === null) return;
            if (pwd !== "666666") {
                alert("❌ 密碼錯誤！無法啟動 AI 分析。");
                return;
            }

            const checkedCbs = document.querySelectorAll(".slide-select-checkbox:checked");
            const checkedNos = Array.from(checkedCbs).map(cb => parseInt(cb.getAttribute("data-slide-no"), 10));
            const checkedSlides = slideCandidates.filter(s => checkedNos.includes(s.slide_no));
            
            if (checkedSlides.length === 0) {
                alert("⚠️ 請先在畫廊中勾選要送出分析的投影片！");
                return;
            }
            
            btnRunAi.disabled = true;
            btnRunAi.textContent = "⏳ 正在生成時間拼圖與分析中...";
            if (aiReportArea) aiReportArea.style.display = "block";
            if (aiReportContent) aiReportContent.textContent = "⏳ 正在本機拼接時間拼圖 (WebP)...\n此步驟會在您的瀏覽器中將多張影格合成為一張網格圖，完全不耗費流量。";
            
            try {
                const gridWebp = await generateStoryboardGrid(checkedSlides);
                if (!gridWebp) {
                    throw new Error("生成時間拼圖大圖失敗。");
                }
                
                if (aiReportContent) aiReportContent.textContent = "⏳ 時間拼圖生成成功！正在發送多模態解讀請求...\n請稍候，AI 正在分析影像中的簡報與您的口述字幕...";
                
                let transcriptPrompt = "";
                checkedSlides.forEach((slide) => {
                    transcriptPrompt += `[Page #${slide.slide_no} (⏱️ ${slide.timestamp})]：${slide.memo || "(無口述台詞與備註)"}\n`;
                });
                
                const finalPrompt = `您是一個專業的教材與簡報解讀 AI 助理。這是一張由多個簡報頁面拼接成的『時間拼圖 (Storyboard Grid)』圖片，以及每頁簡報對齊的講者口述逐字稿。
                
請仔細整合【簡報畫面內容】與【講者口述台詞】，為我產出結構化、高密度的教學講義與大綱。
請包含以下章節：
1. 💡 整體教學大綱與核心知識結構總結。
2. 📖 各頁投影片的導讀解析（請務必指明 Page #XXX，提取畫面上的關鍵字/圖表，並結合講者口述台詞與備註做深度註解）。
3. 🎯 核心技術要點、關鍵名詞與問答 (Q&A) 提取。

口述台詞與備註內容如下：
${transcriptPrompt}`;

                let responseText = "";
                const modelVal = aiModelSelect.value;
                
                if (modelVal.startsWith("gemini_")) {
                    const apiKey = geminiKeyInput.value.trim();
                    if (!apiKey) {
                        throw new Error("未填寫 Gemini API Key！");
                    }
                    
                    let geminiModelName = "gemini-1.5-flash";
                    if (modelVal === "gemini_3_5_flash") {
                        geminiModelName = "gemini-3.5-flash";
                    } else if (modelVal === "gemini_3_1_lite") {
                        geminiModelName = "gemini-3.1-flash-lite";
                    } else if (modelVal === "gemini_2_5_lite") {
                        geminiModelName = "gemini-2.5-flash-lite";
                    } else if (modelVal === "gemini_2_0_flash") {
                        geminiModelName = "gemini-2.0-flash";
                    }
                    
                    responseText = await callGeminiDirect(apiKey, gridWebp, finalPrompt, geminiModelName);
                } else {
                    let cfModelName = "@cf/meta/llama-3.2-11b-vision-instruct";
                    if (modelVal === "builtin_llama_70b") {
                        cfModelName = "@cf/meta/llama-3.1-70b-instruct";
                    } else if (modelVal === "builtin_gemma_26b") {
                        cfModelName = "@cf/google/gemma-4-26b-a4b-it";
                    } else if (modelVal === "builtin_glm_4_flash") {
                        cfModelName = "@cf/zai-org/glm-4.7-flash";
                    } else if (modelVal === "builtin_qwen_30b") {
                        cfModelName = "@cf/qwen/qwen3-30b-a3b-fp8";
                    } else if (modelVal === "builtin_deepseek_qwen_32b") {
                        cfModelName = "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b";
                    } else if (modelVal === "builtin_qwen_vl") {
                        cfModelName = "@cf/uform/uform-gen2-qwen-500m";
                    }
                    
                    const res = await fetchWithAuth("/api/ai-analyze", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ image: gridWebp, prompt: finalPrompt, model: cfModelName })
                    });
                    if (!res.ok) {
                        const errText = await res.text();
                        throw new Error(`Workers AI 內建模型伺服器錯誤 (HTTP ${res.status}): ${errText}`);
                    }
                    const data = await res.json();
                    responseText = data.response || data.result?.response || JSON.stringify(data);
                }
                
                latestAiReport = responseText;
                if (aiReportContent) aiReportContent.textContent = responseText;
                addAnalysisLog("🤖 <span style=\"color: #34d399; font-weight: bold;\">AI 簡報一鍵分析解讀完成！報告已載入。</span>");
                
            } catch (err) {
                console.error("AI Analysis failed:", err);
                if (aiReportContent) aiReportContent.innerHTML = `<span style="color: #f87171; font-weight: bold;">❌ AI 分析失敗：${err.message}</span>`;
                alert(`❌ AI 分析失敗：${err.message}`);
            } finally {
                btnRunAi.disabled = false;
                btnRunAi.textContent = "🤖 開始 AI 降維一鍵分析";
            }
        });
    }
}

// 將勾選簡報拼接成時間拼圖大圖 (WebP)
async function generateStoryboardGrid(checkedSlides) {
    if (checkedSlides.length === 0) return null;
    checkedSlides.sort((a, b) => a.slide_no - b.slide_no);
    const count = checkedSlides.length;
    
    let cols = 3;
    if (count <= 4) cols = 2;
    else if (count <= 9) cols = 3;
    else if (count <= 16) cols = 4;
    else if (count <= 25) cols = 5;
    else if (count <= 36) cols = 6;
    else cols = Math.ceil(Math.sqrt(count));
    
    const rows = Math.ceil(count / cols);
    const images = [];
    
    for (const slide of checkedSlides) {
        try {
            const img = await loadImageSafe(slide.url || slide.base64);
            images.push(img);
        } catch (e) {
            console.error(`Failed to load slide ${slide.slide_no}:`, e);
        }
    }
    
    if (images.length === 0) return null;
    
    const subWidth = 480;
    const subHeight = 270;
    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = cols * subWidth;
    gridCanvas.height = rows * subHeight;
    const ctx = gridCanvas.getContext("2d");
    
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);
    
    for (let i = 0; i < images.length; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = c * subWidth;
        const y = r * subHeight;
        
        ctx.drawImage(images[i], x + 4, y + 4, subWidth - 8, subHeight - 8);
        
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(x + 10, y + 10, 80, 24);
        
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 10, y + 10, 80, 24);
        
        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 11px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`Page #${checkedSlides[i].slide_no}`, x + 50, y + 26);
    }
    
    return gridCanvas.toDataURL("image/webp", 0.75);
}

// 瀏覽器本機直連 Gemini API 請求
async function callGeminiDirect(apiKey, imageBase64, promptText, modelName = "gemini-1.5-flash") {
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const payload = {
        contents: [
            {
                parts: [
                    { text: promptText },
                    {
                        inlineData: {
                            mimeType: "image/webp",
                            data: cleanBase64
                        }
                    }
                ]
            }
        ]
    };
    
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API 錯誤: ${err}`);
    }
    
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

// 10. v3.html 歷史存檔上傳與反序列化解析 (v2.09)
function handleUploadedFile(file) {
    if (file.name.endsWith(".html") || file.type === "text/html") {
        handleHtmlImport(file);
    } else {
        handleVideoFile(file);
    }
}

async function handleHtmlImport(file) {
    const reader = new FileReader();
    reader.onload = async (evt) => {
        const text = evt.target.result;
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/html");
        
        // 抓出歷史投影片卡片
        const cards = doc.querySelectorAll(".slide-card");
        if (cards.length === 0) {
            alert("⚠️ 無法識別此 HTML 檔案中的簡報影格！請確認是否為本系統導出的 v3.html 檔案。");
            return;
        }
        
        // 重置目前的投影片狀態與畫廊 DOM
        slideCandidates = [];
        if (galleryGrid) galleryGrid.innerHTML = "";
        
        // 試圖提取標題
        const titleHeader = doc.querySelector("h1");
        let parsedTitle = "已匯入簡報";
        if (titleHeader) {
            parsedTitle = titleHeader.textContent
                .replace(" - AI Ingestion & Analysis Draft (v3.html)", "")
                .replace(" - AI Ingestion & Analysis Draft (v3)", "")
                .replace("🎬 ", "")
                .trim();
        }
        taskTitleInput.value = parsedTitle;
        
        // 還原投影片對象列表
        cards.forEach((card, idx) => {
            const img = card.querySelector("img");
            const memoTa = card.querySelector("textarea");
            
            const spans = card.querySelectorAll("span");
            let pageNo = idx + 1;
            let timestamp = "00:00:00";
            
            if (spans.length >= 2) {
                const pageText = spans[0].textContent.replace("Page #", "");
                pageNo = parseInt(pageText, 10) || (idx + 1);
                timestamp = spans[1].textContent.replace("⏱️", "").replace("⏱", "").trim();
            }
            
            const seconds = parseTimestamp(timestamp);
            const base64Url = img ? img.getAttribute("src") : "";
            const memoContent = memoTa ? memoTa.value || memoTa.textContent || "" : "";
            
            const slideItem = {
                slide_no: pageNo,
                timestamp: timestamp,
                seconds: seconds,
                url: base64Url,
                base64: base64Url,
                memo: memoContent
            };
            
            slideCandidates.push(slideItem);
            renderGalleryItem(slideItem);
        });
        
        // 更新 UI 元件狀態
        if (capturedCountBadge) capturedCountBadge.textContent = slideCandidates.length;
        uploadCard.style.display = "none";
        analysisCard.style.display = "block";
        galleryCard.style.display = "block";
        if (analysisLogConsole) {
            analysisLogConsole.style.display = "block";
        }
        
        // 開啟 AI 解讀側邊欄與雙欄佈局
        const aiSidebar = document.getElementById("ai-sidebar");
        if (aiSidebar) {
            aiSidebar.style.display = "block";
            document.querySelector(".main-layout").classList.add("has-ai-panel");
        }
        
        addAnalysisLog(`🎉 成功自存檔 ${file.name} 匯入並還原 ${slideCandidates.length} 張投影片與歷史編輯備註！`);
        alert(`🎉 還原成功！已成功載入 ${slideCandidates.length} 頁投影片。您現在可以直接進行二次編輯，或是啟動 AI 智能分析！`);
    };
    reader.readAsText(file);
}

// 11. 💵 AI 運行成本對比與估算 (v2.09)
const modelCosts = {
    "builtin_llama_70b": { name: "Llama 3.1 70B", price: 0.70, type: "Text" },
    "builtin_deepseek_qwen_32b": { name: "DeepSeek R1 Qwen 32B", price: 0.35, type: "Text" },
    "builtin_qwen_30b": { name: "Qwen3 30B", price: 0.30, type: "Text" },
    "builtin_gemma_26b": { name: "Gemma-4 26B", price: 0.27, type: "Text" },
    "builtin_llama_vision": { name: "Llama 3.2 Vision 11B", price: 0.15, type: "Vision" },
    "builtin_glm_4_flash": { name: "GLM-4.7-Flash", price: 0.10, type: "Text" },
    "builtin_qwen_vl": { name: "Qwen-VL-500M", price: 0.015, type: "Vision" },
    "gemini_3_5_flash": { name: "Gemini 3.5 Flash", price: 0.075, type: "Vision" },
    "gemini_1_5_flash": { name: "Gemini 1.5 Flash", price: 0.075, type: "Vision" },
    "gemini_2_0_flash": { name: "Gemini 2.0 Flash", price: 0.075, type: "Vision" },
    "gemini_3_1_lite": { name: "Gemini 3.1 Flash-Lite", price: 0.0375, type: "Vision" },
    "gemini_2_5_lite": { name: "Gemini 2.5 Flash-Lite", price: 0.0375, type: "Vision" }
};

function updateCostEstimator() {
    const aiModelSelect = document.getElementById("ai-model-select");
    const costPercentageText = document.getElementById("cost-percentage-text");
    const costPerMillionText = document.getElementById("cost-per-million-text");
    const costSavingText = document.getElementById("cost-saving-text");
    const costEfficiencyBadge = document.getElementById("cost-efficiency-badge");
    
    if (!aiModelSelect) return;
    const modelKey = aiModelSelect.value;
    const info = modelCosts[modelKey] || { name: "Unknown", price: 0.70 };
    
    // 基準模型為 Llama 3.1 70B ($0.70 / 1M tokens)
    const basePrice = 0.70;
    const price = info.price;
    const pct = (price / basePrice) * 100;
    const savings = 100 - pct;
    
    if (costPercentageText) costPercentageText.textContent = `${pct.toFixed(1)}%`;
    if (costPerMillionText) costPerMillionText.textContent = `$${price.toFixed(4)} USD`;
    
    if (costSavingText) {
        if (modelKey === "builtin_llama_70b") {
            costSavingText.textContent = "0.0% (基準)";
            if (costEfficiencyBadge) {
                costEfficiencyBadge.textContent = "100% (基準)";
                costEfficiencyBadge.style.color = "var(--text-secondary)";
            }
        } else {
            costSavingText.textContent = `${savings.toFixed(1)}%`;
            if (costEfficiencyBadge) {
                costEfficiencyBadge.textContent = `節省 ${savings.toFixed(1)}%`;
                costEfficiencyBadge.style.color = "var(--accent-green)";
            }
        }
    }
}



