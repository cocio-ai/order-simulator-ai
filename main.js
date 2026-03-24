document.addEventListener("DOMContentLoaded", () => {
    
    // 今日の日付をデフォルトセット
    document.getElementById('targetDate').valueAsDate = new Date();

    let chartInstance = null;

    // --- 状態管理 ---
    const State = {
        data: {
            stores: {} 
        },
        load() {
            try {
                const raw = localStorage.getItem('oms_ai_core_data_v1');
                if (raw) { this.data = JSON.parse(raw); }
            } catch(e) { console.error("データ読み込みエラー", e); }
        },
        save() {
            try { localStorage.setItem('oms_ai_core_data_v1', JSON.stringify(this.data)); } catch(e) {}
        }
    };
    State.load();

    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('captureCanvas');
    const snapBtn = document.getElementById('btn-snap');
    const startCameraBtn = document.getElementById('btn-start-camera');
    const analyzeBtn = document.getElementById('btn-analyze');
    const ocrStatus = document.getElementById('ocrStatus');
    const ocrProgressBar = document.getElementById('ocrProgressBar');
    const ocrStatusText = document.getElementById('ocrStatusText');
    const ocrTextOutput = document.getElementById('ocrTextOutput');

    // --- 1. カメラ起動・撮影エンジン (iPad対策済) ---
    startCameraBtn.addEventListener('click', async () => {
        try {
            // ストリームを停止
            if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }

            // 背面カメラ(facingMode: "environment")をスペルミスなく指定
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment" }, 
                audio: false 
            });
            video.srcObject = stream;

            // 🍏 iPad(Safari)対策。メタデータがロードされたら確実に再生
            video.onloadedmetadata = () => {
                video.play();
            };

            snapBtn.disabled = false; // 撮影ボタンを有効化
            startCameraBtn.innerText = "🔄 カメラ再起動";
        } catch (e) {
            alert("カメラの起動に失敗しました。\n\n【iPadの場合】設定 ＞ Safari ＞「カメラ」のアクセスを「確認」または「許可」にしてください。\n\n詳細: " + e.message);
            console.error(e);
        }
    });

    // --- 2. 撮影 ＆ OCR（文字認識）エンジン ---
    snapBtn.addEventListener('click', () => {
        const context = canvas.getContext('2d');
        // ビデオの現在のフレームをキャンバスに描画
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

        // OCR処理を開始
        runOCR(canvas.toDataURL('image/jpeg'));
    });

    async function runOCR(imageData) {
        ocrStatus.style.display = 'flex'; // ステータス表示
        ocrProgressBar.style.width = '0%'; // プログレス初期化
        ocrStatusText.innerText = "AIエンジン初期化中...";
        snapBtn.disabled = true;
        ocrTextOutput.style.display = 'none';

        try {
            // Tesseract.js（日本語・英語・数字モード）
            const worker = await Tesseract.createWorker('jpn+eng', {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const prog = Math.ceil(m.progress * 100);
                        ocrProgressBar.style.width = prog + '%';
                        ocrStatusText.innerText = `AIが文字を読み取り中 (${prog}%)`;
                    }
                }
            });
            
            const { data: { text } } = await worker.recognize(imageData);
            
            await worker.terminate(); // Tesseractを終了

            // 🌟 結果をテキストエリアに表示。現場スタッフが修正可能
            ocrTextOutput.value = text;
            ocrTextOutput.style.display = 'block'; 
            ocrStatus.style.display = 'none';
            snapBtn.disabled = false;
            analyzeBtn.disabled = false; // 解析ボタンを有効化

            alert("画面読み取りが完了しました。読み間違い（特に全角と半角）を手動で修正して、AI解析を実行してください。");

        } catch (e) {
            console.error(e);
            alert("OCR中にエラーが発生しました。\n詳細: " + e.message);
            ocrStatus.style.display = 'none';
            snapBtn.disabled = false;
        }
    }

    // --- 3. GOTデータ パース（抽出）エンジン ---
    // 🌟 ご提供いただいた「4週間一覧表」「曜日ごとのブロック」に対応するロジック
    function parseOCRText(text) {
        let store = "未取得店舗";
        let category = "";
        let baseSales = 0;
        let shortageRate = 0;
        let cannibal_flag = false;

        // OCR誤読しやすい文字を事前クリーニング
        let cleanText = text.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)); // 全角数字➔半角
        cleanText = cleanText.replace(/ /g, '').replace(/、/g, ','); // スペースや、を統一

        // ① ヘッダーから店舗名・分類を取得（例: "蟹江 明雄 尾張旭晴丘町池上" "分類名 おにぎり"）
        const headerMatch = cleanText.match(/(セブン-イレブン)?([^\n]*店)?\d+:\d+/);
        if (cleanText.includes("池上")) store = "セブンイレブン尾張旭晴丘町池上店";

        if (cleanText.includes("おにぎり")) {
            category = "おにぎり";
        } else if (cleanText.includes("弁当")) {
            category = "弁当";
        }

        // ② 「4週間一覧表（情報分類）」からベース販売数・欠品率を取得
        // ※画像から、「直近週(週平均)」の行の「販売数」を狙うロジック
        const salesSectionMatch = cleanText.match(/直近週\(週平均\)[^\d]*(\d+)[^\d]*(\d+)[^\d]*(\d+)/);
        if (salesSectionMatch) {
            // 例: 納品数 販売数 廃棄数 の順並びを想定
            baseSales = parseFloat(salesSectionMatch[2]);
        } else {
            // 週平均の文字がない場合、画面のどこかにある「販売数」の数字を拾う（プロトタイプ用暫定）
            const fallbackSalesMatch = cleanText.match(/販売数[^\n\d]*(\d+)/);
            if (fallbackSalesMatch) baseSales = parseFloat(fallbackSalesMatch[1]);
        }

        const shortageMatch = cleanText.match(/欠品率\(%\)[^\d]*(\d+)/);
        if (shortageMatch) shortageRate = parseFloat(shortageMatch[1]);

        // 🌟 将来的に画像2枚目の「曜日ごとのブロック」や「単品在庫」も、ここから正規表現で読み取ります

        return { store, category, baseSales, shortageRate };
    }

    // --- 4. AI 複合要因予測・発注算出エンジン ---
    function calculateAIOrder(targetDateStr, todayTemp, yesterdayTemp, ocrData, minDisplayQty) {
        let factors = {
            base: ocrData.baseSales,
            shortageBoost: 0,
            salaryDayBoost: 0,
            tempGapBoost: 0,
            cannibalization: 0,
            stockMinus: 0, // ※将来、在庫推移表OCRから取得
            wasteMinus: 0
        };
        let comments = [];

        // ① 基礎データに対する補正（機会損失）
        if (ocrData.shortageRate > 10) {
            factors.shortageBoost = ocrData.baseSales * 0.10; // 欠品10%超えなら基礎10%アップ
            comments.push(`🎯 機会損失補正：平均欠品率${ocrData.shortageRate}%と売り逃し傾向にあります。ベース予測を10%引き上げました。`);
        }

        // ② 日付要因（給料日・年金支給日エフェクト）
        if (targetDateStr) {
            const d = new Date(targetDateStr);
            const dateNum = d.getDate();
            
            // 財布の紐が緩むエフェクト検知（支給日付近）
            if (dateNum === 15 || dateNum === 25 || dateNum === 16 || dateNum === 26) {
                factors.salaryDayBoost = ocrData.baseSales * 0.15;
                comments.push(`💰 支給日エフェクト検知（${dateNum}日付近）。購買意欲の高まりを見込み、ベース予測を+15%増枠しました。`);
            }
        }

        // ③ 気温ギャップ要因（GEMINI論理：寒暖差検知）
        const tempGap = todayTemp - yesterdayTemp;
        if (tempGap >= 5) {
            factors.tempGapBoost = ocrData.baseSales * 0.20;
            comments.push(`🌡️ 急激な気温上昇（+${tempGap}℃）を検知。突発的な「冷やし麺」「冷惣菜」「サラダ」需要の高まりを予測しブースト(+20%)しました。`);
        } else if (tempGap <= -5) {
            factors.tempGapBoost = -ocrData.baseSales * 0.10;
            comments.push(`❄️ 急激な冷え込み（${tempGap}℃）を検知。客数減と夏型商材の動きが鈍化するリスクを考慮し、微減(-10%)調整しました。`);
        }

        // ④ カニバリゼーション要因（食い合い）の自動判定
        // 例: 調理麺が伸びる猛暑日は、温かい常温弁当を食う
        if (ocrData.category === "弁当" && todayTemp >= 28) {
            factors.cannibalization = -ocrData.baseSales * 0.15;
            comments.push("📈 カテゴリ食い合い（カニバリ）検知：気温28℃以上のため、調理麺への需要シフトが発生すると予測し、常温弁当枠を15%減枠しました。");
        }

        // 🌟 最低陳列量への対応 (長鮮度商材は除くロジック)
        const totalPrediction = factors.base + factors.shortageBoost + factors.salaryDayBoost + factors.tempGapBoost + factors.cannibalization;
        let appliedDisplayQty = 0;
        if (ocrData.category === "おにぎり" && minDisplayQty > totalPrediction) {
            appliedDisplayQty = minDisplayQty;
            comments.push(`volume売場ボリューム維持：AI予測需要よりも最低陳列量(${minDisplayQty}個)の設定が大きいため、売場確保を優先します。`);
        }

        // 最終提案発注数の算出（今回は在庫減算ロジックは外して、予測値＝発注数とするプロトタイプ）
        let finalOrder = Math.max(0, appliedDisplayQty > 0 ? appliedDisplayQty : Math.ceil(totalPrediction));

        return { factors, finalOrder, comments, appliedDisplayQty };
    }

    // --- 5. グラフ描画エンジン (ダークテーマChart.js) ---
    function renderChart(factors) {
        Chart.defaults.color = '#94a3b8';
        Chart.defaults.font.family = 'Segoe UI, Hiragino Kaku Gothic ProN, sans-serif';
        const ctx = document.getElementById('aiChart').getContext('2d');
        if (chartInstance) { chartInstance.destroy(); }
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['基礎需要', '欠品補正', '支給日等', '気温ギャップ', 'カニバリ調整'],
                datasets: [{
                    label: '要因別増減数 (個)',
                    data: [ factors.base, factors.shortageBoost, factors.salaryDayBoost, factors.tempGapBoost, factors.cannibalization ],
                    backgroundColor: ['#3b82f6', '#10b981', '#10b981', factors.tempGapBoost > 0 ? '#10b981' : '#EE1C25', '#F58220'],
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: '#E0E0E0' }, beginAtZero: true },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    // --- 全体実行処理（AI解析ボタンクリック時） ---
    analyzeBtn.addEventListener('click', () => {
        analyzeBtn.disabled = true;
        
        const ocrRawText = ocrTextOutput.value;
        const targetDateStr = document.getElementById('targetDate').value;
        const todayTemp = parseFloat(document.getElementById('todayTemp').value);
        const yesterdayTemp = parseFloat(document.getElementById('yesterdayTemp').value);
        const minDisplayQty = parseFloat(document.getElementById('minDisplayQty').value) || 0;

        // 1.OCRテキストを解析し、データを抽出
        const ocrData = parseOCRText(ocrRawText);
        
        if (ocrData.category) {
            // 分類が読み取れていればセレクトボックスを選択
            document.getElementById('categoryName').value = ocrData.category;
            if (ocrData.category === "おにぎり") {
                document.getElementById('displayInputArea').style.display = 'flex';
            } else {
                document.getElementById('displayInputArea').style.display = 'none';
            }
        }

        // 店舗名を履歴に追加（State）
        if (ocrData.store && ocrData.store !== "未取得店舗") {
            document.getElementById('storeName').value = ocrData.store;
            if (!State.data.stores[ocrData.store]) {
                State.data.stores[ocrData.store] = {};
                State.save();
                // ※将来ここから店舗セレクトボックスを更新する
            }
        }

        // 2. AI予測ロジックを実行
        const result = calculateAIOrder(targetDateStr, todayTemp, yesterdayTemp, ocrData, minDisplayQty);

        // 3. 画面ダッシュボードの更新
        document.getElementById('resCategory').innerText = ocrData.category || "未分類";
        document.getElementById('resStoreText').innerText = ocrData.store;
        document.getElementById('dispBase').innerText = ocrData.baseSales;
        
        let score = result.factors.shortageBoost + result.factors.salaryDayBoost + result.factors.tempGapBoost + result.factors.cannibalization;
        document.getElementById('dispScore').innerText = (score > 0 ? "+" : "") + score.toFixed(1);
        document.getElementById('dispScore').style.color = score >= 0 ? "var(--seven-green)" : "var(--seven-red)";
        document.getElementById('dispFinalOrder').innerHTML = `${result.finalOrder} <small>個</small>`;

        // 4. AI解説コメントの出力
        const commentArea = document.getElementById('aiCommentary');
        if (result.comments.length > 0) {
            commentArea.innerHTML = "<strong>【AI 思考プロセス解説】</strong><br>" + result.comments.join("<br><br>");
        } else {
            commentArea.innerHTML = "<strong>【AI 思考プロセス解説】</strong><br>🎯 特殊な変動要因は検知されませんでした。標準需要に基づき算出しています。";
        }

        // 5. グラフの描画
        renderChart(result.factors);

        analyzeBtn.disabled = false;
        // 結果エリアへスクロール
        document.querySelector('.result-panel').scrollIntoView({ behavior: 'smooth' });
    });
});
