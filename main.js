    // --- 1. カメラ起動・撮影エンジン ---
    startCameraBtn.addEventListener('click', async () => {
        try {
            // 🌟 修正1: facingModeのスペルミスを修正し、外側（アウトカメラ）を指定
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment" }, 
                audio: false 
            });
            video.srcObject = stream;

            // 🌟 修正2: iPad(Safari)対策。映像データが読み込まれたら確実に再生させる
            video.onloadedmetadata = () => {
                video.play();
            };

            snapBtn.disabled = false; // 撮影ボタンを有効化
            startCameraBtn.innerText = "🔄 カメラ再起動";
        } catch (e) {
            // 🌟 修正3: iPad等でエラーが出た場合、原因をアラートで詳しく表示する
            alert("カメラの起動に失敗しました。\n\n【よくある原因】\niPadの設定アプリ ＞ Safari ＞「カメラ」へのアクセスが「拒否」になっている可能性があります。「確認」または「許可」に変更してください。\n\nエラー詳細: " + e.message);
            console.error(e);
        }
    });
