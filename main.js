document.addEventListener("DOMContentLoaded", () => {
    
    document.getElementById('targetDate').valueAsDate = new Date();
    let chartInstance = null;

    // --- 1. 爆速テンキー入力制御エンジン ---
    const fields = ['avgSales', 'currentStock', 'maxSales', 'minSales', 'avgWaste', 'avgShortageRate'];
    let currentFieldIndex = 0;
    let inputData = { avgSales: "", currentStock: "", maxSales: "", minSales: "", avgWaste: "", avgShortageRate: "" };

    const inputRows = document.querySelectorAll('.input-row');
    const analyzeBtn = document.getElementById('btn-analyze');

    // フィールドのアクティブ切り替え
    function setActiveField(index) {
        inputRows.forEach(row => row.classList.remove('active'));
        if (index < fields.length) {
            document.querySelector(`[data-field="${fields[index]}"]`).classList.add('active');
            currentFieldIndex = index;
        }
    }

    // 各行をタップした時、そこへフォーカスを移動
    inputRows.forEach((row, index) => {
        row.addEventListener('click', () => { setActiveField(index); });
    });

    // テンキーの入力処理
    document.querySelectorAll('.key-btn.num').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const num = e.target.dataset.num;
            const field = fields[currentFieldIndex];
            if (!field) return; // 全て入力済みの場合
            
            // 最大4桁まで
            if (inputData[field].length < 4) {
                inputData[field] += num;
                document.getElementById(`val-${field}`).innerText = inputData[field];
            }
            checkAllFilled();
        });
    });

    // C（クリア）ボタン
    document.getElementById('btn-clear').addEventListener('click', () => {
        const field = fields[currentFieldIndex];
        if (field) {
            inputData[field] = ""; // 全消去
            document.getElementById(`val-${field}`).innerText = "";
            checkAllFilled();
        }
    });

    // 次へボタン
    document.getElementById('btn-next').addEventListener('click', () => {
        if (currentFieldIndex < fields.length - 1) {
            setActiveField(currentFieldIndex + 1);
        } else {
            // 全て入力完了したらフォーカスを外す
            inputRows.forEach(row => row.classList.remove('active'));
            currentFieldIndex = fields.length; // 枠外
        }
    });

    // 全て入力されたかチェックし、分析ボタンを光らせる
    function checkAllFilled() {
        const cat = document.getElementById('categoryName').value;
        const base = inputData['avgSales'];
        if (cat && base) {
            analyzeBtn.disabled = false;
            analyzeBtn.classList.add('ready');
        } else {
            analyzeBtn.disabled = true;
            analyzeBtn.classList.remove('ready');
        }
    }

    document.getElementById('categoryName').addEventListener('change', checkAllFilled);

    // --- 2. AI 複合要因・算出エンジン (精度強化版) ---
    function calculateAIOrder(targetDateStr, todayTemp, yesterdayTemp, data) {
        let factors = { 
            base: parseFloat(data.avgSales) || 0, 
            shortageBoost: 0, 
            safetyStock: 0, 
            salaryDayBoost: 0, 
            tempGapBoost: 0, 
            cannibalization: 0, 
            stockMinus: -(parseFloat(data.currentStock) || 0), 
            wasteMinus: -(parseFloat(data.avgWaste) || 0) 
        };
        let comments = [];

        const maxS = parseFloat(data.maxSales) || factors.base;
        const minS = parseFloat(data.minSales) || factors.base;
        const shortage = parseFloat(data.avgShortageRate) || 0;

        // ① 安全在庫の計算 (ブレ幅)
        if (maxS > minS) {
            const stdDev = (maxS - minS) / 4;
            factors.safetyStock = stdDev * 1.5; // 予測変動へのバッファ
            comments.push(`📊 売上ブレ幅を考慮し、安全在庫として ${factors.safetyStock.toFixed(1)}個 のバッファを確保しました。`);
        }

        // ② 機会損失補正
        if (shortage > 5) {
            factors.shortageBoost = factors.base * (shortage / 100);
            comments.push(`🎯 欠品率${shortage}%を検知。売り逃しを防ぐため、潜在需要を算出して底上げしました。`);
        }

        // ③ 日付要因（給料日・休日判定）
        if (targetDateStr) {
            const d = new Date(targetDateStr);
            const dateNum = d.getDate();
            const day = d.getDay();
            
            if ([15, 16, 25, 26].includes(dateNum)) {
                factors.salaryDayBoost = factors.base * 0.15;
                comments.push(`💰 支給日エフェクト（${dateNum}日付近）。購買意欲の高まりを見込み(+15%)増枠。`);
            }
            if (day === 5 || day === 6) { // 金・土
                factors.salaryDayBoost += factors.base * 0.10;
                comments.push(`🍺 週末・休日前夜エフェクト。需要増を見込み(+10%)補正。`);
            }
        }

        // ④ 気温ギャップ（寒暖差）
        const tempGap = todayTemp - yesterdayTemp;
        if (tempGap >= 5) {
            factors.tempGapBoost = factors.base * 0.20;
            comments.push(`🌡️ 急激な気温上昇（+${tempGap}℃）。冷やし麺等の需要増ブースト(+20%)。`);
        } else if (tempGap <= -5) {
            factors.tempGapBoost = -factors.base * 0.10;
            comments.push(`❄️ 急激な冷え込み（${tempGap}℃）。客足鈍化リスクで微減(-10%)。`);
        }

        // ⑤ カニバリゼーション（食い合い）
        const cat = document.getElementById('categoryName').value;
        if ((cat === "弁当" || cat === "グラタンドリア") && todayTemp >= 28) {
            factors.cannibalization = -factors.base * 0.15;
            comments.push("📈 カニバリ検知：高温のため冷やし麺へ需要シフト。常温商材を15%減枠。");
        }

        if (factors.stockMinus < 0) comments.push(`📦 現在庫(${Math.abs(factors.stockMinus)}個)を発注数から減算しました。`);
        if (factors.wasteMinus < 0) comments.push(`🗑️ ロス削減のため、平均廃棄数(${Math.abs(factors.wasteMinus)}個)を発注数から減算しました。`);

        // 合計（マイナスにはしない）
        let total = factors.base + factors.safetyStock + factors.shortageBoost + factors.salaryDayBoost + factors.tempGapBoost + factors.cannibalization + factors.stockMinus + factors.wasteMinus;
        let finalOrder = Math.max(0, Math.ceil(total));

        return { factors, finalOrder, comments };
    }

    // --- 3. グラフ描画 ---
    function renderChart(f) {
        const ctx = document.getElementById('aiChart').getContext('2d');
        if (chartInstance) { chartInstance.destroy(); }
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['基礎', '安全/欠品', '日付等', '気温差', '在庫/廃棄減'],
                datasets: [{
                    label: '増減要因 (個)',
                    data: [ 
                        f.base, 
                        (f.safetyStock + f.shortageBoost), 
                        f.salaryDayBoost, 
                        f.tempGapBoost, 
                        (f.cannibalization + f.stockMinus + f.wasteMinus) 
                    ],
                    backgroundColor: ['#3b82f6', '#10b981', '#10b981', f.tempGapBoost > 0 ? '#10b981' : '#EE1C25', '#EE1C25'],
                    borderRadius: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#E0E0E0' } }, x: { grid: { display: false } } } }
        });
    }

    // --- 実行処理 ---
    analyzeBtn.addEventListener('click', () => {
        const targetDateStr = document.getElementById('targetDate').value;
        const todayTemp = parseFloat(document.getElementById('todayTemp').value);
        const yesterdayTemp = parseFloat(document.getElementById('yesterdayTemp').value);
        const cat = document.getElementById('categoryName').value;

        const result = calculateAIOrder(targetDateStr, todayTemp, yesterdayTemp, inputData);

        document.getElementById('resCategory').innerText = cat;
        document.getElementById('dispBase').innerText = inputData.avgSales;
        
        let score = result.factors.safetyStock + result.factors.shortageBoost + result.factors.salaryDayBoost + result.factors.tempGapBoost + result.factors.cannibalization + result.factors.stockMinus + result.factors.wasteMinus;
        document.getElementById('dispScore').innerText = (score > 0 ? "+" : "") + Math.ceil(score);
        document.getElementById('dispScore').style.color = score >= 0 ? "var(--seven-green)" : "var(--seven-red)";
        document.getElementById('dispFinalOrder').innerHTML = `${result.finalOrder} <small>個</small>`;

        document.getElementById('aiCommentary').innerHTML = "<strong>【AI 思考プロセス解説】</strong><br>" + result.comments.join("<br><br>");
        
        renderChart(result.factors);
        document.querySelector('.result-panel').scrollIntoView({ behavior: 'smooth' });
        
        // 入力完了後、フォーカスを外す
        inputRows.forEach(row => row.classList.remove('active'));
        currentFieldIndex = fields.length;
    });
});
