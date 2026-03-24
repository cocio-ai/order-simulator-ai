document.addEventListener("DOMContentLoaded", () => {
    
    document.getElementById('targetDate').valueAsDate = new Date();
    let chartInstance = null;
    
    // 🌟 ステップ管理（1: 4週間一覧表, 2: 在庫推移表）
    let currentStep = 1;

    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('captureCanvas');
    const snapBtn = document.getElementById('btn-snap');
    const startCameraBtn = document.getElementById('btn-start-camera');
    const analyzeBtn = document.getElementById('btn-analyze');
    const resetBtn = document.getElementById('btn-reset-ocr');
    const ocrStatus = document.getElementById('ocrStatus');
    const ocrProgressBar = document.getElementById('ocrProgressBar');
    const ocrStatusText = document.getElementById('ocrStatusText');
    const ocrTextOutput = document.getElementById('ocrTextOutput');

    // --- 1. カメラ起動 (iPad Safari完全対応) ---
    startCameraBtn.addEventListener('click', async () => {
        try {
            if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment" }, 
                audio: false 
            });
            video.srcObject = stream;
            
            // iPad(iOS) Safariで確実に映像を再生するための記述
            video.setAttribute('playsinline', true);
            video.onloadedmetadata = () => { video.play(); };

            snapBtn.disabled = false;
            startCameraBtn.innerText = "🔄 カメラ再起動";
        } catch (e) {
            alert("カメラ起動失敗。\niPadの「設定」＞「Safari」＞「カメラ」が「許可」になっているか確認してください。\n\n詳細: " + e.message);
        }
    });

    // --- 2. 撮影 ＆ 軽量化OCR ---
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
        ocrStatusText.innerText = "文字を解析中...";
        snapBtn.disabled = true;

        try {
            // 🌟 iPadフリーズ対策：一番シンプルでメモリを食わない呼び出し方
            const { data: { text } } = await Tesseract.recognize(
                imageData, 
                'jpn', 
                { logger: m => {
                    if (m.status === 'recognizing text') {
                        const prog = Math.ceil(m.progress * 100);
                        ocrProgressBar.style.width = prog + '%';
                        ocrStatusText.innerText = `文字を解析中 (${prog}%)`;
                    }
                }}
            );

            // 読み取りテキストの追記
            if (currentStep === 2) {
                ocrTextOutput.value += "\n\n--- 【在庫推移表データ】 ---\n\n";
            }
            ocrTextOutput.value += text;
            ocrStatus.style.display = 'none';
            resetBtn.style.display = 'block';

            // 🌟 ステップ移行とUI変更
            if (currentStep === 1) {
                currentStep = 2;
                document.getElementById('guideStep1').classList.remove('active');
                document.getElementById('guideStep1').querySelector('.step-badge').style.background = '#666';
                document.getElementById('guideStep2').classList.add('active');
                document.getElementById('guideStep2').querySelector('.step-badge').style.background = 'var(--seven-green)';
                
                snapBtn.innerText = "📸 2枚目(在庫推移表)を撮影";
                snapBtn.disabled = false;
                alert("1枚目の読み取り完了！\n続けて、画面を「在庫推移表」に切り替えて撮影してください。");
            } else {
                snapBtn.innerText = "📸 もう一度撮影する";
                snapBtn.disabled = false;
                analyzeBtn.disabled = false;
                alert("全データの読み取り完了！\n下にある「⚡ AI解析」ボタンを押してください。");
            }

        } catch (e) {
            alert("OCRエラーが発生しました。\n詳細: " + e.message);
            ocrStatus.style.display = 'none';
            snapBtn.disabled = false;
        }
    }

    // リセットボタン（初めからやり直す）
    resetBtn.addEventListener('click', () => {
        currentStep = 1;
        ocrTextOutput.value = "";
        document.getElementById('guideStep2').classList.remove('active');
        document.getElementById('guideStep2').querySelector('.step-badge').style.background = '#666';
        document.getElementById('guideStep1').classList.add('active');
        document.getElementById('guideStep1').querySelector('.step-badge').style.background = 'var(--seven-orange)';
        snapBtn.innerText = "📸 1枚目(4週間一覧)を撮影";
        analyzeBtn.disabled = true;
        resetBtn.style.display = 'none';
    });

    // --- 3. 超強力！データ抽出エンジン ---
    function parseOCRText(text) {
        let category = ""; let baseSales = 0; let shortageRate = 0; let currentStock = 0; let wasteMinus = 0;

        // ゴミやスペースを極限まで削ぎ落とす
        let cleanText = text.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        cleanText = cleanText.replace(/[\s、，,]/g, '');

        if (cleanText.includes("おにぎり")) category = "おにぎり";
        else if (cleanText.includes("弁当")) category = "弁当";
        else if (cleanText.includes("調理麺")) category = "調理麺";

        // ① 販売数を強引に探す（"販売数"の次にある数字の塊）
        const salesMatch = cleanText.match(/販売数[^\d]*(\d+)/);
        if (salesMatch) baseSales = parseInt(salesMatch[1], 10);

        // ② 欠品率を探す
        const shortageMatch = cleanText.match(/欠品率[^\d]*(\d+)/);
        if (shortageMatch) shortageRate = parseInt(shortageMatch[1], 10);

        // ③ 在庫数を強引に探す（"在庫"の次にある数字）
        const stockMatch = cleanText.match(/在庫[^\d]*(\d+)/);
        if (stockMatch) currentStock = parseInt(stockMatch[1], 10);

        // ④ 廃棄を探す
        const wasteMatch = cleanText.match(/廃棄[^\d]*(\d+)/);
        if (wasteMatch) wasteMinus = parseInt(wasteMatch[1], 10);

        return { category, baseSales, shortageRate, currentStock, wasteMinus };
    }

    // --- 4. AI 複合要因・算出エンジン ---
    function calculateAIOrder(targetDateStr, todayTemp, yesterdayTemp, ocrData) {
        let factors = { base: ocrData.baseSales || 0, shortageBoost: 0, salaryDayBoost: 0, tempGapBoost: 0, cannibalization: 0, stockMinus: -(ocrData.currentStock || 0), wasteMinus: -(ocrData.wasteMinus || 0) };
        let comments = [];

        if (factors.base === 0) {
            comments.push("⚠️ 販売数が読み取れませんでした。テキストエリアの文字を手動で書き換えるか、撮り直してください。");
            return { factors, finalOrder: 0, comments };
        }

        if (ocrData.currentStock > 0) comments.push(`📦 現在庫（${ocrData.currentStock}個）を読み取りました。発注数から減算します。`);
        if (ocrData.wasteMinus > 0) comments.push(`🗑️ 廃棄（${ocrData.wasteMinus}個）を読み取りました。過剰発注を防ぐため減算します。`);

        if (ocrData.shortageRate > 10) { factors.shortageBoost = factors.base * 0.10; comments.push(`🎯 欠品率${ocrData.shortageRate}%のためベース予測を+10%増枠。`); }
        
        if (targetDateStr) {
            const dateNum = new Date(targetDateStr).getDate();
            if ([15, 16, 25, 26].includes(dateNum)) { factors.salaryDayBoost = factors.base * 0.15; comments.push(`💰 支給日エフェクト（${dateNum}日）。購買意欲高まり予測(+15%)。`); }
        }

        const tempGap = todayTemp - yesterdayTemp;
        if (tempGap >= 5) { factors.tempGapBoost = factors.base * 0.20; comments.push(`🌡️ 寒暖差（+${tempGap}℃）。冷やし麺等の需要増ブースト(+20%)。`); }
        else if (tempGap <= -5) { factors.tempGapBoost = -factors.base * 0.10; comments.push(`❄️ 急な冷え込み（${tempGap}℃）。微減(-10%)調整。`); }

        if (ocrData.category === "弁当" && todayTemp >= 28) { factors.cannibalization = -factors.base * 0.15; comments.push("📈 カニバリ検知：高温のため調理麺へ需要シフト。弁当を15%減枠。"); }

        let finalOrder = Math.max(0, Math.ceil(factors.base + factors.shortageBoost + factors.salaryDayBoost + factors.tempGapBoost + factors.cannibalization + factors.stockMinus + factors.wasteMinus));

        return { factors, finalOrder, comments };
    }

    // --- 5. グラフ描画 ---
    function renderChart(f) {
        const ctx = document.getElementById('aiChart').getContext('2d');
        if (chartInstance) { chartInstance.destroy(); }
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['基礎', '欠品', '日付等', '気温差', '在庫減算'],
                datasets: [{
                    label: '増減 (個)',
                    data: [ f.base, f.shortageBoost, f.salaryDayBoost, f.tempGapBoost, (f.cannibalization + f.stockMinus + f.wasteMinus) ],
                    backgroundColor: ['#3b82f6', '#10b981', '#10b981', f.tempGapBoost > 0 ? '#10b981' : '#EE1C25', '#EE1C25']
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }

    // --- 実行処理 ---
    analyzeBtn.addEventListener('click', () => {
        const ocrRawText = ocrTextOutput.value;
        const ocrData = parseOCRText(ocrRawText);
        
        if (ocrData.category) document.getElementById('categoryName').value = ocrData.category;
        
        const result = calculateAIOrder(
            document.getElementById('targetDate').value,
            parseFloat(document.getElementById('todayTemp').value),
            parseFloat(document.getElementById('yesterdayTemp').value),
            ocrData
        );

        document.getElementById('resCategory').innerText = ocrData.category || "分類不明";
        document.getElementById('dispBase').innerText = ocrData.baseSales;
        
        let score = result.factors.shortageBoost + result.factors.salaryDayBoost + result.factors.tempGapBoost + result.factors.cannibalization + result.factors.stockMinus + result.factors.wasteMinus;
        document.getElementById('dispScore').innerText = (score > 0 ? "+" : "") + Math.ceil(score);
        document.getElementById('dispScore').style.color = score >= 0 ? "var(--seven-green)" : "var(--seven-red)";
        document.getElementById('dispFinalOrder').innerHTML = `${result.finalOrder} <small>個</small>`;

        document.getElementById('aiCommentary').innerHTML = "<strong>【AI 思考プロセス解説】</strong><br>" + (result.comments.length > 0 ? result.comments.join("<br><br>") : "標準需要に基づき算出しました。");
        renderChart(result.factors);
        document.querySelector('.result-panel').scrollIntoView({ behavior: 'smooth' });
    });
});
