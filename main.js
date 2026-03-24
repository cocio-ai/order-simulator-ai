document.addEventListener("DOMContentLoaded", () => {
    
    // 今日の日付をデフォルトセット
    document.getElementById('targetDate').valueAsDate = new Date();

    let chartInstance = null;

    // --- 1. GOTデータ パース（抽出）エンジン ---
    // ※プロトタイプ用。入力されたテキストから正規表現で数値を拾い上げます。
    function parseGOTData(text) {
        let category = "未分類";
        let avgSales = 0;
        let currentStock = 0;
        let avgWaste = 0;

        // 「分類: 調理麺」のような文字列を抽出
        const catMatch = text.match(/分類[:：\s]*([^\n]+)/);
        if (catMatch) category = catMatch[1].trim();

        const salesMatch = text.match(/平均販売数[:：\s]*(\d+(\.\d+)?)/);
        if (salesMatch) avgSales = parseFloat(salesMatch[1]);

        const stockMatch = text.match(/現在庫[:：\s]*(\d+)/);
        if (stockMatch) currentStock = parseInt(stockMatch[1], 10);

        const wasteMatch = text.match(/平均廃棄数[:：\s]*(\d+(\.\d+)?)/);
        if (wasteMatch) avgWaste = parseFloat(wasteMatch[1]);

        return { category, avgSales, currentStock, avgWaste };
    }

    // --- 2. AI 複合要因計算エンジン ---
    function calculateAIFactors(parsedData, targetDateStr, todayTemp, yesterdayTemp) {
        let baseDemand = parsedData.avgSales;
        
        let factors = {
            base: baseDemand,
            dateBoost: 0,
            tempGapBoost: 0,
            cannibalization: 0,
            stockMinus: -parsedData.currentStock,
            wasteMinus: -parsedData.avgWaste
        };

        let comments = [];

        // ① 日付要因の判定（給料日・休日前）
        if (targetDateStr) {
            const d = new Date(targetDateStr);
            const dateNum = d.getDate();
            const dayOfWeek = d.getDay(); // 0:日, 5:金, 6:土

            // 15日(年金/給与)・25日(給与)の財布の紐が緩むエフェクト
            if (dateNum === 15 || dateNum === 25) {
                factors.dateBoost = baseDemand * 0.15; // 15%増
                comments.push(`💰 支給日エフェクト検知（${dateNum}日）。高単価需要を見込みベース予測を+15%底上げしました。`);
            }
            // 祝前日・週末エフェクト（金曜・土曜）
            else if (dayOfWeek === 5 || dayOfWeek === 6) {
                factors.dateBoost = baseDemand * 0.10; // 10%増
                comments.push("🍺 週末・休日前夜エフェクト検知。夜間需要を見込み+10%補正しました。");
            }
        }

        // ② 気温ギャップ（寒暖差）要因
        const tempGap = todayTemp - yesterdayTemp;
        if (tempGap >= 5) {
            factors.tempGapBoost = baseDemand * 0.20; // 5℃以上上がったら20%増
            comments.push(`🌡️ 昨日からの急激な気温上昇（+${tempGap}℃）を検知。冷やし麺やサラダ等の突発的需要増を予測し強力にブースト(+20%)しました。`);
        } else if (tempGap <= -5) {
            factors.tempGapBoost = -baseDemand * 0.10;
            comments.push(`❄️ 昨日からの急激な冷え込み（${tempGap}℃）。客足鈍化リスクとしてマイナス補正をかけました。`);
        } else if (todayTemp > 30) {
            factors.tempGapBoost = baseDemand * 0.10;
            comments.push("☀️ 30℃超えの真夏日。夏型商材のベース底上げを行いました。");
        }

        // ③ カニバリゼーション（食い合い）の自動判定
        // 例: 調理麺が伸びる猛暑日は、温かい弁当の売上が食われる
        if (parsedData.category.includes("弁当") && todayTemp >= 28) {
            factors.cannibalization = -baseDemand * 0.15;
            comments.push("📉 カニバリゼーション検知：気温28℃以上のため、冷やし麺類への需要シフト（食い合い）が発生すると予測し、弁当枠を15%減枠しました。");
        }

        // 最終計算
        let finalOrder = factors.base + factors.dateBoost + factors.tempGapBoost + factors.cannibalization + factors.stockMinus + factors.wasteMinus;
        finalOrder = Math.max(0, Math.ceil(finalOrder)); // マイナス発注は0にする

        return { factors, finalOrder, comments };
    }

    // --- 3. グラフ描画機能 ---
    function renderChart(factors) {
        const ctx = document.getElementById('aiChart').getContext('2d');
        
        if (chartInstance) { chartInstance.destroy(); }

        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['基本需要', '日付/曜日', '気温変動', 'カニバリ調整', '在庫/廃棄控除'],
                datasets: [{
                    label: '発注数 増減要因 (個)',
                    data: [
                        factors.base, 
                        factors.dateBoost, 
                        factors.tempGapBoost, 
                        factors.cannibalization, 
                        (factors.stockMinus + factors.wasteMinus)
                    ],
                    backgroundColor: [
                        '#3b82f6', // 青: 基本
                        '#10b981', // 緑: プラス要因
                        factors.tempGapBoost > 0 ? '#10b981' : '#ef4444', 
                        '#f59e0b', // オレンジ: カニバリ
                        '#ef4444'  // 赤: マイナス要因
                    ],
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }

    // --- メイン実行処理 ---
    document.getElementById('btn-analyze').addEventListener('click', () => {
        const text = document.getElementById('gotDataInput').value;
        const targetDate = document.getElementById('targetDate').value;
        const todayTemp = parseFloat(document.getElementById('todayTemp').value);
        const yesterdayTemp = parseFloat(document.getElementById('yesterdayTemp').value);

        // 1. データのパース
        const parsedData = parseGOTData(text);
        
        if (parsedData.avgSales === 0) {
            alert("テキストから数値を読み取れませんでした。形式を確認してください。");
            return;
        }

        // 2. AI要因の計算
        const result = calculateAIFactors(parsedData, targetDate, todayTemp, yesterdayTemp);

        // 3. 画面の更新
        document.getElementById('dispBase').innerText = parsedData.avgSales;
        let score = result.factors.dateBoost + result.factors.tempGapBoost + result.factors.cannibalization;
        document.getElementById('dispScore').innerText = (score > 0 ? "+" : "") + score.toFixed(1);
        document.getElementById('dispScore').style.color = score >= 0 ? "#10b981" : "#ef4444";
        document.getElementById('dispFinalOrder').innerHTML = `${result.finalOrder} <small>個</small>`;

        // 4. AIコメントの出力
        const commentArea = document.getElementById('aiCommentary');
        if (result.comments.length > 0) {
            commentArea.innerHTML = "<strong>【AI 思考プロセス】</strong><br>" + result.comments.join("<br><br>");
        } else {
            commentArea.innerHTML = "<strong>【AI 思考プロセス】</strong><br>🎯 特殊な変動要因は検知されませんでした。標準的な需要予測に基づき算出しています。";
        }

        // 5. グラフの描画
        renderChart(result.factors);
    });
});
