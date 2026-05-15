4人麻雀 成績記録 v2 共有版

開くファイル:
  index.html

この版の特徴:
- URLを知っている人は誰でも入力・変更できる共有版です。
- GitHub Pagesに置いて公開できます。
- Firebase Firestoreを保存先に使います。
- firebase-config.js にFirebaseのWebアプリ設定を貼り付けると共有保存が有効になります。
- firebase-config.js が未設定の場合は、従来通りその端末のブラウザ内だけに保存されます。

GitHub Pagesにアップロードするファイル:
  index.html
  style.css
  script.js
  firebase-config.js
  header-chu.png
  README.txt

Firebase側で必要な設定:
1. Firebaseでプロジェクトを作成
2. Webアプリを追加
3. 表示された firebaseConfig の値を firebase-config.js に貼り付け
4. Firestore Databaseを作成
5. Firestore Rulesを以下のように設定

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /mahjongScoreApps/{docId} {
      allow read, write: if true;
    }
  }
}

注意:
このルールは「URLを知っている人は誰でも入力・変更できる」用途のためのものです。
荒らしや誤操作を防ぎたい場合は、後でログイン制や編集パスワード制に変更してください。

更新メモ:
- 共有版で入力中にFirestore同期が走って入力欄のフォーカスが外れる問題を修正しました。
- 名前・点数・メモ・レート入力中は画面全体を再描画せず、保存は少し遅らせてまとめて行います。


2026-05-15 修正:
- Firebase共有版で入力中に1文字ごとに確定される問題を追加修正。
- 名前、点数、メモ、レートの入力中は画面全体の再描画と外部同期反映を抑止。
- Firebase保存は主にEnter確定またはフォーカス移動時に実行。


[v4] iPhoneなど幅の狭い画面で、対局入力欄が横にはみ出さないように列幅と余白を調整しました。


v7: iPhone表示で対局入力欄が横にはみ出す問題を修正。メモ欄を削除。iPhoneの「次へ」で点数欄から次の点数欄へ移動するように修正し、入力欄列幅をスマホ幅に収まるよう再調整。


更新内容 v7:
- タブの並び順を「対局入力 → 日付別成績 → 個人成績」に変更しました。
