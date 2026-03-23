# Camera Detection MVP

Windows のブラウザでカメラ映像を開き、検出した物体に四角い枠と英語ラベルを重ねる最小構成のMVPです。

特定ラベルを選んで、その対象だけを簡易的に追尾するモードも含みます。

## 構成

- `index.html`: 画面レイアウト
- `styles.css`: スタイル
- `app.js`: カメラ起動、モデル読み込み、物体検出、オーバーレイ描画

## 使い方

`getUserMedia()` を安定して使うため、`localhost` で開いてください。PowerShell なら次で十分です。

```powershell
cd C:\Users\moshi\MyProjects\RaspberryPi\camera01
py -m http.server 8000
```

ブラウザで次を開きます。

```text
http://localhost:8000
```

## 注意

- 初回はカメラ許可が必要です
- 検出カテゴリは COCO-SSD の学習済みラベルに依存します
- ローカルPC性能によって検出速度は変わります
- `Track label` で対象を選ぶと、そのラベルだけを優先表示します
- `Minimum confidence` を上げると誤検出を減らせます
- 映像上の対象をクリックすると、その物体に追尾ロックできます
- ロック中の対象は強調色、中心マーカー、`LOCKED` ラベルで目立つように表示されます
- `Save snapshot` で現在の映像とオーバーレイをPNG保存できます
- `Event Log` にロックや保存などの操作履歴が表示されます
- 保存画像には対象ラベルと時刻が焼き込まれます
- `Recent Snapshots` に直近の保存画像が表示されます
