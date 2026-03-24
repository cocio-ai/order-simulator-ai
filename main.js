document.addEventListener("DOMContentLoaded", () => {
    
    document.getElementById('targetDate').valueAsDate = new Date();
    let chartInstance = null;

    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('captureCanvas');
    const snapBtn = document.getElementById('btn-snap');
    const startCameraBtn = document.getElementById('btn-start-camera');
    const analyzeBtn = document.getElementById('btn-analyze');
    const ocrStatus = document.getElementById('ocrStatus');
    const gotDataInput = document.getElementById('gotDataInput');

    // --- 1. カメラ起動・撮影エンジン ---
    startCameraBtn.addEventListener('click', async () => {
        try {
            // 背面カメラを優先して起動
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { faciningMode: "environment" }, 
                audio: false 
            });
            video.srcObject = stream;
            snapBtn.disabled = false; // 撮影ボタンを有効化
            startCameraBtn.innerText = "🔄 カメラ再起動";
        } catch (e) {
            alert("カメラの起動に失敗しました。ブラウザの許可設定を確認してください。");
            console.error(e);
        }
    });

    // --- 2. 撮影 ＆ OCR（文字認識）エンジン ---
    snapBtn.addEventListener('click', () => {
        const context = canvas.getContext('2d');
        // ビデオの現在のフレームをキャンバスに描画（キャプチャ）
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

        // OCR処理を開始
        runOCR(canvas.toDataURL('image/jpeg'));
    });

    async function runOCR(imageData) {
        ocrStatus.style.display = 'flex'; // ステータス表示
        snapBtn.disabled = true;
        gotDataInput.style.display = 'none';

        try {
            // Tesseract.jsを初期化（日本語 + 英語/数字）
            const worker = await Tesseract.createWorker('jpn+eng');
            
            // 文字認識を実行
            const { data: { text } } = await worker.recognize(imageData);
            
            await worker.terminate(); // Tesseractを終了

            // 🌟 現場用ハック：読み取りテキストを確認・修正できるようにテキストエリアに表示
            gotDataInput.value = text;
            gotDataInput.style.display = 'block'; // テキストエリアを表示
            ocrStatus.style.display = 'none';
            snapBtn.disabled = false;
            analyzeBtn.disabled = false; // AI解析ボタンを有効化

            alert("画面の読み取りが完了しました。数値を手動で修正できます。");

        } catch (e) {
            console.error(e);
            alert("AI文字認識中にエラーが発生しました。");
            ocrStatus.style.display = 'none';
            snapBtn.disabled = false;
        }
    }

    // （以下、前回と同じAI解析ロジック。テキストエリアの中身を元に計算します）
    function parseGOTData(text) {
        let category = "未分類";
        let avgSales = 0;
        let currentStock = 0;
        let avgWaste = 0;

        const catMatch = text.match(/分類[:：\s]*([^\n]+)/);
        if (catMatch) category = catMatch[1].trim();

        // 現場ハック：OCRは全角を読みがちなので、半角に変換してパース
        const cleanText = text.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));

        const salesMatch = cleanText.match(/販売数[:：\s]*(\d+(\.\d+)?)/);
        if (salesMatch) avgSales = parseFloat(salesMatch[1]);

        const stockMatch = cleanText.match(/在庫[:：\s]*(\d+)/);
        if (stockMatch) currentStock = parseInt(stockMatch[1], 10);

        const wasteMatch = cleanText.match(/廃棄数[:：\s]*(\d+(\.\d+)?)/);
        if (wasteMatch) avgWaste = parseFloat(wasteMatch[1]);

        return { category, avgSales, currentStock, avgWaste };
    }

    function calculateAIFactors(parsedData, targetDateStr, todayTemp, yesterdayTemp) {
        // （※AI計算ロジックは前回と同じため省略）
        let baseDemand = parsedData.avgSales;
        let factors = { base: baseDemand, dateBoost: 0, tempGapBoost: 0, cannibalization: 0, stockMinus: -parsedData.currentStock, wasteMinus: -parsedData.avgWaste };
        let comments = [];

        if (targetDateStr) {
            const d = new Date(targetDateStr);
            const dateNum = d.getDate();
            const dayOfWeek = d.getDay();
            if (dateNum === 15 || dateNum === 25) { factors.dateBoost = baseDemand * 0.15; comments.push(`💰 支給日エフェクト検知（${dateNum}日）。予測+15%底上げしました。`); }
            else if (dayOfWeek === 5 || dayOfWeek === 6) { factors.dateBoost = baseDemand * 0.10; comments.push("🍺 週末・休日前夜エフェクト。予測+10%補正しました。"); }
        }
        const tempGap = todayTemp - yesterdayTemp;
        if (tempGap >= 5) { factors.tempGapBoost = baseDemand * 0.20; comments.push(`🌡️ 急激な気温上昇（+${tempGap}℃）。夏型ブースト(+20%)しました。`); }
        else if (tempGap <= -5) { factors.tempGapBoost = -baseDemand * 0.10; comments.push(`❄️ 急激な冷え込み（${tempGap}℃）。マイナス補正しました。`); }
        if (parsedData.category.includes("弁当") && todayTemp >= 28) { factors.cannibalization = -baseDemand * 0.15; comments.push("📉 カニバリゼーション：調理麺へのシフトを考慮し弁当を15%減枠しました。"); }

        let finalOrder = factors.base + factors.dateBoost + factors.tempGapBoost + factors.cannibalization + factors.stockMinus + factors.wasteMinus;
        finalOrder = Math.max(0, Math.ceil(finalOrder));
        return { factors, finalOrder, comments };
    }

    function renderChart(factors) {
        // （※グラフ描画ロジックは前回と同じため省略）
        const ctx = document.getElementById('aiChart').getContext('2d');
        if (chartInstance) { chartInstance.destroy(); }
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['基本需要', '日付/曜日', '気温変動', 'カニバリ調整', '在庫/廃棄控除'],
                datasets: [{
                    label: '要因 (個)',
                    data: [factors.base, factors.dateBoost, factors.tempGapBoost, factors.cannibalization, (factors.stockMinus + factors.wasteMinus)],
                    backgroundColor: ['#3b82f6', '#10b981', factors.tempGapBoost > 0 ? '#10b981' : '#ef4444', '#f59e0b', '#ef4444'],
                    borderRadius: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#334155' } }, x: { grid: { display: false } } } }
        });
    }

    analyzeBtn.addEventListener('click', () => {
        // AI解析ボタンは、GOTDataInput（テキストエリア）の中身を使って計算する
        const text = gotDataInput.value;
        const targetDate = document.getElementById('targetDate').value;
        const todayTemp = parseFloat(document.getElementById('todayTemp').value);
        const yesterdayTemp = parseFloat(document.getElementById('yesterdayTemp').value);

        const parsedData = parseGOTData(text);
        
        if (parsedData.avgSales === 0 && parsedData.currentStock === 0) {
            alert("数値が読み取れていません。テキストエリアに手動で数値を入力してください。");
            return;
        }

        const result = calculateAIFactors(parsedData, targetDate, todayTemp, yesterdayTemp);

        document.getElementById('dispBase').innerText = parsedData.avgSales;
        let score = result.factors.dateBoost + result.factors.tempGapBoost + result.factors.cannibalization;
        document.getElementById('dispScore').innerText = (score > 0 ? "+" : "") + score.toFixed(1);
        document.getElementById('dispScore').style.color = score >= 0 ? "#10b981" : "#ef4444";
        document.getElementById('dispFinalOrder').innerHTML = `${result.finalOrder} <small>個</small>`;

        const commentArea = document.getElementById('aiCommentary');
        if (result.comments.length > 0) { commentArea.innerHTML = "<strong>【AI 思考プロセス】</strong><br>" + result.comments.join("<br><br>"); }
        else { commentArea.innerHTML = "<strong>【AI 思考プロセス】</strong><br>🎯 特殊要因なし。標準アルゴリズムで算出。"; }
        renderChart(result.factors);
    });
});
