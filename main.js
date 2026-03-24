document.addEventListener("DOMContentLoaded", () => {
    
    document.getElementById('targetDate').valueAsDate = new Date();
    let chartInstance = null;

    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('captureCanvas');
    const snapBtn = document.getElementById('btn-snap');
    const startCameraBtn = document.getElementById('btn-start-camera');
    const analyzeBtn = document.getElementById('btn-analyze');
    const ocrStatus = document.getElementById('ocrStatus');
    const ocrProgressBar = document.getElementById('ocrProgressBar');
    const ocrStatusText = document.getElementById('ocrStatusText');
    const ocrTextOutput = document.getElementById('ocrTextOutput');

    // --- 1. カメラ起動・撮影エンジン ---
    startCameraBtn.addEventListener('click', async () => {
        try {
            if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }

            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment" }, 
                audio: false 
            });
            video.srcObject = stream;

            video.onloadedmetadata = () => { video.play(); };

            snapBtn.disabled = false;
            startCameraBtn.innerText = "🔄 カメラ再起動";
        } catch (e) {
            alert("カメラ起動失敗。\niPadの設定 ＞ Safari ＞「カメラ」を許可にしてください。\n詳細: " + e.message);
        }
    });

    // --- 2. 撮影 ＆ OCR（文字認識）エンジン ---
    snapBtn.addEventListener('click', () => {
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

        runOCR(canvas.toDataURL('image/jpeg'));
    });

    async function runOCR(imageData) {
        ocrStatus.style.display = 'flex';
        ocrProgressBar.style.width = '0%';
        ocrStatusText.innerText = "AI辞書データを準備中...(初回は数秒かかります)";
        snapBtn.disabled = true;

        try {
            // Tesseract v5の安定した書き方。ログで状態を可視化
            const worker = await Tesseract.createWorker('jpn', 1, {
                logger: m => {
                    console.log(m);
                    if (m.status === 'recognizing text') {
                        const prog = Math.ceil(m.progress * 100);
                        ocrProgressBar.style.width = prog + '%';
                        ocrStatusText.innerText = `文字を読み取り中 (${prog}%)`;
                    } else if (m.status.includes('loading')) {
                        ocrStatusText.innerText = "AI辞書をダウンロード中...";
                        ocrProgressBar.style.width = '50%';
                    }
                }
            });
            
            const { data: { text } } = await worker.recognize(imageData);
            await worker.terminate();

            // 🌟 読み取った文字を【追記】する（2枚目の写真データも合体させるため）
            if (ocrTextOutput.value.trim() !== "") {
                ocrTextOutput.value += "\n\n--- 続けて追加撮影したデータ ---\n\n";
            }
            ocrTextOutput.value += text;
            
            ocrStatus.style.display = 'none';
            snapBtn.disabled = false;

            alert("読み取り完了！\n在庫推移表など、別の画面を追加で撮影できます。\nすべて撮影し終えたら「AI解析」を押してください。");

        } catch (e) {
            console.error(e);
            alert("OCRエラー: " + e.message);
            ocrStatus.style.display = 'none';
            snapBtn.disabled = false;
        }
    }

    // --- 3. GOTデータ 抽出エンジン ---
    function parseOCRText(text) {
        let store = "未取得店舗";
        let category = "";
        let baseSales = 0;
        let shortageRate = 0;
        let currentStock = 0; // 🌟 在庫追加
        let wasteMinus = 0;   // 🌟 廃棄追加

        // 全角数字を半角に、カンマやスペースを削除して読みやすくする
        let cleanText = text.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        cleanText = cleanText.replace(/ /g, '').replace(/、/g, ',');

        if (cleanText.includes("池上")) store = "セブンイレブン尾張旭晴丘町池上店";
        if (cleanText.includes("おにぎり")) category = "おにぎり";
        else if (cleanText.includes("弁当")) category = "弁当";
        else if (cleanText.includes("調理麺")) category = "調理麺";

        // ① 4週間一覧表から「週平均」の販売数と欠品率を狙う
        const salesSectionMatch = cleanText.match(/直近週\(週平均\)[^\d]*(\d+)[^\d]*(\d+)/);
        if (salesSectionMatch) {
            baseSales = parseFloat(salesSectionMatch[2]); // 納品数・販売数と並んでいる想定
        } else {
            const fallbackSalesMatch = cleanText.match(/販売数[^\n\d]*(\d+)/);
            if (fallbackSalesMatch) baseSales = parseFloat(fallbackSalesMatch[1]);
        }

        const shortageMatch = cleanText.match(/欠品率\(%\)[^\d]*(\d+)/);
        if (shortageMatch) shortageRate = parseFloat(shortageMatch[1]);

        // ② 在庫推移表から「現在庫」と「廃棄数」を狙う
        const stockMatch = cleanText.match(/在庫[^\n\d]*(\d+)/);
        if (stockMatch) currentStock = parseFloat(stockMatch[1]);

        const wasteMatch = cleanText.match(/廃棄[^\n\d]*(\d+)/);
        if (wasteMatch) wasteMinus = parseFloat(wasteMatch[1]);

        return { store, category, baseSales, shortageRate, currentStock, wasteMinus };
    }

    // --- 4. AI 複合要因予測・発注算出エンジン ---
    function calculateAIOrder(targetDateStr, todayTemp, yesterdayTemp, ocrData, minDisplayQty) {
        let factors = {
            base: ocrData.baseSales || 0,
            shortageBoost: 0,
            salaryDayBoost: 0,
            tempGapBoost: 0,
            cannibalization: 0,
            stockMinus: -(ocrData.currentStock || 0), // 🌟 読み取った在庫をマイナス
            wasteMinus: -(ocrData.wasteMinus || 0)    // 🌟 読み取った廃棄をマイナス
        };
        let comments = [];

        if (factors.base === 0) {
            comments.push("⚠️ 販売数が読み取れませんでした。テキストエリアの数値を修正してください。");
            return { factors, finalOrder: 0, comments, appliedDisplayQty: 0 };
        }

        if (ocrData.currentStock > 0) comments.push(`📦 現在庫（${ocrData.currentStock}個）を検知。発注数から減算します。`);
        if (ocrData.wasteMinus > 0) comments.push(`🗑️ 廃棄（${ocrData.wasteMinus}個）を検知。過剰発注を防ぐため減算します。`);

        // 機会損失補正
        if (ocrData.shortageRate > 10) {
            factors.shortageBoost = factors.base * 0.10;
            comments.push(`🎯 機会損失補正：平均欠品率${ocrData.shortageRate}%のためベース予測を+10%増枠。`);
        }

        // 日付・気温要因
        if (targetDateStr) {
            const dateNum = new Date(targetDateStr).getDate();
            if ([15, 16, 25, 26].includes(dateNum)) {
                factors.salaryDayBoost = factors.base * 0.15;
                comments.push(`💰 支給日エフェクト（${dateNum}日付近）。購買意欲高まり予測(+15%)。`);
            }
        }

        const tempGap = todayTemp - yesterdayTemp;
        if (tempGap >= 5) {
            factors.tempGapBoost = factors.base * 0.20;
            comments.push(`🌡️ 急な気温上昇（+${tempGap}℃）。冷やし麺等の一時需要増ブースト(+20%)。`);
        } else if (tempGap <= -5) {
            factors.tempGapBoost = -factors.base * 0.10;
            comments.push(`❄️ 急な冷え込み（${tempGap}℃）。客足鈍化リスクで微減(-10%)調整。`);
        }

        if (ocrData.category === "弁当" && todayTemp >= 28) {
            factors.cannibalization = -factors.base * 0.15;
            comments.push("📈 カニバリ検知：高温のため調理麺へ需要が流れると予測し、常温弁当を15%減枠。");
        }

        const totalPrediction = factors.base + factors.shortageBoost + factors.salaryDayBoost + factors.tempGapBoost + factors.cannibalization + factors.stockMinus + factors.wasteMinus;
        
        let appliedDisplayQty = 0;
        if (ocrData.category === "おにぎり" && minDisplayQty > totalPrediction) {
            appliedDisplayQty = minDisplayQty;
            comments.push(`🏪 売場確保：予測よりも最低陳列量(${minDisplayQty}個)を優先します。`);
        }

        let finalOrder = Math.max(0, appliedDisplayQty > 0 ? appliedDisplayQty : Math.ceil(totalPrediction));

        return { factors, finalOrder, comments, appliedDisplayQty };
    }

    // --- 5. グラフ描画 ---
    function renderChart(factors) {
        Chart.defaults.color = '#94a3b8';
        const ctx = document.getElementById('aiChart').getContext('2d');
        if (chartInstance) { chartInstance.destroy(); }
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['基礎需要', '欠品補正', '支給日等', '気温ギャップ', '在庫/廃棄/カニバリ減算'],
                datasets: [{
                    label: '要因別増減数 (個)',
                    data: [ 
                        factors.base, 
                        factors.shortageBoost, 
                        factors.salaryDayBoost, 
                        factors.tempGapBoost, 
                        (factors.cannibalization + factors.stockMinus + factors.wasteMinus) // マイナス要因を合算して表示
                    ],
                    backgroundColor: ['#3b82f6', '#10b981', '#10b981', factors.tempGapBoost > 0 ? '#10b981' : '#EE1C25', '#EE1C25'],
                    borderRadius: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#E0E0E0' } }, x: { grid: { display: false } } } }
        });
    }

    analyzeBtn.addEventListener('click', () => {
        const ocrRawText = ocrTextOutput.value;
        const targetDateStr = document.getElementById('targetDate').value;
        const todayTemp = parseFloat(document.getElementById('todayTemp').value);
        const yesterdayTemp = parseFloat(document.getElementById('yesterdayTemp').value);
        const minDisplayQty = parseFloat(document.getElementById('minDisplayQty').value) || 0;

        const ocrData = parseOCRText(ocrRawText);
        
        if (ocrData.category) {
            document.getElementById('categoryName').value = ocrData.category;
            document.getElementById('displayInputArea').style.display = (ocrData.category === "おにぎり") ? 'flex' : 'none';
        }
        document.getElementById('storeName').value = ocrData.store;

        const result = calculateAIOrder(targetDateStr, todayTemp, yesterdayTemp, ocrData, minDisplayQty);

        document.getElementById('resCategory').innerText = ocrData.category || "分類不明";
        document.getElementById('dispBase').innerText = ocrData.baseSales;
        
        let score = result.factors.shortageBoost + result.factors.salaryDayBoost + result.factors.tempGapBoost + result.factors.cannibalization + result.factors.stockMinus + result.factors.wasteMinus;
        document.getElementById('dispScore').innerText = (score > 0 ? "+" : "") + Math.ceil(score);
        document.getElementById('dispScore').style.color = score >= 0 ? "var(--seven-green)" : "var(--seven-red)";
        document.getElementById('dispFinalOrder').innerHTML = `${result.finalOrder} <small>個</small>`;

        const commentArea = document.getElementById('aiCommentary');
        commentArea.innerHTML = "<strong>【AI 思考プロセス解説】</strong><br>" + (result.comments.length > 0 ? result.comments.join("<br><br>") : "標準需要に基づき算出しました。");

        renderChart(result.factors);
        document.querySelector('.result-panel').scrollIntoView({ behavior: 'smooth' });
    });
});
